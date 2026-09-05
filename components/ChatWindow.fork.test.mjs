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
const { getDraft, setDraft, clearDraft } = await jiti.import("../lib/draft-store.ts");

const session = {
  id: "fork-source", path: "/tmp/fork-source.jsonl", cwd: "/tmp/project",
  created: "2026-09-04T00:00:00.000Z", modified: "2026-09-04T00:00:00.000Z",
};
const image = { data: "aGVsbG8=", mimeType: "image/png" };
const selectedMessage = {
  role: "user",
  content: [
    { type: "text", text: '<skill name="review" location="/skills/review/SKILL.md">\nReferences are relative to /skills/review.\n\nReview instructions\n</skill>\n\nsrc/main.ts' },
    { type: "image", source: { type: "base64", data: image.data, media_type: image.mimeType } },
  ],
};
const history = [
  { role: "user", content: "Earlier question" },
  { role: "assistant", provider: "test", model: "test", content: [{ type: "text", text: "Earlier answer" }] },
];

test("New session restores the selected message and images after switching, preserving the source draft", async () => {
  const originalFetch = globalThis.fetch;
  let cancelled = true;
  const commands = [];
  globalThis.fetch = async (url, options) => {
    const path = String(url);
    if (path === "/api/agent/fork-source") {
      commands.push(JSON.parse(options.body));
      return Response.json({ success: true, data: cancelled ? { cancelled: true } : { newSessionId: "fork-copy" } });
    }
    const id = path.match(/^\/api\/sessions\/(fork-source|fork-copy)\?/)?.[1];
    if (id) return Response.json({
      sessionId: id, filePath: `/tmp/${id}.jsonl`, info: { ...session, id },
      totalActiveMs: 0, tree: [], leafId: id === session.id ? "selected" : "answer",
      context: {
        messages: id === session.id ? [...history, selectedMessage] : history,
        entryIds: id === session.id ? ["question", "answer", "selected"] : ["question", "answer"],
        hasMore: false,
      },
    });
    if (path.endsWith("/state")) return Response.json({ active: false, running: false });
    if (path.startsWith("/api/models")) return Response.json({ models: {}, modelList: [] });
    return Response.json({});
  };
  setDraft(session.id, { value: "Unsent source draft", images: [] });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let selectedId = session.id;
  function renderSession(id) {
    selectedId = id;
    root.render(React.createElement(ChatWindow, {
      key: id, session: { ...session, id }, newSessionCwd: null, newSessionDraftKey: null,
      onSessionForked: renderSession,
    }));
  }
  const newSessionButton = () => [...container.querySelectorAll("button")].find((button) => button.textContent.trim() === "New session");
  try {
    await React.act(async () => { renderSession(session.id); });
    assert.ok([...container.querySelectorAll("button")].some((button) => button.textContent.trim() === "New branch"));
    assert.ok(newSessionButton());
    await React.act(async () => { newSessionButton().click(); });
    assert.equal(selectedId, session.id);
    assert.equal(container.querySelector("textarea").value, "Unsent source draft");
    assert.equal(getDraft("fork-copy"), null);

    cancelled = false;
    await React.act(async () => { newSessionButton().click(); });
    assert.equal(selectedId, "fork-copy");
    assert.equal(container.querySelector("textarea").value, "/skill:review src/main.ts");
    assert.deepEqual(getDraft("fork-copy"), { value: "/skill:review src/main.ts", images: [image] });
    assert.deepEqual(getDraft(session.id), { value: "Unsent source draft", images: [] });
    assert.deepEqual(commands, [{ type: "fork", entryId: "selected" }, { type: "fork", entryId: "selected" }]);
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
  window.confirm = () => { confirmationCount += 1; return false; };
  globalThis.fetch = async (url, options) => {
    const path = String(url);
    if (path === "/api/agent/fork-source") {
      commands.push(JSON.parse(options.body));
      if (fail) return Response.json({ error: "fixture failure" }, { status: 500 });
      rewound = true;
      return Response.json({ success: true, data: { message: selectedMessage } });
    }
    if (path.startsWith("/api/sessions/fork-source?")) return Response.json({
      sessionId: session.id, filePath: session.path, info: session, totalActiveMs: 0,
      tree: [], leafId: rewound ? "answer" : "selected",
      context: { messages: rewound ? history : [...history, selectedMessage],
        entryIds: rewound ? ["question", "answer"] : ["question", "answer", "selected"], hasMore: false },
    });
    if (path.endsWith("/state")) return Response.json({ active: false, running: false });
    if (path.startsWith("/api/models")) return Response.json({ models: {}, modelList: [] });
    return Response.json({});
  };
  setDraft(session.id, { value: "Unsent draft", images: [] });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const rewindButton = () => [...container.querySelectorAll("button")].filter(button => button.textContent.trim() === "Rewind").at(-1);
  try {
    await React.act(() => root.render(React.createElement(ChatWindow, { session, newSessionCwd: null, newSessionDraftKey: null })));
    assert.equal([...container.querySelectorAll("button")].filter(button => button.textContent.trim() === "Rewind").length, 2, "the first user message can also be rewound");
    await React.act(() => rewindButton().click());
    assert.equal(confirmationCount, 0, "Rewind must not ask for confirmation");
    assert.match(container.textContent, /Could not rewind: fixture failure/);
    assert.equal(container.querySelector("textarea").value, "Unsent draft");
    fail = false;
    await React.act(() => rewindButton().click());
    assert.equal(confirmationCount, 0);
    assert.equal(container.querySelector("textarea").value, "/skill:review src/main.ts");
    assert.deepEqual(getDraft(session.id), { value: "/skill:review src/main.ts", images: [image] });
    assert.match(container.textContent, /Earlier answer/);
    assert.equal([...container.querySelectorAll("button")].filter(button => button.textContent.trim() === "Rewind").length, 1);
    assert.deepEqual(commands, [{ type: "rewind", entryId: "selected" }, { type: "rewind", entryId: "selected" }]);
  } finally {
    await React.act(() => root.unmount());
    container.remove();
    clearDraft(session.id);
    globalThis.fetch = originalFetch;
    window.confirm = originalConfirm;
  }
});
