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
      React.createElement(AppShell),
    ),
  );
}

test("follows system theme changes while the app shell is mounted", async () => {
  const originalMatchMedia = window.matchMedia.bind(window);
  const listeners = new Set();
  let prefersDark = false;
  window.matchMedia = (query) => query === "(prefers-color-scheme: dark)"
    ? {
        get matches() { return prefersDark; },
        media: query,
        addEventListener(type, listener) { if (type === "change") listeners.add(listener); },
        removeEventListener(type, listener) { if (type === "change") listeners.delete(listener); },
      }
    : originalMatchMedia(query);
  localStorage.setItem("pi-theme", "auto");

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(appShell());
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    prefersDark = true;
    await act(() => listeners.forEach((listener) => listener(new Event("change"))));
    assert.equal(document.documentElement.classList.contains("dark"), true);
  } finally {
    await act(() => root.unmount());
    container.remove();
    document.documentElement.classList.remove("dark");
    localStorage.removeItem("pi-theme");
    window.matchMedia = originalMatchMedia;
  }
});

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

function refreshSucceeded(container) {
  return container.querySelector('button[title="Refresh"] polyline') !== null;
}

function createRefreshHarness({ selected = true, provideTranscriptRefresh = true } = {}) {
  const originalFetch = globalThis.fetch;
  const inventoryRequests = [];
  const transcriptRequests = [];
  globalThis.fetch = async (url) => {
    if (String(url).startsWith("/api/sessions")) {
      const request = deferred();
      inventoryRequests.push(request);
      return request.promise;
    }
    if (url === "/api/home") return Response.json({ home: "/tmp" });
    if (url === "/api/agent/running") return emptyInventoryResponse();
    return Response.json({});
  };

  let nextAttempt = 0;
  let refreshKey = 0;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = () => act(async () => {
    root.render(React.createElement(SessionSidebar, {
      selectedSessionId: selected ? sidebarSession.id : null,
      onSelectSession() {},
      beginSessionInventoryAttempt: () => ++nextAttempt,
      refreshKey,
      actionsAvailable: true,
      ...(provideTranscriptRefresh ? {
        onRefreshSelectedSession: () => {
          const request = deferred();
          transcriptRequests.push(request);
          return request.promise;
        },
      } : {}),
    }));
    await Promise.resolve();
  });

  return {
    inventoryRequests,
    transcriptRequests,
    container,
    render,
    clickRefresh: () => click(container.querySelector('button[title="Refresh"]')),
    triggerBackgroundLoad: async () => {
      refreshKey += 1;
      await render();
    },
    cleanup: async () => {
      await act(() => root.unmount());
      container.remove();
      globalThis.fetch = originalFetch;
    },
  };
}

