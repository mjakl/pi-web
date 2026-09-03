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
  Event: window.Event,
  MouseEvent: window.MouseEvent,
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
