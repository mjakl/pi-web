import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { Window } from "happy-dom";
import { createJiti } from "jiti";

registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith(".css")) return nextLoad(url, context);
    return {
      format: "module",
      shortCircuit: true,
      source: "export default {};",
    };
  },
});

process.env.NODE_ENV = "test";
const window = new Window({ url: "http://localhost" });
window.HTMLElement.prototype.scrollTo = function ({ top }) {
  this.scrollTop = top;
};
Object.assign(globalThis, {
  window,
  document: window.document,
  Node: window.Node,
  HTMLElement: window.HTMLElement,
  HTMLButtonElement: window.HTMLButtonElement,
  Event: window.Event,
  MouseEvent: window.MouseEvent,
  localStorage: window.localStorage,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  IntersectionObserver: class {
    observe() {}
    disconnect() {}
  },
  ResizeObserver: class {
    observe() {}
    disconnect() {}
  },
  IS_REACT_ACT_ENVIRONMENT: true,
});

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { createRoot } = await jiti.import("react-dom/client");
const { ChatWindow } = await jiti.import("./ChatWindow.tsx");

const { useAgentSession } = await jiti.import("../hooks/useAgentSession.ts");
const { formatContextUsage } = await jiti.import("../lib/i18n/format.ts");
const session = {
  id: "context-session",
  path: "/tmp/context-session.jsonl",
  cwd: "/tmp/project",
  created: "2026-09-07",
  modified: "2026-09-07",
};
const before = { tokens: 68000, percent: 25, contextWindow: 272000 };
const estimate = {
  tokens: 18000,
  percent: 6.617647,
  contextWindow: 272000,
  estimated: true,
};
const measured = { tokens: 18000, percent: 6.617647, contextWindow: 272000 };
const assistant = {
  role: "assistant",
  content: [{ type: "text", text: "Done" }],
  stopReason: "stop",
  usage: {
    input: 18000,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 18000,
  },
};

