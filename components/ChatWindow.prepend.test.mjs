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
  observe(target) {
    this.targets.add(target);
  }
  disconnect() {
    this.targets.clear();
  }
}
function notifyResize(target) {
  for (const observer of resizeObservers) {
    if (observer.targets.has(target)) observer.callback([{ target }]);
  }
}
window.matchMedia = () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
});
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
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
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
  {
    ...assistant([{ type: "thinking", thinking: "Intermediate progress" }]),
    timestamp: new Date(2025, 0, 2, 16, 30).getTime(),
  },
  {
    ...assistant([
      { type: "thinking", thinking: "", deferred: true },
      { type: "text", text: "Recent answer" },
    ]),
    timestamp: new Date(2025, 0, 2, 16, 42).getTime(),
  },
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
      messages: [
        recentMessages[0],
        {
          role: "custom",
          customType: "extension",
          display: false,
          content: "Hidden context",
        },
        ...recentMessages.slice(1),
      ],
      entryIds: [
        "recent-question",
        "hidden-context",
        "recent-progress",
        "recent-answer",
      ],
      oldestEntryId: "recent-question",
      hasMore: true,
    },
  };
}

for (const customType of ["extension", "compaction"]) {
  for (const withVisibleMessage of [false, true]) {
    test(`hidden ${customType} messages do not create or inflate process groups (visible=${withVisibleMessage})`, async () => {
      const hidden = {
        role: "custom",
        customType,
        display: false,
        content: "Hidden context",
      };
      const messages = [
        { role: "user", content: "Question" },
        ...(withVisibleMessage
          ? [
              {
                role: "custom",
                customType: "visible-extension",
                display: true,
                content: "Visible progress",
              },
            ]
          : []),
        hidden,
        assistant([{ type: "text", text: "Final answer" }]),
      ];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (url) => {
        const path = String(url);
        if (path.startsWith("/api/sessions/session?"))
          return Response.json({
            ...sessionSnapshot(),
            context: {
              messages,
              entryIds: messages.map((_, index) => `entry-${index}`),
              hasMore: false,
            },
          });
        if (path === "/api/sessions/session/state")
          return Response.json({ active: false, running: false });
        if (path.startsWith("/api/models"))
          return Response.json({ models: {}, modelList: [] });
        return Response.json({});
      };
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      try {
        await act(async () => {
          root.render(
            React.createElement(ChatWindow, {
              session,
              newSessionCwd: null,
              newSessionDraftKey: null,
            }),
          );
          await new Promise((resolve) => setTimeout(resolve, 20));
        });
        assert.match(container.textContent, /Final answer/);
        assert.doesNotMatch(container.textContent, /Hidden context/);
        const processToggle = container.querySelector(
          'button[title="Expand process details"]',
        );
        if (withVisibleMessage && customType !== "compaction") {
          assert.ok(
            processToggle,
            "visible progress remains in the process group",
          );
          assert.equal(
            processToggle.textContent,
            "Process details · 1 message",
          );
          await act(() => processToggle.click());
          assert.match(container.textContent, /Visible progress/);
          assert.doesNotMatch(container.textContent, /Hidden context/);
        } else {
          assert.ok(
            !processToggle,
            "hidden messages do not create a process group across a boundary",
          );
          if (withVisibleMessage)
            assert.match(container.textContent, /Visible progress/);
        }
      } finally {
        await act(() => root.unmount());
        container.remove();
        globalThis.fetch = originalFetch;
      }
    });
  }
}

