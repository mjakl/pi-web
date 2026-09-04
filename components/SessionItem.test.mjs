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
    actionsAvailable: true,
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
    async rerenderAfter(callback, nextSession, nextProps = {}) {
      await act(() => {
        callback();
        root.render(React.createElement(SessionItem, sessionItemProps(nextSession, nextProps)));
      });
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

function accessibleName(element) {
  return element.getAttribute("aria-label") ?? element.textContent.trim();
}

test("each session indicator keeps its own label, colour, and glyph", () => {
  const running = renderIndicator("running");
  assert.match(running, /^<span title="Agent running…" aria-label="Agent running…" style="width:14px;height:14px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;color:var\(--accent\)">/);
  assert.match(running, /<animateTransform attributeName="transform" type="rotate"/);

  const active = renderIndicator("active");
  assert.match(active, /title="Session active" aria-label="Session active" style="[^"]*color:var\(--success\)"/);
  assert.match(active, /<circle cx="7" cy="7" r="5" fill="currentColor">/);

  const stopped = renderIndicator("stopped");
  assert.match(stopped, /title="Session stopped" aria-label="Session stopped" style="[^"]*color:var\(--text-dim\)"/);
  assert.match(stopped, /<circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.25" opacity="0.6"/);
});

test("a session row titles itself from the name, then the first message, then the id", () => {
  assert.match(renderItem({ ...baseSession, name: "Release notes" }), /title="Release notes"/);
  assert.match(renderItem({ ...baseSession, firstMessage: "Summarise the changelog" }), /title="Summarise the changelog"/);
  assert.match(renderItem(baseSession), /title="abcdef123456"/);
});

test("a stopped session row shows the stopped marker and its message count", () => {
  const html = renderItem(baseSession);
  assert.match(html, /^<div class="session-row" data-session-inventory-id="abcdef1234567890"/);
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

test("menu Stop and Delete execute immediately and restore the action trigger", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push([String(url), init?.method]);
    return new Response(null, { status: 200 });
  };
  let stopped = false;
  let deleted = false;
  const view = await mountItem(baseSession, {
    isActive: true,
    onStopped: () => { stopped = true; },
    onDeleted: () => { deleted = true; },
  });
  try {
    await click(view.container.querySelector("button[aria-controls]"));
    await click([...document.querySelectorAll('[role="group"] button')].find((button) => button.textContent === "Stop"));

    assert.equal(stopped, true);
    assert.equal(document.activeElement, view.container.querySelector("button[aria-controls]"));

    await click(view.container.querySelector("button[aria-controls]"));
    await click([...document.querySelectorAll('[role="group"] button')].find((button) => button.textContent === "Delete"));

    assert.equal(deleted, true);
    assert.deepEqual(requests, [
      ["/api/agent/abcdef1234567890", "DELETE"],
      ["/api/sessions/abcdef1234567890", "DELETE"],
    ]);
  } finally {
    await view.unmount();
    globalThis.fetch = originalFetch;
  }
});

test("a pending Delete closes the menu and cannot be started twice", async () => {
  const originalFetch = globalThis.fetch;
  let finishDelete;
  const pendingDelete = new Promise((resolve) => { finishDelete = resolve; });
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    await pendingDelete;
    return new Response(null, { status: 200 });
  };
  const view = await mountItem(baseSession, { isActive: true });
  try {
    const trigger = view.container.querySelector("button[aria-controls]");
    await click(trigger);
    const deleteItem = [...document.querySelectorAll('[role="group"] button')].find((button) => button.textContent === "Delete");
    await act(() => deleteItem.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));

    assert.equal(document.querySelector('[role="group"]'), null);
    assert.equal(trigger.getAttribute("aria-disabled"), "true");
    await click(trigger);
    assert.equal(document.querySelector('[role="group"]'), null);
    assert.equal(requests, 1);

    await act(async () => {
      finishDelete();
      await pendingDelete;
    });
  } finally {
    finishDelete();
    await view.unmount();
    globalThis.fetch = originalFetch;
  }
});

