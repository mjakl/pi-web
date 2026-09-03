import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { createJiti } from "jiti";

process.env.NODE_ENV = "test";
const window = new Window({ url: "http://localhost" });
Object.assign(globalThis, {
  window,
  document: window.document,
  Node: window.Node,
  HTMLElement: window.HTMLElement,
  HTMLButtonElement: window.HTMLButtonElement,
  Event: window.Event,
  MouseEvent: window.MouseEvent,
  KeyboardEvent: window.KeyboardEvent,
  PointerEvent: window.PointerEvent,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  IS_REACT_ACT_ENVIRONMENT: true,
});

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { act } = React;
const { createRoot } = await jiti.import("react-dom/client");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { SessionIndicator, SessionItem } = await jiti.import("./SessionItem.tsx");

function renderIndicator(kind) {
  return renderToStaticMarkup(React.createElement(SessionIndicator, { kind }));
}

const baseSession = {
  id: "abcdef1234567890",
  path: "/tmp/sessions/abcdef1234567890.jsonl",
  cwd: "/tmp/project",
  created: "2026-09-01T10:00:00.000Z",
  modified: "2026-09-01T10:05:00.000Z",
  messageCount: 3,
};

function sessionItemProps(session, props = {}) {
  return {
    session,
    isSelected: false,
    onClick() {},
    ...props,
  };
}

function renderItem(session, props = {}) {
  return renderToStaticMarkup(React.createElement(SessionItem, sessionItemProps(session, props)));
}

async function mountItem(session, props = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(() => root.render(React.createElement(SessionItem, sessionItemProps(session, props))));
  return {
    container,
    async rerender(nextSession, nextProps = {}) {
      await act(() => root.render(React.createElement(SessionItem, sessionItemProps(nextSession, nextProps))));
    },
    async unmount() {
      await act(() => root.unmount());
      container.remove();
    },
  };
}

async function click(element, init = {}) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

test("each session indicator keeps its own label, colour, and glyph", () => {
  const running = renderIndicator("running");
  assert.match(running, /^<span title="Agent running…" aria-label="Agent running…" style="width:14px;height:14px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;color:var\(--accent\)">/);
  assert.match(running, /<animateTransform attributeName="transform" type="rotate"/);

  const active = renderIndicator("active");
  assert.match(active, /title="Session active" aria-label="Session active" style="[^"]*color:#16a34a"/);
  assert.match(active, /<circle cx="7" cy="7" r="3" fill="currentColor">/);

  const stopped = renderIndicator("stopped");
  assert.match(stopped, /title="Session stopped" aria-label="Session stopped" style="[^"]*color:var\(--text-dim\)"/);
  assert.match(stopped, /<rect x="4" y="4" width="6" height="6" rx="1"/);

  const unread = renderIndicator("unread");
  assert.match(unread, /title="New activity" aria-label="New session activity" style="[^"]*color:#0891b2"/);
  assert.match(unread, /<animate attributeName="r" values="3;6;3"/);
});

test("a session row titles itself from the name, then the first message, then the id", () => {
  assert.match(renderItem({ ...baseSession, name: "Release notes" }), /title="Release notes"/);
  assert.match(renderItem({ ...baseSession, firstMessage: "Summarise the changelog" }), /title="Summarise the changelog"/);
  assert.match(renderItem(baseSession), /title="abcdef123456"/);
});

test("a stopped session row shows the stopped marker and its message count", () => {
  const html = renderItem(baseSession);
  assert.match(html, /^<div data-session-inventory-id="abcdef1234567890"/);
  assert.match(html, /aria-label="Session stopped"/);
  assert.doesNotMatch(html, /aria-label="New session activity"/);
  assert.match(html, />3 msgs</);
  assert.match(html, /border-left:2px solid transparent/);
});

test("session action eligibility matches persisted and transient state", () => {
  assert.match(renderItem(baseSession), /aria-label="Session actions"/);
  assert.match(renderItem(baseSession, { isActive: true }), /aria-label="Session actions"/);
  assert.match(renderItem({ ...baseSession, transient: true }, { isActive: true }), /aria-label="Session actions"/);
  assert.doesNotMatch(renderItem({ ...baseSession, transient: true }), /aria-label="Session actions"/);
});

test("the always-visible trigger uses native button keyboard semantics and does not select the row", async () => {
  let selections = 0;
  const view = await mountItem(baseSession, { onClick: () => { selections += 1; } });
  const trigger = view.container.querySelector('[aria-label="Session actions"]');
  assert.ok(trigger instanceof HTMLButtonElement);
  assert.equal(trigger.getAttribute("aria-haspopup"), null);
  assert.ok(trigger.getAttribute("aria-controls"));

  await click(trigger);
  assert.equal(selections, 0);
  assert.deepEqual([...document.querySelectorAll('[role="group"] button')].map((item) => item.textContent), ["Rename", "Delete"]);
  await view.unmount();

  const transient = await mountItem({ ...baseSession, transient: true }, { isActive: true });
  await click(transient.container.querySelector('[aria-label="Session actions"]'));
  assert.deepEqual([...document.querySelectorAll('[role="group"] button')].map((item) => item.textContent), ["Stop"]);
  await transient.unmount();
});

test("the popup uses native disclosure and action-group semantics", async () => {
  const view = await mountItem(baseSession);
  try {
    const trigger = view.container.querySelector('[aria-label="Session actions"]');
    await click(trigger);

    const popup = document.querySelector('[aria-label="Session actions"][role="group"]');
    assert.ok(popup);
    assert.equal(trigger.getAttribute("aria-haspopup"), null);
    assert.ok([...popup.querySelectorAll("button")].every((button) => button instanceof HTMLButtonElement && !button.hasAttribute("role")));
  } finally {
    await view.unmount();
  }
});

