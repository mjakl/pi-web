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
window.HTMLElement.prototype.scrollTo = function ({ top }) { this.scrollTop = top; };
Object.assign(globalThis, {
  window, document: window.document, Node: window.Node,
  HTMLElement: window.HTMLElement, HTMLButtonElement: window.HTMLButtonElement,
  Event: window.Event, MouseEvent: window.MouseEvent, localStorage: window.localStorage,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  IntersectionObserver: class { observe() {} disconnect() {} },
  ResizeObserver: class { observe() {} disconnect() {} },
  IS_REACT_ACT_ENVIRONMENT: true,
});

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { createRoot } = await jiti.import("react-dom/client");
const { ChatWindow } = await jiti.import("./ChatWindow.tsx");

const session = {
  id: "s1", path: "/tmp/s1.jsonl", cwd: "/tmp/project",
  created: "2026-09-04T00:00:00.000Z", modified: "2026-09-04T00:00:00.000Z",
};

function stubFetch() {
  globalThis.fetch = async () => Response.json({
    sessionId: "s1", filePath: "/tmp/s1.jsonl", info: session, totalActiveMs: 0,
    tree: [], leafId: "a", context: { messages: [], entryIds: [], hasMore: false },
  });
}

async function mount(props) {
  const display = [];
  const actions = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  // Stable identities, as AppShell's useCallback([]) handlers are. A fresh
  // callback per render would legitimately re-fire the publish effects and the
  // no-republish assertion below would be testing the test, not the component.
  const onChatDisplayChange = (d) => display.push(d);
  const onChatActionsChange = (a) => actions.push(a);
  const render = (extra) => React.createElement(ChatWindow, {
    newSessionCwd: "/tmp/project",
    newSessionDraftKey: "d",
    onChatDisplayChange,
    onChatActionsChange,
    ...props,
    ...extra,
  });
  await React.act(() => root.render(render()));
  return {
    display,
    actions,
    rerender: async (extra) => { await React.act(() => root.render(render(extra))); },
    unmount: async () => { await React.act(() => root.unmount()); container.remove(); },
  };
}

test("the shell is handed callables it can invoke, and a transcript refresh only when a session is open", async () => {
  stubFetch();
  const withSession = await mount({ session });
  const first = withSession.actions[0];
  await withSession.unmount();

  const withoutSession = await mount({ session: null });
  const firstWithout = withoutSession.actions[0];
  await withoutSession.unmount();

  assert.equal(typeof first.loadSystemInfo, "function");
  assert.equal(typeof first.changeBranchLeaf, "function");
  assert.equal(typeof first.refreshTranscript, "function");
  // SessionSidebar's manual Refresh denies success when no transcript callback
  // is available, so a session-less ChatWindow must publish null here.
  assert.equal(firstWithout.refreshTranscript, null);
});

// Run for both an open session and none. The session-less case is the one that
// exercises the shared empty-tree fallback: with no session data there is no
// tree to return, so a fresh [] per render would republish every time and turn
// each streamed token into a shell re-render.
for (const [name, props] of [["an open session", { session }], ["no session", { session: null }]]) {
  test(`a re-render that moves no displayed value publishes nothing, with ${name}`, async () => {
    stubFetch();
    const view = await mount(props);
    const displayCalls = view.display.length;
    const actionCalls = view.actions.length;

    await view.rerender({ soundEnabled: false });
    const displayAfter = view.display.length;
    const actionsAfter = view.actions.length;
    await view.unmount();

    assert.equal(displayAfter, displayCalls, "display republished without a value change");
    assert.equal(actionsAfter, actionCalls, "actions re-registered without a callable change");
  });
}

test("unmount clears the actions so the shell cannot invoke a dead session", async () => {
  stubFetch();
  const view = await mount({ session });
  const before = view.actions.length;
  await view.unmount();

  assert.equal(view.actions.length, before + 1);
  assert.equal(view.actions.at(-1), null);
});

test("unmount resets the displayed values", async () => {
  stubFetch();
  const view = await mount({ session });
  await view.unmount();

  const last = view.display.at(-1);
  assert.deepEqual(last, {
    branchTree: [], branchActiveLeafId: null, systemPrompt: null, systemTools: null,
    sessionStats: null, contextUsage: null, compactionControl: null, toolPresetControl: null,
  });
});
