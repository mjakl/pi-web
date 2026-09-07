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
const { getDraft, setDraft, clearDraft } = await jiti.import(
  "../lib/draft-store.ts",
);

const session = {
  id: "fork-source",
  path: "/tmp/fork-source.jsonl",
  cwd: "/tmp/project",
  created: "2026-09-04T00:00:00.000Z",
  modified: "2026-09-04T00:00:00.000Z",
};
const image = { data: "aGVsbG8=", mimeType: "image/png" };
const selectedMessage = {
  role: "user",
  content: [
    {
      type: "text",
      text: '<skill name="review" location="/skills/review/SKILL.md">\nReferences are relative to /skills/review.\n\nReview instructions\n</skill>\n\nsrc/main.ts',
    },
    {
      type: "image",
      source: { type: "base64", data: image.data, media_type: image.mimeType },
    },
  ],
};
const history = [
  { role: "user", content: "Earlier question" },
  {
    role: "assistant",
    provider: "test",
    model: "test",
    content: [{ type: "text", text: "Earlier answer" }],
  },
];

test("New session restores the selected message and images after switching, preserving the source draft", async () => {
  const originalFetch = globalThis.fetch;
  let cancelled = true;
  const commands = [];
  globalThis.fetch = async (url, options) => {
    const path = String(url);
    if (path === "/api/agent/fork-source") {
      commands.push(JSON.parse(options.body));
      return Response.json({
        success: true,
        data: cancelled
          ? { cancelled: true }
          : { newSessionId: "fork-copy", message: selectedMessage },
      });
    }
    const id = path.match(/^\/api\/sessions\/(fork-source|fork-copy)\?/)?.[1];
    if (id)
      return Response.json({
        sessionId: id,
        filePath: `/tmp/${id}.jsonl`,
        info: { ...session, id },
        totalActiveMs: 0,
        tree: [],
        leafId: id === session.id ? "selected" : "answer",
        context: {
          messages: id === session.id ? [...history, selectedMessage] : history,
          entryIds:
            id === session.id
              ? ["question", "answer", "selected"]
              : ["question", "answer"],
          hasMore: false,
        },
      });
    if (path.endsWith("/state"))
      return Response.json({ active: false, running: false });
    if (path.startsWith("/api/models"))
      return Response.json({ models: {}, modelList: [] });
    return Response.json({});
  };
  setDraft(session.id, { value: "Unsent source draft", images: [] });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let selectedId = session.id;
  function renderSession(id) {
    selectedId = id;
    root.render(
      React.createElement(ChatWindow, {
        key: id,
        session: { ...session, id },
        newSessionCwd: null,
        newSessionDraftKey: null,
        onSessionForked: renderSession,
      }),
    );
  }
  const newSessionButton = () =>
    [...container.querySelectorAll("button")]
      .filter((button) => button.textContent.trim() === "New session")
      .at(-1);
  try {
    await React.act(async () => {
      renderSession(session.id);
    });
    assert.ok(
      [...container.querySelectorAll("button")].some(
        (button) => button.textContent.trim() === "New branch",
      ),
    );
    assert.ok(newSessionButton());
    await React.act(async () => {
      newSessionButton().click();
    });
    assert.equal(selectedId, session.id);
    assert.equal(
      container.querySelector("textarea").value,
      "Unsent source draft",
    );
    assert.equal(getDraft("fork-copy"), null);

    cancelled = false;
    await React.act(async () => {
      newSessionButton().click();
    });
    assert.equal(selectedId, "fork-copy");
    assert.equal(
      container.querySelector("textarea").value,
      "/skill:review src/main.ts",
    );
    assert.deepEqual(getDraft("fork-copy"), {
      value: "/skill:review src/main.ts",
      images: [image],
    });
    assert.deepEqual(getDraft(session.id), {
      value: "Unsent source draft",
      images: [],
    });
    assert.deepEqual(commands, [
      { type: "fork", entryId: "selected" },
      { type: "fork", entryId: "selected" },
    ]);
  } finally {
    await React.act(() => root.unmount());
    container.remove();
    clearDraft(session.id);
    clearDraft("fork-copy");
    globalThis.fetch = originalFetch;
  }
});

