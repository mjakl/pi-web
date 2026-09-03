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

async function pressKey(element, key, init = {}) {
  await act(() => element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })));
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
  assert.match(renderItem(baseSession), /aria-label="Session actions for abcdef123456"/);
  assert.match(renderItem(baseSession, { isActive: true }), /aria-label="Session actions for abcdef123456"/);
  assert.match(renderItem({ ...baseSession, transient: true }, { isActive: true }), /aria-label="Session actions for abcdef123456"/);
  assert.doesNotMatch(renderItem({ ...baseSession, transient: true }), /aria-label="Session actions for abcdef123456"/);
});

test("the always-visible trigger uses native button keyboard semantics and does not select the row", async () => {
  let selections = 0;
  const view = await mountItem(baseSession, { onClick: () => { selections += 1; } });
  const trigger = view.container.querySelector("button[aria-controls]");
  assert.ok(trigger instanceof HTMLButtonElement);
  assert.equal(trigger.getAttribute("aria-haspopup"), null);
  assert.ok(trigger.getAttribute("aria-controls"));

  await click(trigger);
  assert.equal(selections, 0);
  assert.deepEqual([...document.querySelectorAll('[role="group"] button')].map((item) => item.textContent), ["Rename", "Delete"]);
  await view.unmount();

  const transient = await mountItem({ ...baseSession, transient: true }, { isActive: true });
  await click(transient.container.querySelector("button[aria-controls]"));
  assert.deepEqual([...document.querySelectorAll('[role="group"] button')].map((item) => item.textContent), ["Stop"]);
  await transient.unmount();
});

test("the popup uses native disclosure and action-group semantics", async () => {
  const view = await mountItem(baseSession);
  try {
    const trigger = view.container.querySelector("button[aria-controls]");
    await click(trigger);

    const popup = document.querySelector('[aria-label="Session actions for abcdef123456"][role="group"]');
    assert.ok(popup);
    assert.equal(trigger.getAttribute("aria-haspopup"), null);
    assert.ok([...popup.querySelectorAll("button")].every((button) => button instanceof HTMLButtonElement && !button.hasAttribute("role")));
  } finally {
    await view.unmount();
  }
});

test("Escape claimed by the popup does not reach window shortcuts", async () => {
  const view = await mountItem(baseSession);
  const trigger = view.container.querySelector("button[aria-controls]");
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
      await click(view.container.querySelector("button[aria-controls]"));
      const item = [...document.querySelectorAll('[role="group"] button')].find((button) => button.textContent === action);
      await click(item);

      const primary = [...view.container.querySelectorAll("button")].find((button) => button.textContent.trim() === action);
      assert.equal(document.activeElement === primary, true);
    } finally {
      await view.unmount();
    }
  }
});

test("eligibility changes close an open popup and restore focus only to an eligible trigger", async () => {
  const activePersisted = await mountItem(baseSession, { isActive: true });
  try {
    const trigger = activePersisted.container.querySelector("button[aria-controls]");
    await click(trigger);
    document.querySelector('[role="group"] button').focus();
    await activePersisted.rerender(baseSession, { isActive: false });
    assert.equal(document.querySelector('[role="group"]') === null, true);
    assert.equal(document.activeElement === trigger, true);
    await activePersisted.rerender(baseSession, { isActive: true });
    assert.equal(document.querySelector('[role="group"]') === null, true);
  } finally {
    await activePersisted.unmount();
  }

  const transient = await mountItem({ ...baseSession, transient: true }, { isActive: true });
  try {
    await click(transient.container.querySelector("button[aria-controls]"));
    document.querySelector('[role="group"] button').focus();
    await transient.rerender({ ...baseSession, transient: true }, { isActive: false });
    assert.equal(document.querySelector('[role="group"]') === null, true);
    assert.equal(transient.container.querySelector("button[aria-controls]"), null);
  } finally {
    await transient.unmount();
  }
});

test("boundary Tab closes the portal and follows the trigger's logical position", async () => {
  const view = await mountItem(baseSession, { isActive: true });
  const next = document.createElement("button");
  next.textContent = "Next control";
  view.container.after(next);

  try {
    const trigger = view.container.querySelector("button[aria-controls]");
    await click(trigger);
    const actions = [...document.querySelectorAll('[role="group"] button')];
    actions.at(-1).focus();
    await pressKey(actions.at(-1), "Tab");
    assert.equal(document.querySelector('[role="group"]') === null, true);
    assert.equal(document.activeElement === next, true);

    await click(trigger);
    const first = document.querySelector('[role="group"] button');
    first.focus();
    await pressKey(first, "Tab", { shiftKey: true });
    assert.equal(document.querySelector('[role="group"]') === null, true);
    assert.equal(document.activeElement === trigger, true);
  } finally {
    next.remove();
    await view.unmount();
  }
});

test("moving focus outside the trigger and popup closes the popup", async () => {
  const view = await mountItem(baseSession);
  const outside = document.createElement("button");
  document.body.append(outside);

  try {
    await click(view.container.querySelector("button[aria-controls]"));
    await act(() => outside.focus());
    assert.equal(document.querySelector('[role="group"]') === null, true);
  } finally {
    outside.remove();
    await view.unmount();
  }
});

test("popup scrolling stays open while outside scrolling closes it", async () => {
  const view = await mountItem(baseSession, { isActive: true });
  try {
    const trigger = view.container.querySelector("button[aria-controls]");
    await click(trigger);
    const group = document.querySelector('[role="group"]');
    await act(() => group.dispatchEvent(new Event("scroll")));
    assert.equal(document.querySelector('[role="group"]') === group, true);

    await act(() => view.container.dispatchEvent(new Event("scroll")));
    assert.equal(document.querySelector('[role="group"]') === null, true);
  } finally {
    await view.unmount();
  }
});

test("session action controls include the session title in their accessible name", async () => {
  const first = await mountItem({ ...baseSession, name: "Release notes" });
  const second = await mountItem({ ...baseSession, id: "other", name: "Bug triage" });
  try {
    const firstTrigger = first.container.querySelector('[aria-label="Session actions for Release notes"]');
    const secondTrigger = second.container.querySelector('[aria-label="Session actions for Bug triage"]');
    assert.ok(firstTrigger);
    assert.ok(secondTrigger);
    await click(firstTrigger);
    assert.equal(document.querySelector('[role="group"]').getAttribute("aria-label"), "Session actions for Release notes");
  } finally {
    await first.unmount();
    await second.unmount();
  }
});

test("Escape and outside presses dismiss the menu, with Escape restoring trigger focus", async () => {
  const view = await mountItem(baseSession);
  const trigger = view.container.querySelector("button[aria-controls]");

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
    await click(view.container.querySelector("button[aria-controls]"));
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
      await click(view.container.querySelector("button[aria-controls]"));
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
  const trigger = view.container.querySelector("button[aria-controls]");
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
