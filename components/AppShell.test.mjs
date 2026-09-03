import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { Window } from "happy-dom";
import { createJiti } from "jiti";

registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith(".css")) return nextLoad(url, context);
    return { format: "module", shortCircuit: true, source: "export default {};" };
  },
});

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
  MutationObserver: window.MutationObserver,
  localStorage: window.localStorage,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  IS_REACT_ACT_ENVIRONMENT: true,
});

globalThis.fetch = async () => Response.json({
  sessions: [],
  activeSessionIds: [],
  runningSessionIds: [],
  projects: [],
});

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { act } = React;
const { createRoot } = await jiti.import("react-dom/client");
const { AppRouterContext } = await jiti.import("next/dist/shared/lib/app-router-context.shared-runtime.js");
const { SearchParamsContext } = await jiti.import("next/dist/shared/lib/hooks-client-context.shared-runtime.js");
const { AppShell } = await jiti.import("./AppShell.tsx");
const { SessionSidebar } = await jiti.import("./SessionSidebar.tsx");

const router = {
  back() {},
  forward() {},
  refresh() {},
  push() {},
  replace() {},
  prefetch() {},
};

function appShell() {
  return React.createElement(
    AppRouterContext.Provider,
    { value: router },
    React.createElement(
      SearchParamsContext.Provider,
      { value: new URLSearchParams() },
      React.createElement(AppShell, { piVersion: "test" }),
    ),
  );
}

const sidebarSession = {
  id: "sidebar-session",
  path: "/tmp/sessions/sidebar-session.jsonl",
  cwd: "/tmp/project",
  created: "2026-09-01T10:00:00.000Z",
  modified: "2026-09-01T10:05:00.000Z",
  fileSize: 100,
  name: "Sidebar session",
  firstMessage: "Test sidebar actions",
  messageCount: 1,
};

async function click(element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function sidebarForInventoryTest(refreshKey, beginSessionInventoryAttempt, onSessionsChange) {
  return React.createElement(SessionSidebar, {
    piVersion: "test",
    selectedSessionId: null,
    onSelectSession() {},
    beginSessionInventoryAttempt,
    onSessionsChange,
    refreshKey,
    actionsAvailable: true,
  });
}

function emptyInventoryResponse() {
  return Response.json({ sessions: [], activeSessionIds: [], runningSessionIds: [] });
}

function createInventoryHarness(onSessionsChange) {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    if (String(url).startsWith("/api/sessions")) {
      const request = deferred();
      requests.push(request);
      return request.promise;
    }
    if (url === "/api/home") return Response.json({ home: "/tmp" });
    if (url === "/api/agent/running") return emptyInventoryResponse();
    return Response.json({});
  };

  let nextAttempt = 0;
  const begin = () => ++nextAttempt;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  return {
    requests,
    container,
    get nextAttempt() { return nextAttempt; },
    render: (refreshKey) => act(async () => {
      root.render(sidebarForInventoryTest(refreshKey, begin, onSessionsChange));
      await Promise.resolve();
    }),
    cleanup: async () => {
      await act(() => root.unmount());
      container.remove();
      globalThis.fetch = originalFetch;
    },
  };
}

test("a closed sidebar is inert and hidden from accessibility navigation until reopened", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  try {
    await act(() => root.render(appShell()));
    const sidebar = container.querySelector("#session-sidebar");
    const sidebarControl = sidebar.querySelector("button");
    assert.equal(sidebar.hasAttribute("inert"), false);
    assert.equal(sidebar.getAttribute("aria-hidden"), null);
    sidebarControl.focus();
    assert.equal(document.activeElement === sidebarControl, true);

    const hide = container.querySelector('button[aria-label="Hide sidebar"]');
    await act(() => hide.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    assert.match(sidebar.className, /sidebar-closed/);
    assert.equal(sidebar.hasAttribute("inert"), true);
    assert.equal(sidebar.getAttribute("aria-hidden"), "true");
    hide.focus();
    sidebarControl.focus();
    assert.equal(document.activeElement === sidebarControl, false);

    const show = container.querySelector('button[aria-label="Show sidebar"]');
    await act(() => show.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    assert.match(sidebar.className, /sidebar-open/);
    assert.equal(sidebar.hasAttribute("inert"), false);
    assert.equal(sidebar.getAttribute("aria-hidden"), null);
    sidebarControl.focus();
    assert.equal(document.activeElement === sidebarControl, true);
  } finally {
    await act(() => root.unmount());
    container.remove();
  }
});

test("closing the actual sidebar removes its body portal and reopening starts with actions closed", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).startsWith("/api/sessions")) return Response.json({
      sessions: [sidebarSession],
      activeSessionIds: [],
      runningSessionIds: [],
    });
    if (url === "/api/home") return Response.json({ home: "/tmp" });
    if (url === "/api/agent/running") return Response.json({ activeSessionIds: [], runningSessionIds: [] });
    return Response.json({});
  };

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(appShell());
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const trigger = container.querySelector('[aria-label="Session actions for Sidebar session"]');
    assert.ok(trigger);
    await click(trigger);
    assert.ok(document.body.querySelector('[role="group"][aria-label="Session actions for Sidebar session"]'));

    await click(container.querySelector('button[aria-label="Hide sidebar"]'));
    assert.equal(document.body.querySelector('[role="group"][aria-label="Session actions for Sidebar session"]'), null);

    await click(container.querySelector('button[aria-label="Show sidebar"]'));
    const reopenedTrigger = container.querySelector('[aria-label="Session actions for Sidebar session"]');
    assert.equal(reopenedTrigger.getAttribute("aria-expanded"), "false");
    await click(reopenedTrigger);
    assert.ok(document.body.querySelector('[role="group"][aria-label="Session actions for Sidebar session"]'));
  } finally {
    await act(() => root.unmount());
    container.remove();
    globalThis.fetch = originalFetch;
  }
});