test("failed destructive actions restore focus when their trigger remains", async () => {
  const originalFetch = globalThis.fetch;
  const cases = [
    {
      action: "Stop",
      session: { ...baseSession, transient: true },
      response: () => new Response(null, { status: 500 }),
    },
    {
      action: "Delete",
      session: baseSession,
      response: () => { throw new Error("network failure"); },
    },
  ];

  const focusResults = [];
  try {
    for (const scenario of cases) {
      globalThis.fetch = async () => scenario.response();
      const view = await mountItem(scenario.session, { isActive: true });
      const trigger = view.container.querySelector("button[aria-controls]");
      try {
        await click(trigger);
        const action = [...document.querySelectorAll('[role="group"] button')].find((button) => button.textContent === scenario.action);
        action.focus();
        await click(action);
        focusResults.push([document.activeElement, trigger]);
      } finally {
        await view.unmount();
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
  for (const [focused, trigger] of focusResults) assert.equal(focused, trigger);
});

test("Delete treats 404 and 500 responses as failures", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const status of [404, 500]) {
      globalThis.fetch = async () => new Response(null, { status });
      let deleted = false;
      const view = await mountItem(baseSession, { isActive: true, onDeleted: () => { deleted = true; } });
      const trigger = view.container.querySelector("button[aria-controls]");
      let focused;
      try {
        await click(trigger);
        const deleteItem = [...document.querySelectorAll('[role="group"] button')].find((button) => button.textContent === "Delete");
        deleteItem.focus();
        await click(deleteItem);
        focused = document.activeElement;
      } finally {
        await view.unmount();
      }
      assert.equal(deleted, false);
      assert.equal(focused, trigger);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Rename does not report success for a non-2xx response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 500 });
  let renamed = false;
  const view = await mountItem(baseSession, { onRenamed: () => { renamed = true; } });
  try {
    await click(view.container.querySelector("button[aria-controls]"));
    await click([...document.querySelectorAll('[role="group"] button')].find((button) => button.textContent === "Rename"));
    const input = view.container.querySelector("input");
    await act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, "New name");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    assert.equal(renamed, false);
    assert.equal(document.activeElement, view.container.querySelector("button[aria-controls]"));
  } finally {
    await view.unmount();
    globalThis.fetch = originalFetch;
  }
});