test("Escape claimed by the popup does not reach window shortcuts", async () => {
  const view = await mountItem(baseSession);
  const trigger = view.container.querySelector('[aria-label="Session actions"]');
  let windowEscapes = 0;
  const windowListener = (event) => { if (event.key === "Escape") windowEscapes += 1; };
  window.addEventListener("keydown", windowListener);

  try {
    await click(trigger);
    await act(() => document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    assert.equal(windowEscapes, 0);
    assert.equal(document.activeElement, trigger);
  } finally {
    window.removeEventListener("keydown", windowListener);
    await view.unmount();
  }
});

test("Stop and Delete move focus into their inline confirmation", async () => {
  for (const action of ["Stop", "Delete"]) {
    const view = await mountItem(baseSession, { isActive: true });
    try {
      await click(view.container.querySelector('[aria-label="Session actions"]'));
      const item = [...document.querySelectorAll('[role="group"] button')].find((button) => button.textContent === action);
      await click(item);

      const primary = [...view.container.querySelectorAll("button")].find((button) => button.textContent.trim() === action);
      assert.equal(document.activeElement === primary, true);
    } finally {
      await view.unmount();
    }
  }
});

test("eligibility changes close an open popup", async () => {
  const activePersisted = await mountItem(baseSession, { isActive: true });
  try {
    await click(activePersisted.container.querySelector('[aria-label="Session actions"]'));
    await activePersisted.rerender(baseSession, { isActive: false });
    assert.equal(document.querySelector('[role="group"]') === null, true);
    await activePersisted.rerender(baseSession, { isActive: true });
    assert.equal(document.querySelector('[role="group"]') === null, true);
  } finally {
    await activePersisted.unmount();
  }

  const persisted = await mountItem(baseSession);
  try {
    await click(persisted.container.querySelector('[aria-label="Session actions"]'));
    await persisted.rerender({ ...baseSession, transient: true });
    assert.equal(document.querySelector('[role="group"]') === null, true);
  } finally {
    await persisted.unmount();
  }
});

test("Escape and outside presses dismiss the menu, with Escape restoring trigger focus", async () => {
  const view = await mountItem(baseSession);
  const trigger = view.container.querySelector('[aria-label="Session actions"]');

  await click(trigger);
  await act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  assert.equal(document.querySelector('[role="group"]'), null);
  assert.equal(document.activeElement, trigger);

  await click(trigger);
  await act(() => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
  assert.equal(document.querySelector('[role="group"]'), null);
  await view.unmount();
});

test("menu actions preserve rename and Stop/Delete confirmations without selecting the row", async () => {
  for (const action of ["Rename", "Stop", "Delete"]) {
    let selections = 0;
    const view = await mountItem(baseSession, { isActive: true, onClick: () => { selections += 1; } });
    await click(view.container.querySelector('[aria-label="Session actions"]'));
    const item = [...document.querySelectorAll('[role="group"] button')].find((button) => button.textContent === action);
    await click(item);

    if (action === "Rename") assert.ok(view.container.querySelector("input"));
    if (action === "Stop") assert.match(view.container.textContent, /Stop active work/);
    if (action === "Delete") assert.match(view.container.textContent, /Delete abcdef123456\?/);
    assert.equal(selections, 0);
    await view.unmount();
  }
});

test("Shift-click bypasses Stop and Delete confirmations", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push([url, init?.method]);
    return new Response(null, { status: 200 });
  };

  try {
    const view = await mountItem(baseSession, { isActive: true });
    for (const action of ["Stop", "Delete"]) {
      await click(view.container.querySelector('[aria-label="Session actions"]'));
      const item = [...document.querySelectorAll('[role="group"] button')].find((button) => button.textContent === action);
      await click(item, { shiftKey: true });
      assert.doesNotMatch(view.container.textContent, /Stop active work|Delete abcdef123456\?/);
    }
    assert.deepEqual(requests, [
      ["/api/agent/abcdef1234567890", "DELETE"],
      ["/api/sessions/abcdef1234567890", "DELETE"],
    ]);
    await view.unmount();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("opening and closing the out-of-flow menu preserves row geometry", async () => {
  const view = await mountItem({ ...baseSession, name: "A very long session title that must stay truncated" });
  const row = view.container.firstElementChild;
  const trigger = view.container.querySelector('[aria-label="Session actions"]');
  const title = view.container.querySelector('[title="A very long session title that must stay truncated"]');
  const titleStyle = title.getAttribute("style");

  assert.equal(row.style.height, "54px");
  assert.equal(trigger.parentElement.style.width, "28px");
  await click(trigger);
  assert.equal(document.querySelector('[role="group"]').parentElement, document.body);
  assert.equal(title.getAttribute("style"), titleStyle);
  await act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  assert.equal(title.getAttribute("style"), titleStyle);
  await view.unmount();
});

test("a selected running worktree session shows running, unread, and branch state", () => {
  const html = renderItem(
    { ...baseSession, name: "Feature work", isWorktree: true, branch: "feature/seams", messageCount: undefined },
    { isSelected: true, isActive: true, isRunning: true, isUnread: true },
  );
  assert.match(html, /aria-label="Agent running…"/);
  assert.match(html, /aria-label="New session activity"/);
  assert.match(html, /aria-label="Loading\.\.\."/);
  assert.match(html, /title="Worktree: \/tmp\/project"/);
  assert.match(html, />feature\/seams</);
  assert.match(html, /border-left:2px solid var\(--accent\)/);
});