test("session inventory publishes the token issued before its delayed fetch", async () => {
  const publications = [];
  const harness = createInventoryHarness((sessions, inventoryAttempt) => {
    publications.push({ sessions, inventoryAttempt });
  });
  try {
    await harness.render(0);
    assert.equal(harness.nextAttempt, 1);
    await act(async () => {
      harness.requests[0].resolve(emptyInventoryResponse());
      await Promise.resolve();
    });
    assert.equal(publications.at(-1).inventoryAttempt, 1);
  } finally {
    await harness.cleanup();
  }
});

test("a stale inventory failure cannot replace a newer success or its loading state", async () => {
  const harness = createInventoryHarness();
  try {
    await harness.render(0);
    await harness.render(1);
    await act(async () => {
      harness.requests[1].resolve(emptyInventoryResponse());
      await Promise.resolve();
    });
    assert.equal(harness.container.textContent.includes("Loading..."), false);

    await act(async () => {
      harness.requests[0].reject(new Error("stale inventory failure"));
      await Promise.resolve();
    });
    assert.equal(harness.container.textContent.includes("stale inventory failure"), false);
    assert.equal(harness.container.textContent.includes("Loading..."), false);
  } finally {
    await harness.cleanup();
  }
});

test("an older pending success may recover from a newer inventory failure", async () => {
  const harness = createInventoryHarness();
  try {
    await harness.render(0);
    await harness.render(1);
    await act(async () => {
      harness.requests[1].reject(new Error("current inventory failure"));
      await Promise.resolve();
    });
    assert.equal(harness.container.textContent.includes("current inventory failure"), true);
    assert.equal(harness.container.textContent.includes("Loading..."), false);

    await act(async () => {
      harness.requests[0].resolve(emptyInventoryResponse());
      await Promise.resolve();
    });
    assert.equal(harness.container.textContent.includes("current inventory failure"), false);
    assert.equal(harness.container.textContent.includes("Loading..."), false);
  } finally {
    await harness.cleanup();
  }
});

test("a stale inventory abort cannot overwrite newer completion state", async () => {
  const harness = createInventoryHarness();
  try {
    await harness.render(0);
    await harness.render(1);
    await act(async () => {
      harness.requests[1].resolve(emptyInventoryResponse());
      await Promise.resolve();
    });
    await act(async () => {
      harness.requests[0].reject(new DOMException("stale abort", "AbortError"));
      await Promise.resolve();
    });
    assert.equal(harness.container.textContent.includes("stale abort"), false);
    assert.equal(harness.container.textContent.includes("Loading..."), false);
  } finally {
    await harness.cleanup();
  }
});

test("the current inventory failure reports its error and finishes loading", async () => {
  const harness = createInventoryHarness();
  try {
    await harness.render(0);
    await act(async () => {
      harness.requests[0].resolve(new Response(null, { status: 500 }));
      await Promise.resolve();
    });
    assert.equal(harness.container.textContent.includes("HTTP 500"), true);
    assert.equal(harness.container.textContent.includes("Loading..."), false);
  } finally {
    await harness.cleanup();
  }
});

test("the current inventory abort finishes loading without reporting an error", async () => {
  const harness = createInventoryHarness();
  try {
    await harness.render(0);
    await act(async () => {
      harness.requests[0].reject(new DOMException("current abort", "AbortError"));
      await Promise.resolve();
    });
    assert.equal(harness.container.textContent.includes("current abort"), false);
    assert.equal(harness.container.textContent.includes("Loading..."), false);
  } finally {
    await harness.cleanup();
  }
});