test("hidden compaction preserves completed answers and their navigation targets", async () => {
  const messages = [
    { role: "user", content: "Question" },
    assistant([{ type: "text", text: "Earlier final answer" }]),
    {
      role: "custom",
      customType: "compaction",
      display: false,
      content: "Hidden compaction",
    },
    assistant([{ type: "text", text: "Continuation answer" }]),
  ];
  const writes = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const path = String(url);
    if (path.endsWith("/stars")) {
      writes.push(JSON.parse(options.body));
      return Response.json({
        starredEntryIds: ["earlier-answer"],
        starCount: 1,
      });
    }
    if (path.startsWith("/api/sessions/session?"))
      return Response.json({
        ...sessionSnapshot(),
        context: {
          messages,
          entryIds: ["question", "earlier-answer", "hidden", "continuation"],
          hasMore: false,
        },
      });
    if (path === "/api/sessions/session/state")
      return Response.json({ active: false, running: false });
    if (path.startsWith("/api/models"))
      return Response.json({ models: {}, modelList: [] });
    return Response.json({});
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        React.createElement(ChatWindow, {
          session: { ...session, cwdAvailable: true },
          newSessionCwd: null,
          newSessionDraftKey: null,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const stars = container.querySelectorAll(".answer-star-toggle");
    assert.equal(
      stars.length,
      2,
      "both completed answers retain final-answer actions",
    );
    assert.match(container.textContent, /Earlier final answer/);
    assert.match(container.textContent, /Continuation answer/);
    assert.doesNotMatch(
      container.textContent,
      /Hidden compaction|Process details/,
    );
    assert.equal(container.querySelector(".compaction-marker"), null);
    assert.equal(
      container.querySelector('[data-minimap-entry-id="hidden"]'),
      null,
    );
    await act(async () => {
      stars[0].click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.deepEqual(writes, [{ targetId: "earlier-answer", starred: true }]);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    await act(async () => {
      notifyResize(container.querySelector(".chat-scroll"));
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    const answerNode = container.querySelector(
      '[data-minimap-entry-id="earlier-answer"]',
    );
    assert.ok(answerNode, "earlier answer retains its navigation target");
    const transcript = container.querySelector(".chat-scroll");
    transcript.scrollTop = 100;
    await act(() => answerNode.querySelector("button").click());
    assert.equal(
      transcript.scrollTop,
      0,
      "the answer ref resolves to its mounted position",
    );
  } finally {
    await act(() => root.unmount());
    container.remove();
    globalThis.fetch = originalFetch;
  }
});

test("transcript expansion and history prepend preserve position and deferred entry identity", async () => {
  const contextRequest = deferred();
  const thinkingRequests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.includes("/entries/")) {
      thinkingRequests.push(path);
      return Response.json({ thinking: "Reasoning from the recent entry" });
    }
    if (path.startsWith("/api/sessions/session/context?"))
      return contextRequest.promise;
    if (path.startsWith("/api/sessions/session?"))
      return Response.json(sessionSnapshot());
    if (path === "/api/sessions/session/state")
      return Response.json({ active: false, running: false });
    if (path.startsWith("/api/models"))
      return Response.json({ models: {}, modelList: [] });
    return Response.json({});
  };

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        React.createElement(ChatWindow, {
          session,
          newSessionCwd: null,
          newSessionDraftKey: null,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const transcript = container.querySelector(".chat-scroll");
    let scrollHeight = 1000;
    Object.defineProperty(transcript, "clientHeight", {
      configurable: true,
      value: 500,
    });
    Object.defineProperty(transcript, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });
    transcript.scrollTop = 500;

    const processToggle = container.querySelector(
      'button[title="Expand process details"]',
    );
    assert.ok(processToggle);
    await act(() =>
      processToggle.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
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
      contextRequest.resolve(
        Response.json({
          context: {
            messages: [
              { role: "user", content: "Older question" },
              assistant([{ type: "text", text: "Older answer" }]),
            ],
            entryIds: ["older-question", "older-answer"],
            oldestEntryId: "older-question",
            hasMore: false,
          },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    assert.equal(
      container
        .querySelector('button[title="Collapse process details"]')
        ?.getAttribute("aria-expanded"),
      "true",
    );
    assert.equal(transcript.scrollTop, 800);
    assert.equal(container.textContent.split("Recent answer").length - 1, 1);
    assert.equal(container.textContent.split("16:42").length - 1, 1);
    assert.doesNotMatch(container.textContent, /16:30/);
    assert.equal(container.textContent.split("Older answer").length - 1, 1);

    const thinkingToggle = [...container.querySelectorAll("button")]
      .filter((button) => button.textContent.trim().startsWith("Thinking"))
      .at(-1);
    assert.ok(thinkingToggle);
    await act(() => thinkingToggle.click());
    assert.deepEqual(thinkingRequests, [
      "/api/sessions/session/entries/recent-answer/thinking?blockIndex=0",
    ]);
    assert.match(container.textContent, /Reasoning from the recent entry/);
  } finally {
    await act(() => root.unmount());
    container.remove();
    globalThis.fetch = originalFetch;
  }
});