async function settle(request, value) {
  await act(async () => {
    request.resolve(value);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
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
    const sidebarControl = sidebar.querySelector("button:not(:disabled)");
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

for (const firstCompletion of ["inventory", "transcript"]) {
  test(`manual Refresh waits when ${firstCompletion} completes first`, async () => {
    const harness = createRefreshHarness();
    try {
      await harness.render();
      await settle(harness.inventoryRequests[0], emptyInventoryResponse());
      await harness.clickRefresh();

      if (firstCompletion === "inventory") {
        await settle(harness.inventoryRequests[1], emptyInventoryResponse());
      } else {
        await settle(harness.transcriptRequests[0], true);
      }
      assert.equal(refreshSucceeded(harness.container), false);

      if (firstCompletion === "inventory") {
        await settle(harness.transcriptRequests[0], true);
      } else {
        await settle(harness.inventoryRequests[1], emptyInventoryResponse());
      }
      assert.equal(refreshSucceeded(harness.container), true);
    } finally {
      await harness.cleanup();
    }
  });
}

for (const failedPhase of ["inventory", "transcript"]) {
  test(`manual Refresh does not show success when ${failedPhase} fails`, async () => {
    const harness = createRefreshHarness();
    try {
      await harness.render();
      await settle(harness.inventoryRequests[0], emptyInventoryResponse());
      await harness.clickRefresh();

      await settle(
        harness.inventoryRequests[1],
        failedPhase === "inventory"
          ? new Response(null, { status: 500 })
          : emptyInventoryResponse(),
      );
      await settle(harness.transcriptRequests[0], failedPhase !== "transcript");
      assert.equal(refreshSucceeded(harness.container), false);
      assert.equal(
        harness.container.textContent.includes("HTTP 500"),
        failedPhase === "inventory",
      );
    } finally {
      await harness.cleanup();
    }
  });
}

test("manual Refresh needs only inventory success when no session is selected", async () => {
  const harness = createRefreshHarness({ selected: false });
  try {
    await harness.render();
    await settle(harness.inventoryRequests[0], emptyInventoryResponse());
    await harness.clickRefresh();
    await settle(harness.inventoryRequests[1], emptyInventoryResponse());
    assert.equal(harness.transcriptRequests.length, 0);
    assert.equal(refreshSucceeded(harness.container), true);
  } finally {
    await harness.cleanup();
  }
});

test("manual Refresh does not show success when the selected transcript callback is unavailable", async () => {
  const harness = createRefreshHarness({ provideTranscriptRefresh: false });
  try {
    await harness.render();
    await settle(harness.inventoryRequests[0], emptyInventoryResponse());
    await harness.clickRefresh();
    await settle(harness.inventoryRequests[1], emptyInventoryResponse());
    assert.equal(refreshSucceeded(harness.container), false);
  } finally {
    await harness.cleanup();
  }
});

test("a superseded manual Refresh cannot publish late success", async () => {
  const harness = createRefreshHarness();
  try {
    await harness.render();
    await settle(harness.inventoryRequests[0], emptyInventoryResponse());
    await harness.clickRefresh();
    await harness.clickRefresh();

    await settle(harness.inventoryRequests[2], new Response(null, { status: 500 }));
    await settle(harness.transcriptRequests[1], true);
    await settle(harness.transcriptRequests[0], true);
    await settle(harness.inventoryRequests[1], emptyInventoryResponse());
    assert.equal(refreshSucceeded(harness.container), false);
  } finally {
    await harness.cleanup();
  }
});

test("holding Ctrl reveals session shortcuts and a number selects that recent session", async () => {
  const originalFetch = globalThis.fetch;
  const sessions = Array.from({ length: 10 }, (_, index) => ({
    ...sidebarSession,
    id: `session-${index + 1}`,
    name: `Session ${index + 1}`,
    modified: `2026-09-01T10:${String(59 - index).padStart(2, "0")}:00.000Z`,
  }));
  globalThis.fetch = async (url) => {
    if (String(url).startsWith("/api/sessions")) {
      return Response.json({ sessions, activeSessionIds: [], runningSessionIds: [] });
    }
    if (url === "/api/home") return Response.json({ home: "/tmp" });
    if (url === "/api/agent/running") return emptyInventoryResponse();
    return Response.json({});
  };

  const selected = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(React.createElement(SessionSidebar, {
        selectedSessionId: null,
        onSelectSession: (session) => selected.push(session.id),
        beginSessionInventoryAttempt: () => 1,
        actionsAvailable: true,
      }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Control", ctrlKey: true })));
    assert.equal(container.querySelectorAll("kbd").length, 10);
    assert.equal(container.querySelector("kbd").textContent, "Ctrl+1");

    const shortcut = new KeyboardEvent("keydown", { key: "0", ctrlKey: true, cancelable: true });
    await act(() => window.dispatchEvent(shortcut));
    assert.equal(shortcut.defaultPrevented, true);
    assert.deepEqual(selected, ["session-10"]);

    await act(() => window.dispatchEvent(new KeyboardEvent("keyup", { key: "Control" })));
    assert.equal(container.querySelector("kbd"), null);
  } finally {
    await act(() => root.unmount());
    container.remove();
    globalThis.fetch = originalFetch;
  }
});

test("background inventory completion does not show manual Refresh success", async () => {
  const harness = createRefreshHarness({ selected: false });
  try {
    await harness.render();
    await settle(harness.inventoryRequests[0], emptyInventoryResponse());
    await harness.triggerBackgroundLoad();
    await settle(harness.inventoryRequests[1], emptyInventoryResponse());
    assert.equal(refreshSucceeded(harness.container), false);
  } finally {
    await harness.cleanup();
  }
});

test("sidebar Activate starts a saved session without a prompt, reports failure, and allows retry", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  let activationResponse = Promise.resolve(Response.json({ error: "Startup failed" }, { status: 500 }));
  globalThis.fetch = async (url, init) => {
    if (url === `/api/agent/${sidebarSession.id}`) {
      requests.push([url, init.method, JSON.parse(init.body)]);
      return activationResponse;
    }
    if (String(url).startsWith("/api/sessions")) {
      return Response.json({ sessions: [sidebarSession], activeSessionIds: [], runningSessionIds: [] });
    }
    if (url === "/api/agent/running") return Response.json({ activeSessionIds: [], runningSessionIds: [] });
    if (url === "/api/home") return Response.json({ home: "/tmp" });
    return Response.json({});
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let selections = 0;
  let activeIds = new Set();
  try {
    await act(async () => {
      root.render(React.createElement(SessionSidebar, {
        selectedSessionId: sidebarSession.id,
        onSelectSession: () => { selections += 1; },
        onActiveSessionIdsChange: (ids) => { activeIds = ids; },
        beginSessionInventoryAttempt: () => 1,
        actionsAvailable: true,
      }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const initialSelections = selections;
    const trigger = () => container.querySelector(".session-row button[aria-controls]");
    const activate = async () => {
      await click(trigger());
      await click([...container.querySelectorAll('[role="group"] button')].find((button) => button.textContent === "Activate"));
    };
    await activate();
    assert.match(container.textContent, /Could not activate session: Startup failed/);
    assert.equal(activeIds.has(sidebarSession.id), false);
    assert.ok(container.querySelector('[aria-label="Session stopped"]'));
    assert.equal(document.activeElement, trigger());

    const pending = deferred();
    activationResponse = pending.promise;
    await activate();
    assert.equal(trigger().getAttribute("aria-disabled"), "true");
    await click(trigger());
    assert.equal(container.querySelector('[role="group"]'), null);
    assert.equal(requests.length, 2);
    await act(async () => pending.resolve(Response.json({ success: true, data: {} })));
    assert.equal(activeIds.has(sidebarSession.id), true);
    assert.ok(container.querySelector('[aria-label="Session active"]'));
    assert.doesNotMatch(container.textContent, /Could not activate session/);
    assert.equal(selections, initialSelections);
    assert.deepEqual(requests, Array(2).fill([`/api/agent/${sidebarSession.id}`, "POST", { type: "get_state" }]));
    await click(trigger());
    assert.deepEqual([...container.querySelectorAll('[role="group"] button')].map((button) => button.textContent), ["Stop", "Rename", "Delete"]);
  } finally {
    await act(() => root.unmount());
    container.remove();
    globalThis.fetch = originalFetch;
  }
});

test("sidebar puts running then active sessions first and shortcuts follow live ordering", async () => {
  const originalFetch = globalThis.fetch;
  const sessions = ["stopped-new", "active-new", "running-new", "stopped-old", "active-old", "running-old"]
    .map((id, index) => ({
      ...sidebarSession,
      id,
      name: id,
      modified: `2026-09-01T10:0${5 - index}:00.000Z`,
    }));
  let activity = {
    activeSessionIds: ["active-new", "active-old", "running-new", "running-old"],
    runningSessionIds: ["running-new", "running-old"],
  };
  globalThis.fetch = async (url) => {
    if (String(url).startsWith("/api/sessions")) return Response.json({ sessions, ...activity });
    if (url === "/api/agent/running") return Response.json(activity);
    if (url === "/api/home") return Response.json({ home: "/tmp" });
    return Response.json({});
  };
  const selected = [];
  const inventories = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const rowIds = () => [...container.querySelectorAll(".session-row")].map((row) => row.dataset.sessionInventoryId);
  try {
    await act(async () => {
      root.render(React.createElement(SessionSidebar, {
        selectedSessionId: "running-new",
        onSelectSession: (session) => selected.push(session.id),
        beginSessionInventoryAttempt: () => 1,
        onSessionsChange: (items) => inventories.push(items.map((item) => item.id)),
        actionsAvailable: true,
      }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.deepEqual(rowIds(), ["running-new", "running-old", "active-new", "active-old", "stopped-new", "stopped-old"]);
    assert.deepEqual(inventories.at(-1), sessions.map((session) => session.id));

    activity = { activeSessionIds: ["active-old", "running-old"], runningSessionIds: ["active-old"] };
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.deepEqual(rowIds(), ["active-old", "running-old", "stopped-new", "active-new", "running-new", "stopped-old"]);
    await act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "1", ctrlKey: true, cancelable: true })));
    assert.equal(selected.at(-1), "active-old");
    assert.equal(container.querySelector("kbd").textContent, "Ctrl+1");
  } finally {
    await act(() => root.unmount());
    container.remove();
    globalThis.fetch = originalFetch;
  }
});
