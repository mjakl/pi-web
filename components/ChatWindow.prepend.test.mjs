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
let observeIntersection;
const resizeObservers = [];
class IntersectionObserver {
  constructor(callback) {
    observeIntersection = callback;
  }
  observe() {}
  disconnect() {}
}
class ResizeObserver {
  constructor(callback) {
    this.callback = callback;
    this.targets = new Set();
    resizeObservers.push(this);
  }
  observe(target) { this.targets.add(target); }
  disconnect() { this.targets.clear(); }
}
function notifyResize(target) {
  for (const observer of resizeObservers) {
    if (observer.targets.has(target)) observer.callback([{ target }]);
  }
}
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.HTMLElement.prototype.scrollTo = function scrollTo(options) {
  this.scrollTop = options.top;
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
  IntersectionObserver,
  ResizeObserver,
  IS_REACT_ACT_ENVIRONMENT: true,
});

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { act } = React;
const { createRoot } = await jiti.import("react-dom/client");
const { ChatWindow } = await jiti.import("./ChatWindow.tsx");

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function assistant(content) {
  return { role: "assistant", provider: "test", model: "test", content };
}

const session = {
  id: "session",
  path: "/tmp/session.jsonl",
  cwd: "/tmp/project",
  cwdAvailable: false,
  created: "2026-09-04T00:00:00.000Z",
  modified: "2026-09-04T00:00:00.000Z",
};
const recentMessages = [
  { role: "user", content: "Recent question" },
  assistant([
    { type: "thinking", thinking: "Reasoning" },
    { type: "text", text: "Recent answer" },
  ]),
];

function sessionSnapshot() {
  return {
    sessionId: session.id,
    filePath: session.path,
    info: session,
    totalActiveMs: 0,
    tree: [],
    leafId: "recent-answer",
    context: {
      messages: recentMessages,
      entryIds: ["recent-question", "recent-answer"],
      oldestEntryId: "recent-question",
      hasMore: true,
    },
  };
}

test("transcript expansion and history prepend preserve the reader's position", async () => {
  const contextRequest = deferred();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.startsWith("/api/sessions/session/context?")) return contextRequest.promise;
    if (path.startsWith("/api/sessions/session?")) return Response.json(sessionSnapshot());
    if (path === "/api/sessions/session/state") return Response.json({ active: false, running: false });
    if (path.startsWith("/api/models")) return Response.json({ models: {}, modelList: [] });
    return Response.json({});
  };

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(React.createElement(ChatWindow, {
        session,
        newSessionCwd: null,
        newSessionDraftKey: null,
      }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const transcript = container.querySelector(".chat-scroll");
    let scrollHeight = 1000;
    Object.defineProperty(transcript, "clientHeight", { configurable: true, value: 500 });
    Object.defineProperty(transcript, "scrollHeight", { configurable: true, get: () => scrollHeight });
    transcript.scrollTop = 500;

    const processToggle = container.querySelector('button[title="Expand process details"]');
    assert.ok(processToggle);
    await act(() => processToggle.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    scrollHeight = 1200;
    notifyResize(container.querySelector(".chat-transcript"));
    assert.equal(processToggle.getAttribute("aria-expanded"), "true");
    assert.equal(transcript.scrollTop, 500);

    transcript.scrollTop = 400;

    await act(async () => {
      observeIntersection([{ isIntersecting: true }]);
      await Promise.resolve();
    });

    scrollHeight = 1600;
    await act(async () => {
      contextRequest.resolve(Response.json({
        context: {
          messages: [
            { role: "user", content: "Older question" },
            assistant([{ type: "text", text: "Older answer" }]),
          ],
          entryIds: ["older-question", "older-answer"],
          oldestEntryId: "older-question",
          hasMore: false,
        },
      }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    assert.equal(container.querySelector('button[title="Collapse process details"]')?.getAttribute("aria-expanded"), "true");
    assert.equal(transcript.scrollTop, 800);
  } finally {
    await act(() => root.unmount());
    container.remove();
    globalThis.fetch = originalFetch;
  }
});