test("delayed failures cannot restore focus after actions become unavailable", async () => {
  const originalFetch = globalThis.fetch;
  const outside = document.createElement("button");
  document.body.append(outside);
  try {
    for (const scenario of [
      { action: "Stop", session: { ...baseSession, transient: true } },
      { action: "Delete", session: baseSession },
    ]) {
      let finishRequest;
      globalThis.fetch = () => new Promise((resolve) => { finishRequest = resolve; });
      const view = await mountItem(scenario.session, { isActive: true });
      try {
        await click(view.container.querySelector("button[aria-controls]"));
        const action = [...document.querySelectorAll('[role="group"] button')].find((button) => button.textContent === scenario.action);
        action.focus();
        await click(action, { shiftKey: true });

        await view.rerender(scenario.session, { isActive: true, actionsAvailable: false });
        outside.focus();
        await act(async () => {
          finishRequest(new Response(null, { status: 500 }));
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
        assert.equal(document.activeElement, outside);

        await view.rerender(scenario.session, { isActive: true, actionsAvailable: true });
        assert.equal(document.activeElement, outside);
      } finally {
        await view.unmount();
      }
    }
  } finally {
    outside.remove();
    globalThis.fetch = originalFetch;
  }
});

test("Rename Escape restores the action trigger", async () => {
  const view = await mountItem(baseSession);
  try {
    const trigger = view.container.querySelector("button[aria-controls]");
    await click(trigger);
    const rename = [...document.querySelectorAll('[role="group"] button')].find((button) => button.textContent === "Rename");
    await click(rename);

    const input = view.container.querySelector("input");
    assert.equal(document.activeElement, input);
    await pressKey(input, "Escape");
    assert.equal(view.container.querySelector("input"), null);
    assert.equal(document.activeElement, view.container.querySelector("button[aria-controls]"));
  } finally {
    await view.unmount();
  }
});

test("focused inline action surfaces expose their accessible context", async () => {
  const view = await mountItem(baseSession, { isActive: true });
  try {
    await click(view.container.querySelector("button[aria-controls]"));
    await click([...document.querySelectorAll('[role="group"] button')].find((button) => button.textContent === "Rename"));

    const input = view.container.querySelector("input");
    assert.equal(accessibleName(input), "Rename session abcdef123456");
  } finally {
    await view.unmount();
  }
});

test("unavailable actions close inline surfaces without restoring focus into hidden UI", async () => {
  for (const action of ["Rename", "Stop", "Delete"]) {
    const view = await mountItem(baseSession, { isActive: true });
    try {
      await click(view.container.querySelector("button[aria-controls]"));
      const item = [...document.querySelectorAll('[role="group"] button')].find((button) => button.textContent === action);
      await click(item);
      assert.equal(view.container.contains(document.activeElement), true);

      await view.rerender(baseSession, { isActive: true, actionsAvailable: false });
      assert.equal(document.querySelector('[role="group"]'), null);
      assert.equal(view.container.querySelector("input"), null);
      assert.equal(view.container.querySelector("button[aria-controls]"), null);
      assert.equal(view.container.contains(document.activeElement), false);

      await view.rerender(baseSession, { isActive: true, actionsAvailable: true });
      assert.equal(view.container.querySelector("button[aria-controls]").getAttribute("aria-expanded"), "false");
      assert.doesNotMatch(view.container.textContent, /Stop active work|Delete abcdef123456\?/);
    } finally {
      await view.unmount();
    }
  }
});

test("reopening actions never applies trigger focus deferred during hiding", async () => {
  const view = await mountItem(baseSession, { isActive: true });
  const outside = document.createElement("button");
  document.body.append(outside);
  try {
    await click(view.container.querySelector("button[aria-controls]"));
    await click([...document.querySelectorAll('[role="group"] button')].find((button) => button.textContent === "Rename"));
    const input = view.container.querySelector("input");
    input.focus();

    await view.rerenderAfter(
      () => input.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })),
      baseSession,
      { isActive: true, actionsAvailable: false },
    );
    outside.focus();
    await view.rerender(baseSession, { isActive: true, actionsAvailable: true });
    assert.equal(document.activeElement, outside);
  } finally {
    outside.remove();
    await view.unmount();
  }
});

test("hiding a dirty Rename surface discards the draft without PATCHing it", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push([url, init?.method]);
    return new Response(null, { status: 200 });
  };

  const view = await mountItem(baseSession);
  try {
    await click(view.container.querySelector("button[aria-controls]"));
    await click([...document.querySelectorAll('[role="group"] button')].find((button) => button.textContent === "Rename"));
    const input = view.container.querySelector("input");
    await act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, "Dirty draft");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    assert.equal(input.value, "Dirty draft");
    await view.rerender(baseSession);
    assert.equal(view.container.querySelector("input").value, "Dirty draft");

    await view.rerender(baseSession, { actionsAvailable: false });
    assert.deepEqual(requests, []);
  } finally {
    await view.unmount();
    globalThis.fetch = originalFetch;
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

test("boundary Tab closes the popup and follows the trigger's logical position", async () => {
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

test("the popup is a native popover, so the browser owns dismissal", async () => {
  // Light dismiss, Escape-to-close and top-layer stacking come from the UA.
  // happy-dom implements none of them, so this asserts the contract we now
  // depend on rather than the behaviour, which only a real browser can show.
  const view = await mountItem(baseSession, { isActive: true });
  try {
    await click(view.container.querySelector("button[aria-controls]"));
    const group = document.querySelector('[role="group"]');
    assert.equal(group.getAttribute("popover"), "auto");
    // Positioning stays ours; the UA sheet centres with inset:0/margin:auto.
    assert.equal(group.style.position, "fixed");
    assert.equal(group.style.inset, "auto");
    assert.equal(group.style.margin, "0px");
  } finally {
    await view.unmount();
  }
});

test("no scroll dismisses the popup now that light dismiss is the UA's", async () => {
  const view = await mountItem(baseSession, { isActive: true });
  try {
    const trigger = view.container.querySelector("button[aria-controls]");
    await click(trigger);
    const group = document.querySelector('[role="group"]');
    const action = group.querySelector("button");
    action.focus();

    await act(() => group.dispatchEvent(new Event("scroll")));
    assert.equal(document.querySelector('[role="group"]') === group, true);
    assert.equal(document.activeElement === action, true);

    // A scroll container that holds the trigger used to dismiss. It cannot
    // drop a press any more, and the popup follows its anchor instead.
    await act(() => view.container.dispatchEvent(new Event("scroll")));
    assert.equal(document.querySelector('[role="group"]') === group, true);
  } finally {
    await view.unmount();
  }
});

test("the trigger closes its own popup when light dismiss got there first", async () => {
  // iOS delivers the popover's toggle event before the trigger's click, so the
  // click handler saw a closed popup and reopened it -- the trigger could not
  // close its own menu. Chromium delivers them the other way round, which is
  // why this only reproduced on the phone.
  const view = await mountItem(baseSession);
  try {
    const trigger = view.container.querySelector("button[aria-controls]");
    await click(trigger);
    const group = document.querySelector('[role="group"]');
    assert.ok(group);

    // The press, then the browser's light dismiss, then the click it produced.
    await act(() => trigger.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true })));
    await act(() => {
      const toggle = new window.Event("toggle");
      toggle.newState = "closed";
      group.dispatchEvent(toggle);
    });
    assert.equal(document.querySelector('[role="group"]'), null);

    await click(trigger);
    assert.equal(document.querySelector('[role="group"]'), null);
  } finally {
    await view.unmount();
  }
});

