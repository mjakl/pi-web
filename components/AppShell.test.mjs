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