test("Rewind runs without confirmation, retains the draft on failure, and restores the removed message and images on success", async () => {
  const originalFetch = globalThis.fetch;
  const originalConfirm = window.confirm;
  let confirmationCount = 0;
  let fail = true;
  let rewound = false;
  const commands = [];
  window.confirm = () => {
    confirmationCount += 1;
    return false;
  };
  globalThis.fetch = async (url, options) => {
    const path = String(url);
    if (path === "/api/agent/fork-source") {
      commands.push(JSON.parse(options.body));
      if (fail)
        return Response.json({ error: "fixture failure" }, { status: 500 });
      rewound = true;
      return Response.json({
        success: true,
        data: { message: selectedMessage },
      });
    }
    if (path.startsWith("/api/sessions/fork-source?"))
      return Response.json({
        sessionId: session.id,
        filePath: session.path,
        info: session,
        totalActiveMs: 0,
        tree: [],
        leafId: rewound ? "answer" : "selected",
        context: {
          messages: rewound ? history : [...history, selectedMessage],
          entryIds: rewound
            ? ["question", "answer"]
            : ["question", "answer", "selected"],
          hasMore: false,
        },
      });
    if (path.endsWith("/state"))
      return Response.json({ active: false, running: false });
    if (path.startsWith("/api/models"))
      return Response.json({ models: {}, modelList: [] });
    return Response.json({});
  };
  setDraft(session.id, { value: "Unsent draft", images: [] });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const rewindButton = () =>
    [...container.querySelectorAll("button")]
      .filter((button) => button.textContent.trim() === "Rewind")
      .at(-1);
  try {
    await React.act(() =>
      root.render(
        React.createElement(ChatWindow, {
          session,
          newSessionCwd: null,
          newSessionDraftKey: null,
        }),
      ),
    );
    assert.equal(
      [...container.querySelectorAll("button")].filter(
        (button) => button.textContent.trim() === "Rewind",
      ).length,
      2,
      "the first user message can also be rewound",
    );
    await React.act(() => rewindButton().click());
    assert.equal(confirmationCount, 0, "Rewind must not ask for confirmation");
    assert.match(container.textContent, /Could not rewind: fixture failure/);
    assert.equal(container.querySelector("textarea").value, "Unsent draft");
    fail = false;
    await React.act(() => rewindButton().click());
    assert.equal(confirmationCount, 0);
    assert.equal(
      container.querySelector("textarea").value,
      "/skill:review src/main.ts",
    );
    assert.deepEqual(getDraft(session.id), {
      value: "/skill:review src/main.ts",
      images: [image],
    });
    assert.match(container.textContent, /Earlier answer/);
    assert.equal(
      [...container.querySelectorAll("button")].filter(
        (button) => button.textContent.trim() === "Rewind",
      ).length,
      1,
    );
    assert.deepEqual(commands, [
      { type: "rewind", entryId: "selected" },
      { type: "rewind", entryId: "selected" },
    ]);
  } finally {
    await React.act(() => root.unmount());
    container.remove();
    clearDraft(session.id);
    globalThis.fetch = originalFetch;
    window.confirm = originalConfirm;
  }
});

