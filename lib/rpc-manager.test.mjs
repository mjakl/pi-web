import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { AgentSessionWrapper, startRpcSession, setRpcSessionTools, beginRpcSessionOperation } = await jiti.import("./rpc-manager.ts");

for (const type of ["fork", "clone"]) {
  test(`${type} rejects active work and keeps the source usable after creating independent children`, async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-clone-"));
    const sessionDir = join(root, "sessions");
    await mkdir(sessionDir);
    const manager = SessionManager.create(root, sessionDir);
    manager.appendMessage({ role: "user", content: "clone fixture", timestamp: Date.now() });
    manager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "fixture response" }],
      api: "test",
      provider: "test",
      model: "test",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    });
    const cloneLeafId = manager.getLeafId();
    const expectedMessages = manager.buildSessionContext().messages;
    const forkEntryId = manager.appendMessage({ role: "user", content: "next question", timestamp: Date.now() });
    manager.appendSessionInfo("source-only metadata");

    const sourceFile = manager.getSessionFile();
    const sourceId = manager.getSessionId();
    const sourceLeafId = manager.getLeafId();
    const command = type === "fork" ? { type, entryId: forkEntryId } : { type, leafId: cloneLeafId };
    let releaseModelRefresh;
    let signalModelRefresh;
    const modelRefreshStarted = new Promise((resolve) => { signalModelRefresh = resolve; });
    const modelRefreshHeld = new Promise((resolve) => { releaseModelRefresh = resolve; });
    let finishPrompt;
    const wrapper = new AgentSessionWrapper({
      bindExtensions: async () => {},
      sessionId: manager.getSessionId(),
      sessionFile: sourceFile,
      sessionManager: manager,
      isStreaming: false,
      isCompacting: false,
      isBashRunning: false,
      prompt: (message, options) => new Promise((resolve) => {
        manager.appendMessage({ role: "user", content: message, timestamp: Date.now() });
        finishPrompt = resolve;
        options.preflightResult?.(true);
      }),
      modelRuntime: {
        getModel: () => undefined,
        refresh: async () => {
          signalModelRefresh();
          await modelRefreshHeld;
        },
      },
      extensionRunner: { emit: async () => {} },
      agent: { state: {} },
      dispose() {},
    });

    try {
      const modelChange = wrapper.send({ type: "set_model", provider: "test", modelId: "missing" });
      await modelRefreshStarted;
      await assert.rejects(
        wrapper.send(command),
        new RegExp(`Cannot ${type} while another session command is running`),
      );
      releaseModelRefresh();
      await assert.rejects(modelChange, /Model not found/);

      await wrapper.send({ type: "prompt", message: "keep this run active" });
      await assert.rejects(
        wrapper.send(command),
        new RegExp(`Cannot ${type} while the session is running`),
      );
      assert.ok(finishPrompt);
      finishPrompt();
      await new Promise((resolve) => setImmediate(resolve));

      const leafBeforeFork = manager.getLeafId();
      const result = await wrapper.send(command);
      assert.equal(wrapper.isActive(), true, "creating a child must leave the source active");
      assert.equal(wrapper.sessionId, sourceId);
      assert.equal(wrapper.sessionFile, sourceFile);
      assert.equal(manager.getLeafId(), leafBeforeFork);
      assert.notEqual(result.newSessionId, sourceId);

      const secondResult = await wrapper.send(command);
      assert.notEqual(secondResult.newSessionId, result.newSessionId);
      await wrapper.send({ type: "prompt", message: "continue the source" });
      finishPrompt();
      await new Promise((resolve) => setImmediate(resolve));
      const source = SessionManager.open(sourceFile, sessionDir);
      assert.equal(source.getSessionId(), sourceId);
      assert.equal(source.getEntry(sourceLeafId).name, "source-only metadata");
      assert.equal(source.buildSessionContext().messages.at(-1).content, "continue the source");

      const sessions = await SessionManager.list(root, sessionDir);
      assert.equal(sessions.length, 3);
      for (const childId of [result.newSessionId, secondResult.newSessionId]) {
        const childInfo = sessions.find((session) => session.id === childId);
        assert.ok(childInfo);
        const child = SessionManager.open(childInfo.path, sessionDir);
        assert.equal(child.getHeader().parentSession, sourceFile);
        assert.equal(child.getLeafId(), cloneLeafId);
        assert.deepEqual(child.buildSessionContext().messages, expectedMessages);
      }
    } finally {
      await wrapper.shutdown();
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("cancelled session replacement releases its lock", async () => {
  const manager = SessionManager.inMemory(tmpdir());
  let autoRetryEnabled = false;
  const wrapper = new AgentSessionWrapper({
    bindExtensions: async () => {},
    sessionId: manager.getSessionId(),
    sessionManager: manager,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    setAutoRetryEnabled: (enabled) => { autoRetryEnabled = enabled; },
    extensionRunner: { emit: async () => {} },
    agent: { state: {} },
    dispose() {},
  });

  try {
    assert.deepEqual(await wrapper.send({ type: "fork", entryId: "missing" }), { cancelled: true });
    await wrapper.send({ type: "set_auto_retry", enabled: true });
    assert.equal(autoRetryEnabled, true);
  } finally {
    wrapper.destroy();
  }
});

test("clone cancels an assistant-free branch without creating a file", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-clone-empty-"));
  const sessionDir = join(root, "sessions");
  await mkdir(sessionDir);
  const manager = SessionManager.create(root, sessionDir);
  manager.appendMessage({ role: "user", content: "no assistant yet", timestamp: Date.now() });
  const sourceFile = manager.getSessionFile();
  const wrapper = new AgentSessionWrapper({
    bindExtensions: async () => {},
    sessionId: manager.getSessionId(),
    sessionFile: sourceFile,
    sessionManager: manager,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    extensionRunner: { emit: async () => {} },
    agent: { state: {} },
    dispose() {},
  });

  try {
    assert.deepEqual(await wrapper.send({ type: "clone" }), { cancelled: true });
    assert.equal((await SessionManager.list(root, sessionDir)).length, 0);
  } finally {
    wrapper.destroy();
    await rmdir(sessionDir);
    await rmdir(root);
  }
});