test("a blur that focuses nothing keeps the popup mounted", async () => {
  // iOS does not focus a button on tap: it blurs whatever had focus and
  // reports no relatedTarget. The popup opens with focus on its first action,
  // so treating that as focus leaving closed it before the click landed.
  const view = await mountItem(baseSession, { isActive: true });
  try {
    const trigger = view.container.querySelector("button[aria-controls]");
    await click(trigger);
    const group = document.querySelector('[role="group"]');
    const stop = [...group.querySelectorAll("button")].find((button) => button.textContent === "Stop");
    assert.equal(document.activeElement === stop, true);

    await act(() => stop.blur());
    assert.equal(document.querySelector('[role="group"]') === group, true);
  } finally {
    await view.unmount();
  }
});

test("a window scroll that moves nothing keeps the popup mounted", async () => {
  // iOS fires a window-level scroll alongside the resize for every URL-bar and
  // keyboard animation. Nothing moved, so dismissing there dropped the press
  // onto the row the popup was covering instead of running Stop.
  const view = await mountItem(baseSession, { isActive: true });
  try {
    const trigger = view.container.querySelector("button[aria-controls]");
    await click(trigger);
    const group = document.querySelector('[role="group"]');
    const action = group.querySelector("button");
    action.focus();

    await act(() => window.dispatchEvent(new Event("scroll")));
    assert.equal(document.querySelector('[role="group"]') === group, true);
    assert.equal(document.activeElement === action, true);

    await act(() => document.dispatchEvent(new Event("scroll")));
    assert.equal(document.querySelector('[role="group"]') === group, true);
  } finally {
    await view.unmount();
  }
});

test("a resize keeps the popup mounted so a press already under way still lands", async () => {
  // A phone fires resize for every URL-bar and keyboard animation. Unmounting
  // the popup mid-tap sent the press through to the row underneath instead of
  // running Stop.
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push([String(url), init?.method]);
    return new Response(null, { status: 200 });
  };
  const view = await mountItem(baseSession, { isActive: true });
  try {
    const trigger = view.container.querySelector("button[aria-controls]");
    await click(trigger);
    const group = document.querySelector('[role="group"]');
    const stop = [...group.querySelectorAll("button")].find((button) => button.textContent === "Stop");
    stop.focus();

    await act(() => window.dispatchEvent(new Event("resize")));
    assert.equal(document.querySelector('[role="group"]') === group, true);
    assert.equal(document.activeElement === stop, true);

    await click(stop);
    assert.deepEqual(requests, [["/api/agent/abcdef1234567890", "DELETE"]]);
  } finally {
    await view.unmount();
    globalThis.fetch = originalFetch;
  }
});