for (const partialPage of [false, true]) {
  test(`stars only final answers${partialPage ? " on a partial history page" : ""}, updates metadata, and preserves the saved state on a failed toggle`, async () => {
    const originalFetch = globalThis.fetch;
    const updates = [];
    const writes = [];
    let fail = false;
    globalThis.fetch = async (url, options) => {
      const path = String(url);
      if (path.endsWith("/stars")) {
        const body = JSON.parse(options.body);
        writes.push(body);
        if (fail)
          return Response.json({ error: "Disk unavailable" }, { status: 400 });
        return Response.json({
          starredEntryIds: body.starred ? [body.targetId] : [],
          starCount: body.starred ? 1 : 0,
          fileSize: 100,
          modified: "2026-09-07T12:00:00.000Z",
        });
      }
      if (path.startsWith("/api/sessions/fork-source?"))
        return Response.json({
          sessionId: session.id,
          filePath: session.path,
          info: {
            ...session,
            messageCount: 3,
            firstMessage: "Question",
            starCount: 0,
          },
          totalActiveMs: 0,
          tree: [],
          leafId: "answer",
          context: {
            messages: [
              ...(partialPage ? [] : [history[0]]),
              {
                ...history[1],
                content: [{ type: "text", text: "Working through it" }],
              },
              history[1],
            ],
            entryIds: [
              ...(partialPage ? [] : ["question"]),
              "process",
              "answer",
            ],
            historyAnchors: [{ id: "question" }],
            starredEntryIds: [],
            hasMore: false,
          },
        });
      if (path.endsWith("/state"))
        return Response.json({ active: false, running: false });
      if (path.startsWith("/api/models"))
        return Response.json({ models: {}, modelList: [] });
      return Response.json({});
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await React.act(async () => {
        root.render(
          React.createElement(ChatWindow, {
            session,
            newSessionCwd: null,
            onSessionMetadataChange: (value) => updates.push(value),
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 30));
      });
      const buttons = container.querySelectorAll(".answer-star-toggle");
      assert.equal(buttons.length, 1, "process messages have no star toggle");
      const button = buttons[0];
      assert.equal(button.getAttribute("aria-pressed"), "false");
      await React.act(async () => {
        button.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      assert.deepEqual(writes, [{ targetId: "answer", starred: true }]);
      assert.equal(button.getAttribute("aria-pressed"), "true");
      assert.equal(updates.at(-1).starCount, 1);
      fail = true;
      await React.act(async () => {
        button.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      assert.equal(button.getAttribute("aria-pressed"), "true");
      assert.match(
        container.textContent,
        /Could not update star: Disk unavailable/,
      );
      fail = false;
      await React.act(async () => {
        button.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      assert.equal(button.getAttribute("aria-pressed"), "false");
      assert.equal(updates.at(-1).starCount, 0);
    } finally {
      await React.act(() => root.unmount());
      container.remove();
      globalThis.fetch = originalFetch;
    }
  });
}

for (const [name, message, entryId, leafId, draft] of [
  [
    "first user message",
    selectedMessage,
    "first",
    null,
    "/skill:review src/main.ts",
  ],
  ["assistant answer", history[1], "answer", "answer", ""],
  [
    "extension message",
    {
      role: "custom",
      customType: "fixture",
      content: "Extension context",
      display: true,
    },
    "custom",
    "custom",
    "",
  ],
]) {
  test(`New branch from the ${name} updates context and draft only after success`, async () => {
    const originalFetch = globalThis.fetch;
    let outcome = "cancel";
    const commands = [];
    const contextUrls = [];
    globalThis.fetch = async (url, options) => {
      const path = String(url);
      if (path === "/api/agent/fork-source") {
        commands.push(JSON.parse(options.body));
        if (outcome === "fail")
          return Response.json({ error: "fixture failure" }, { status: 500 });
        return Response.json({
          success: true,
          data:
            outcome === "cancel"
              ? { cancelled: true }
              : {
                  cancelled: false,
                  leafId,
                  ...(message.role === "user" ? { message } : {}),
                },
        });
      }
      if (path.includes("/context?")) {
        contextUrls.push(path);
        return Response.json({
          context: {
            messages: leafId === null ? [] : [message],
            entryIds: leafId === null ? [] : [entryId],
            hasMore: false,
          },
        });
      }
      if (path.startsWith("/api/sessions/fork-source?"))
        return Response.json({
          sessionId: session.id,
          filePath: session.path,
          info: session,
          tree: [],
          leafId: entryId,
          context: {
            messages: [message],
            entryIds: [entryId],
            hasMore: true,
            oldestEntryId: entryId,
          },
        });
      if (path.endsWith("/state"))
        return Response.json({ active: false, running: false });
      if (path.startsWith("/api/models"))
        return Response.json({ models: {}, modelList: [] });
      return Response.json({});
    };
    setDraft(session.id, { value: "Unsent draft", images: [] });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const button = () =>
      [...container.querySelectorAll("button")].find(
        (b) => b.textContent.trim() === "New branch",
      );
    try {
      await React.act(() =>
        root.render(
          React.createElement(ChatWindow, {
            session,
            newSessionCwd: null,
            newSessionDraftKey: null,
            chatInputRef: React.createRef(),
          }),
        ),
      );
      assert.ok(
        button(),
        "first loaded entry has actions even without a preceding assistant",
      );
      await React.act(() => button().click());
      assert.equal(container.querySelector("textarea").value, "Unsent draft");
      assert.equal(contextUrls.length, 0);
      outcome = "fail";
      await React.act(() => button().click());
      assert.equal(container.querySelector("textarea").value, "Unsent draft");
      assert.equal(contextUrls.length, 0);
      outcome = "success";
      await React.act(() => button().click());
      assert.equal(
        container.querySelector("textarea").value,
        draft,
        JSON.stringify({ commands, contextUrls, text: container.textContent }),
      );
      assert.deepEqual(
        commands,
        Array(3).fill({ type: "branch_from_message", entryId }),
      );
      assert.equal(contextUrls.length, 1);
      assert.equal(
        new URL(contextUrls[0], "http://localhost").searchParams.get(
          leafId === null ? "root" : "leafId",
        ),
        leafId === null ? "1" : leafId,
      );
      if (message.role === "user")
        assert.deepEqual(getDraft(session.id).images, [image]);
      else assert.equal(getDraft(session.id), null);
    } finally {
      await React.act(() => root.unmount());
      container.remove();
      clearDraft(session.id);
      globalThis.fetch = originalFetch;
    }
  });
}

test("running sessions expose copying and explain why branching is disabled", async () => {
  const originalFetch = globalThis.fetch;
  const originalEventSource = globalThis.EventSource;
  globalThis.EventSource = class {
    close() {}
  };
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.startsWith("/api/sessions/fork-source?"))
      return Response.json({
        sessionId: session.id,
        filePath: session.path,
        info: session,
        tree: [],
        leafId: "answer",
        context: {
          messages: history,
          entryIds: ["question", "answer"],
          hasMore: false,
        },
      });
    if (path.endsWith("/state"))
      return Response.json({
        active: true,
        running: true,
        state: { isStreaming: true },
      });
    if (path.startsWith("/api/models"))
      return Response.json({ models: {}, modelList: [] });
    return Response.json({});
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await React.act(() =>
      root.render(
        React.createElement(ChatWindow, {
          session,
          sessionRunning: true,
          newSessionCwd: null,
          newSessionDraftKey: null,
          chatInputRef: React.createRef(),
        }),
      ),
    );
    const branches = [...container.querySelectorAll("button")].filter(
      (b) => b.textContent.trim() === "New branch",
    );
    assert.equal(branches.length, 2);
    for (const button of branches) {
      assert.equal(button.disabled, true);
      assert.match(button.parentElement.title, /finish/i);
    }
    for (const button of [...container.querySelectorAll("button")].filter(
      (b) => b.textContent.trim() === "New session",
    ))
      assert.equal(button.disabled, false);
  } finally {
    await React.act(() => root.unmount());
    container.remove();
    globalThis.fetch = originalFetch;
    globalThis.EventSource = originalEventSource;
  }
});

test("branching blocks submission until history and draft reconcile, including a failed reload and retry", async () => {
  const originalFetch = globalThis.fetch;
  const originalEventSource = globalThis.EventSource;
  globalThis.EventSource = class {
    readyState = 1;
    constructor() {
      queueMicrotask(() =>
        this.onmessage?.({
          data: JSON.stringify({ type: "connected", isStreaming: false }),
        }),
      );
    }
    close() {}
  };
  let releaseBranch;
  let releaseContext;
  let contextReads = 0;
  const commands = [];
  globalThis.fetch = async (url, options) => {
    const path = String(url);
    if (path === "/api/agent/fork-source" && options?.body) {
      const command = JSON.parse(options.body);
      commands.push(command);
      if (command.type === "branch_from_message") {
        await new Promise((resolve) => {
          releaseBranch = resolve;
        });
        return Response.json({
          success: true,
          data: {
            cancelled: false,
            leafId: "answer",
            message: selectedMessage,
          },
        });
      }
      return Response.json({ success: true, data: {} });
    }
    if (path.includes("/context?")) {
      contextReads += 1;
      if (contextReads === 1)
        return Response.json({ error: "temporary failure" }, { status: 503 });
      await new Promise((resolve) => {
        releaseContext = resolve;
      });
      return Response.json({
        context: {
          messages: history,
          entryIds: ["question", "answer"],
          hasMore: false,
        },
      });
    }
    if (path.startsWith("/api/sessions/fork-source?"))
      return Response.json({
        sessionId: session.id,
        filePath: session.path,
        info: session,
        tree: [],
        leafId: "selected",
        context: {
          messages: [...history, selectedMessage],
          entryIds: ["question", "answer", "selected"],
          hasMore: false,
        },
      });
    if (path.endsWith("/state"))
      return Response.json({ active: false, running: false });
    if (path.startsWith("/api/models"))
      return Response.json({ models: {}, modelList: [] });
    return Response.json({});
  };
  setDraft(session.id, { value: "Old composer draft", images: [] });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const button = (label) =>
    [...container.querySelectorAll("button")].find(
      (b) =>
        b.textContent.trim() === label ||
        b.getAttribute("aria-label") === label,
    );
  const pressEnter = () =>
    container.querySelector("textarea").dispatchEvent(
      new window.KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
  try {
    await React.act(async () =>
      root.render(
        React.createElement(ChatWindow, {
          session,
          newSessionCwd: null,
          newSessionDraftKey: null,
          chatInputRef: React.createRef(),
        }),
      ),
    );
    await React.act(async () =>
      [...container.querySelectorAll("button")]
        .filter((b) => b.textContent.trim() === "New branch")
        .at(-1)
        .click(),
    );
    assert.equal(
      button("Send").disabled,
      true,
      "sending is blocked before the branch response",
    );
    await React.act(async () => {
      pressEnter();
    });
    assert.equal(
      container.querySelector("textarea").value,
      "Old composer draft",
    );
    assert.equal(commands.length, 1);
    await React.act(async () => releaseBranch());
    assert.match(
      container.querySelector('[role="alert"]').textContent,
      /history/i,
    );
    assert.ok(button("Retry loading history"));
    assert.equal(
      button("Send").disabled,
      true,
      "a failed context request does not reopen submission",
    );
    await React.act(async () => {
      pressEnter();
    });
    assert.equal(commands.length, 1);
    await React.act(async () => button("Retry loading history").click());
    assert.equal(
      button("Send").disabled,
      true,
      "retry keeps submission blocked",
    );
    await React.act(async () => releaseContext());
    assert.equal(contextReads, 2);
    assert.equal(
      commands.filter((c) => c.type === "branch_from_message").length,
      1,
    );
    assert.equal(button("Retry loading history"), undefined);
    assert.equal(
      container.querySelector("textarea").value,
      "/skill:review src/main.ts",
    );
    assert.deepEqual(getDraft(session.id).images, [image]);
    assert.equal(button("Send").disabled, false);
    await React.act(async () => button("Send").click());
    assert.equal(commands.at(-1).type, "prompt");
    assert.equal(commands.at(-1).message, "/skill:review src/main.ts");
  } finally {
    releaseBranch?.();
    releaseContext?.();
    await React.act(async () => root.unmount());
    container.remove();
    clearDraft(session.id);
    globalThis.fetch = originalFetch;
    globalThis.EventSource = originalEventSource;
  }
});

test("the session hook refuses direct prompt and command admission during branch reconciliation", async () => {
  const { useAgentSession } = await jiti.import("../hooks/useAgentSession.ts");
  const originalFetch = globalThis.fetch;
  const commands = [];
  const restored = [];
  let releaseBranch;
  let action;
  let api;
  globalThis.fetch = async (url, options) => {
    const path = String(url);
    if (path === "/api/agent/fork-source" && options?.body) {
      const command = JSON.parse(options.body);
      commands.push(command);
      if (command.type === "branch_from_message") {
        await new Promise((resolve) => {
          releaseBranch = resolve;
        });
        return Response.json({ success: true, data: { cancelled: true } });
      }
      return Response.json({ success: true, data: {} });
    }
    if (path.startsWith("/api/sessions/fork-source?"))
      return Response.json({
        sessionId: session.id,
        filePath: session.path,
        info: session,
        tree: [],
        leafId: "answer",
        context: {
          messages: history,
          entryIds: ["question", "answer"],
          hasMore: false,
        },
      });
    if (path.endsWith("/state"))
      return Response.json({ active: false, running: false });
    if (path.startsWith("/api/models"))
      return Response.json({ models: {}, modelList: [] });
    return Response.json({});
  };
  const inputRef = {
    current: { restoreSubmission: (text) => restored.push(text) },
  };
  function Probe() {
    api = useAgentSession({
      session,
      newSessionCwd: null,
      newSessionDraftKey: null,
      chatInputRef: inputRef,
    });
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await React.act(async () => {
      root.render(React.createElement(Probe));
    });
    await React.act(async () => {
      action = api.handleBranchMessage("question");
      // Submit in the same event turn, before the disabled button can render.
      await api.handleSend("Old composer draft");
      await api.handleSend("!echo must-not-run");
      await api.handlePromptWithStreamingBehavior("/extension", "steer");
      const builtin = await api.handleBuiltinSlashCommand("/compact");
      assert.equal(builtin.handled, true);
      assert.ok(builtin.error);
    });
    assert.deepEqual(commands, [
      { type: "branch_from_message", entryId: "question" },
    ]);
    assert.deepEqual(restored, [
      "Old composer draft",
      "!echo must-not-run",
      "/extension",
    ]);
    assert.deepEqual(api.messages, history);
    assert.equal(api.branchStatus, "pending");
    await React.act(async () => {
      releaseBranch();
      await action;
    });
    assert.equal(api.branchStatus, null);
    assert.deepEqual(api.messages, history);
  } finally {
    releaseBranch?.();
    await React.act(async () => {
      await action;
      root.unmount();
    });
    container.remove();
    globalThis.fetch = originalFetch;
  }
});