async function mount(t, shell = false, initialUsage = before) {
  const originalFetch = globalThis.fetch;
  const originalEventSource = globalThis.EventSource;
  let source;
  let api;
  let display;
  let usage = initialUsage;
  let failCompact = false;
  let readState = async () =>
    Response.json({
      active: true,
      running: true,
      state: { contextUsage: usage, isStreaming: true },
    });
  globalThis.EventSource = class {
    readyState = 1;
    constructor() {
      source = this;
    }
    close() {
      this.readyState = 2;
    }
  };
  globalThis.fetch = async (url, options) => {
    const path = String(url);
    if (options?.body) {
      const command = JSON.parse(options.body);
      if (command.type === "compact") {
        if (failCompact)
          return Response.json(
            { error: "Compaction cancelled" },
            { status: 400 },
          );
        usage = estimate;
        return Response.json({
          success: true,
          data: { tokensBefore: 68000, estimatedTokensAfter: 18000 },
        });
      }
      return Response.json({
        success: true,
        data: command.type === "get_tools" ? [] : {},
      });
    }
    if (path.endsWith("/state") || path === "/api/agent/context-session")
      return readState();
    if (path.startsWith("/api/sessions/context-session?"))
      return Response.json({
        sessionId: session.id,
        filePath: session.path,
        info: session,
        tree: [],
        leafId: "last",
        context: { messages: [], entryIds: [], hasMore: false },
      });
    if (path.startsWith("/api/models"))
      return Response.json({ models: {}, modelList: [] });
    return Response.json({});
  };
  function Probe() {
    api = useAgentSession({
      session,
      sessionActive: true,
      newSessionCwd: null,
      newSessionDraftKey: null,
    });
    return React.createElement(
      "output",
      null,
      formatContextUsage(api.contextUsage)?.summary,
    );
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  t.after(async () => {
    await React.act(() => root.unmount());
    container.remove();
    globalThis.fetch = originalFetch;
    globalThis.EventSource = originalEventSource;
  });
  await React.act(async () =>
    root.render(
      shell
        ? React.createElement(ChatWindow, {
            session,
            sessionActive: true,
            newSessionCwd: null,
            newSessionDraftKey: null,
            onChatDisplayChange: (value) => {
              display = value;
            },
          })
        : React.createElement(Probe),
    ),
  );
  const emit = (event) =>
    React.act(async () => source.onmessage({ data: JSON.stringify(event) }));
  await emit({ type: "connected", isStreaming: true });
  return {
    get api() {
      return api;
    },
    get display() {
      return display;
    },
    get summary() {
      return container.querySelector("output")?.textContent;
    },
    set usage(value) {
      usage = value;
    },
    set failCompact(value) {
      failCompact = value;
    },
    set readState(value) {
      readState = value;
    },
    emit,
  };
}

for (const action of ["button", "slash", "auto"]) {
  test(`${action} compaction refreshes context and the next assistant response replaces the estimate`, async (t) => {
    const view = await mount(t);
    assert.equal(view.summary, "68k / 272k (25%)");
    if (action === "auto") {
      await view.emit({ type: "compaction_start" });
      view.usage = estimate;
      await view.emit({
        type: "compaction_end",
        result: { tokensBefore: 68000, estimatedTokensAfter: 18000 },
        aborted: false,
      });
    } else {
      await React.act(async () =>
        action === "button"
          ? view.api.handleCompact()
          : view.api.handleBuiltinSlashCommand("/compact"),
      );
    }
    assert.equal(view.summary, "~18k / 272k (~6.6%)");
    view.usage = measured;
    await view.emit({ type: "message_end", message: assistant });
    assert.equal(view.summary, "18k / 272k (6.6%)");
  });
}

test("failed and cancelled compaction preserve the current context usage", async (t) => {
  const view = await mount(t);
  view.failCompact = true;
  await React.act(async () => view.api.handleCompact());
  assert.equal(view.summary, "68k / 272k (25%)");
  await view.emit({ type: "compaction_start" });
  await view.emit({ type: "compaction_end", aborted: true });
  assert.equal(view.summary, "68k / 272k (25%)");
});

test("a delayed pre-compaction state cannot overwrite the estimate", async (t) => {
  const view = await mount(t);
  let release;
  view.readState = () =>
    new Promise((resolve) => {
      release = () =>
        resolve(Response.json({ state: { contextUsage: before } }));
    });
  await view.emit({ type: "agent_end" });
  view.readState = async () =>
    Response.json({ state: { contextUsage: estimate } });
  await view.emit({ type: "compaction_start" });
  await view.emit({
    type: "compaction_end",
    result: { tokensBefore: 68000, estimatedTokensAfter: 18000 },
    aborted: false,
  });
  await React.act(async () => release());
  assert.equal(view.summary, "~18k / 272k (~6.6%)");
});

test("the shell receives the measured marker change even when numbers stay equal", async (t) => {
  const view = await mount(t, true);
  view.usage = estimate;
  await view.emit({
    type: "compaction_end",
    result: { tokensBefore: 68000, estimatedTokensAfter: 18000 },
    aborted: false,
  });
  assert.deepEqual(view.display.contextUsage, estimate);
  view.usage = measured;
  await view.emit({ type: "message_end", message: assistant });
  assert.deepEqual(view.display.contextUsage, measured);
});

test("opening an active compacted session restores its estimate", async (t) => {
  const view = await mount(t, false, estimate);
  assert.equal(view.summary, "~18k / 272k (~6.6%)");
});

test("a delayed compaction refresh cannot overwrite a later compaction or measured response", async (t) => {
  const view = await mount(t);
  let release;
  view.readState = () =>
    new Promise((resolve) => {
      release = () =>
        resolve(Response.json({ state: { contextUsage: estimate } }));
    });
  await view.emit({ type: "compaction_end", aborted: false });
  view.readState = async () =>
    Response.json({
      state: { contextUsage: { ...estimate, tokens: 9000, percent: 3.308824 } },
    });
  await view.emit({ type: "compaction_start" });
  await view.emit({ type: "compaction_end", aborted: false });
  assert.equal(view.summary, "~9k / 272k (~3.3%)");
  view.readState = async () =>
    Response.json({ state: { contextUsage: measured } });
  await view.emit({ type: "message_end", message: assistant });
  await React.act(async () => release());
  assert.equal(view.summary, "18k / 272k (6.6%)");
});

test("busy-state reconciliation recovers context after a failed compaction refresh", async (t) => {
  const view = await mount(t);
  view.readState = async () => Response.json({}, { status: 503 });
  await view.emit({ type: "compaction_end", aborted: false });
  assert.equal(view.summary, "68k / 272k (25%)");
  view.readState = async () =>
    Response.json({
      running: true,
      state: { contextUsage: estimate, isStreaming: true },
    });
  await React.act(async () => window.dispatchEvent(new Event("online")));
  assert.equal(view.summary, "~18k / 272k (~6.6%)");
});