test("the popup follows a moved anchor before paint and holds still for an unchanged one", async () => {
  const view = await mountItem(baseSession);
  try {
    const trigger = view.container.querySelector("button[aria-controls]");
    let top = 20;
    trigger.getBoundingClientRect = () => ({ top, right: 200, bottom: top + 28, left: 172, width: 28, height: 28 });
    await click(trigger);
    const group = document.querySelector('[role="group"]');
    const action = group.querySelector("button");
    action.focus();

    await view.rerender({ ...baseSession });
    assert.equal(document.querySelector('[role="group"]') === group, true);
    assert.equal(group.style.top, "52px");
    assert.equal(document.activeElement === action, true);

    top = 74;
    await view.rerender({ ...baseSession });
    assert.equal(document.querySelector('[role="group"]') === group, true);
    assert.equal(group.style.top, "106px");
    assert.equal(document.activeElement === action, true);
  } finally {
    await view.unmount();
  }
});

test("the action popup fits above its trigger with larger touch targets", async () => {
  const originalMatchMedia = window.matchMedia;
  window.matchMedia = (query) => query === "(pointer: coarse)"
    ? { matches: true } : originalMatchMedia.call(window, query);
  const view = await mountItem(baseSession, { isActive: true });
  try {
    const trigger = view.container.querySelector("button[aria-controls]");
    const top = window.innerHeight - 50;
    trigger.getBoundingClientRect = () => ({ top, bottom: top + 28, left: 172, right: 200 });
    await click(trigger);
    const popup = document.querySelector('[role="group"]');
    // Three 44px touch targets, the surface border/padding, and the trigger gap.
    assert.equal(popup.style.top, `${top - 146}px`);
    assert.deepEqual([...popup.querySelectorAll("button")].map(button => button.textContent), ["Stop", "Rename", "Delete"]);
  } finally {
    await view.unmount();
    window.matchMedia = originalMatchMedia;
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

test("Escape dismisses the menu and restores trigger focus", async () => {
  // The outside press that used to be asserted here is the UA's light dismiss
  // now; see the native-popover test. Cleanup stays in a finally so a failed
  // assertion cannot leave a mounted root behind and hang the whole file.
  const view = await mountItem(baseSession);
  try {
    const trigger = view.container.querySelector("button[aria-controls]");
    await click(trigger);
    await act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    assert.equal(document.querySelector('[role="group"]'), null);
    assert.equal(document.activeElement, trigger);
  } finally {
    await view.unmount();
  }
});

test("menu actions run without selecting the row", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push([String(url), init?.method]);
    return new Response(null, { status: 200 });
  };
  try {
    for (const action of ["Rename", "Stop", "Delete"]) {
      let selections = 0;
      const view = await mountItem(baseSession, { isActive: true, onClick: () => { selections += 1; } });
      await click(view.container.querySelector("button[aria-controls]"));
      const item = [...document.querySelectorAll('[role="group"] button')].find((button) => button.textContent === action);
      await click(item);

      if (action === "Rename") assert.ok(view.container.querySelector("input"));
      assert.equal(selections, 0);
      await view.unmount();
    }
    assert.deepEqual(requests, [
      ["/api/agent/abcdef1234567890", "DELETE"],
      ["/api/sessions/abcdef1234567890", "DELETE"],
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the right column reserves room for message counts without truncating them", async () => {
  const session = { ...baseSession, name: "A very long session title that must stay truncated", messageCount: 1000 };
  const view = await mountItem(session);
  const row = view.container.firstElementChild;
  const trigger = view.container.querySelector("button[aria-controls]");
  const rail = trigger.parentElement;
  const title = view.container.querySelector('[title="A very long session title that must stay truncated"]');
  const left = title.parentElement;
  const leftStyle = left.getAttribute("style");

  assert.equal(row.style.height, "54px");
  assert.equal(rail.style.minWidth, "64px");
  assert.equal(rail.style.height, "54px");
  assert.equal(rail.style.flexDirection, "column");
  assert.equal(rail.style.justifyContent, "space-between");
  assert.equal(rail.style.alignItems, "flex-end");
  const count = rail.lastElementChild;
  assert.equal(count.textContent, "1000 msgs");
  assert.equal(count.title, "1000 msgs");
  assert.equal(count.style.maxWidth, "");
  assert.equal(count.style.overflow, "");
  assert.equal(count.style.textOverflow, "");

  await view.rerender({ ...session, messageCount: undefined });
  assert.equal(trigger.parentElement, rail);
  assert.equal(left.getAttribute("style"), leftStyle);
  assert.equal(rail.querySelector('[aria-label="Loading..."]').textContent, "…");

  await click(trigger);
  // No portal any more: popover puts it in the top layer, so it escapes the
  // row's clipping and stacking without moving in the tree.
  assert.equal(document.querySelector('[role="group"]').getAttribute("popover"), "auto");
  assert.equal(left.getAttribute("style"), leftStyle);
  await act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  assert.equal(left.getAttribute("style"), leftStyle);
  await view.unmount();
});

test("the shortcut hint replaces the right-rail trigger and closes its open menu", async () => {
  const view = await mountItem(baseSession);
  try {
    const row = view.container.firstElementChild;
    const trigger = view.container.querySelector("button[aria-controls]");
    await click(trigger);
    document.querySelector('[role="group"] button').focus();

    await view.rerender(baseSession, { shortcutLabel: "Ctrl+1" });

    const hint = view.container.querySelector("kbd");
    assert.equal(hint.textContent, "Ctrl+1");
    assert.equal(hint.parentElement, row.lastElementChild);
    assert.equal(view.container.querySelector("button[aria-controls]"), null);
    assert.equal(document.querySelector('[role="group"]'), null);
  } finally {
    await view.unmount();
  }
});

test("inactive session titles are muted", async () => {
  const session = { ...baseSession, name: "Quiet session" };
  const view = await mountItem(session, { isActive: false });
  try {
    const title = view.container.querySelector('[title="Quiet session"]');
    assert.equal(title.style.color, "var(--text-muted)");
    await view.rerender(session, { isActive: true });
    assert.equal(view.container.querySelector('[title="Quiet session"]').style.color, "var(--text)");
  } finally {
    await view.unmount();
  }
});

test("a selected running worktree session shows running, unread, and branch state", () => {
  const html = renderItem(
    { ...baseSession, name: "Feature work", isWorktree: true, branch: "feature/seams", messageCount: undefined },
    { isSelected: true, isActive: true, isRunning: true, isUnread: true },
  );
  assert.match(html, /aria-label="Agent running… · New activity"/);
  assert.equal((html.match(/class="session-indicator-unread"/g) ?? []).length, 1);
  assert.match(html, /aria-label="Loading\.\.\."/);
  assert.match(html, /title="Worktree: \/tmp\/project"/);
  assert.match(html, />feature\/seams</);
  assert.match(html, /border-left:2px solid var\(--accent\)/);
});


test("unread activity decorates one status indicator and clears when read", async () => {
  for (const [props, label, shape, color] of [
    [{ isActive: true }, "Session active", "circle", "var(--success)"],
    [{ isActive: false }, "Session stopped", "circle", "var(--text-dim)"],
    [{ isActive: true, isRunning: true }, "Agent running…", "path", "var(--accent)"],
  ]) {
    const view = await mountItem(baseSession, { ...props, isUnread: true });
    try {
      const indicator = view.container.querySelector(`[aria-label="${label} · New activity"]`);
      assert.ok(indicator);
      assert.equal(indicator.style.color, "var(--info)");
      assert.ok(indicator.querySelector(shape));
      assert.equal(indicator.parentElement.querySelectorAll("svg").length, 1);
      assert.equal(indicator.className, "session-indicator-unread");
      await view.rerender(baseSession, { ...props, isUnread: false });
      assert.equal(view.container.querySelector(".session-indicator-unread"), null);
      assert.equal(view.container.querySelector(`[aria-label="${label}"]`).style.color, color);
    } finally {
      await view.unmount();
    }
  }
});