test("get_tools returns complete SDK tool definitions with their active state", async (t) => {
  const tools = [
    {
      name: "read",
      description: "Read a file",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      promptGuidelines: ["Prefer reading whole files"],
    },
    {
      name: "bash",
      description: "Run a shell command",
      parameters: { type: "object", properties: { command: { type: "string" } } },
    },
  ];
  const wrapper = new AgentSessionWrapper({
    bindExtensions: async () => {},
    isBashRunning: false,
    isStreaming: false,
    isCompacting: false,
    extensionRunner: { emit: async () => {} },
    sessionManager: { getCwd: () => "/tmp", getSessionFile: () => undefined },
    agent: { state: {} },
    getAllTools: () => tools,
    getActiveToolNames: () => ["read"],
    dispose() {},
  });
  t.after(() => wrapper.destroy());

  assert.deepEqual(await wrapper.send({ type: "get_tools" }), [
    { ...tools[0], active: true },
    { ...tools[1], active: false },
  ]);
});


test("missing working folders block activation and mutation without rewriting history", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-missing-cwd-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = join(root, "checkout");
  await mkdir(cwd);
  const manager = SessionManager.create(cwd, join(root, "sessions"));
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "history" }],
    api: "test", provider: "test", model: "test", stopReason: "stop", timestamp: Date.now(),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
  const file = manager.getSessionFile();
  const { readFile } = await import("node:fs/promises");
  const before = await readFile(file, "utf8");
  let changes = 0;
  const wrapper = new AgentSessionWrapper({
    sessionId: manager.getSessionId(), sessionFile: file, sessionManager: manager,
    bindExtensions: async () => {}, isStreaming: false, isCompacting: false, isBashRunning: false,
    extensionRunner: { emit: async () => {} }, agent: { state: {} }, dispose() {},
    setAutoRetryEnabled: () => { changes++; },
  });
  t.after(() => wrapper.destroy());
  await rmdir(cwd);
  for (const type of ["prompt", "fork", "clone", "compact", "bash", "set_auto_retry", "extension_ui_input"]) {
    await assert.rejects(wrapper.send({ type }), /read-only/);
  }
  await assert.rejects(startRpcSession(manager.getSessionId(), file, undefined), /read-only/);
  await assert.rejects(setRpcSessionTools(beginRpcSessionOperation(manager.getSessionId()), file, []), /read-only/);
  assert.equal(await readFile(file, "utf8"), before);
  assert.equal(changes, 0);
  await mkdir(cwd);
  await wrapper.send({ type: "set_auto_retry", enabled: true });
  assert.equal(changes, 1);
});
