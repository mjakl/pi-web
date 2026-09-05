import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { AgentSessionWrapper, setRpcSessionTools, beginRpcSessionOperation } = await jiti.import("./rpc-manager.ts");

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "pi-web-rewind-"));
  const manager = SessionManager.create(root, root);
  const first = manager.appendMessage({ role: "user", content: "First prompt", timestamp: 1000 });
  const answer = manager.appendMessage({
    role: "assistant", content: [{ type: "text", text: "First answer" }],
    api: "test", provider: "test", model: "test", stopReason: "stop", timestamp: 2000,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  });
  const file = manager.getSessionFile();
  let disposed = false;
  const inner = {
    bindExtensions: async () => {}, sessionId: manager.getSessionId(), sessionFile: file,
    sessionManager: manager, isStreaming: false, isBashRunning: false, isCompacting: false,
    extensionRunner: { emit: async () => {} }, agent: { state: {} },
    dispose() { disposed = true; },
  };
  const wrapper = new AgentSessionWrapper(inner);
  try { await run({ manager, wrapper, inner, file, first, answer, disposed: () => disposed }); }
  finally { if (wrapper.isAlive()) await wrapper.shutdown(); await rm(root, { recursive: true, force: true }); }
}

for (const firstMessage of [false, true]) {
  test(`rewind ${firstMessage ? "the first" : "a later"} message preserves the session identity and returns its contents`, () => fixture(async ({ manager, wrapper, file, first, disposed }) => {
    const selected = { role: "user", content: [{ type: "text", text: "Edit this" }, { type: "image", data: "aGVsbG8=", mimeType: "image/png" }], timestamp: 3000 };
    const later = manager.appendMessage(selected);
    manager.appendMessage({ role: "user", content: "Remove this too", timestamp: 4000 });
    const target = firstMessage ? first : later;
    const originalHeader = SessionManager.open(file).getHeader();
    let released = false;
    wrapper.onDestroy(() => {
      released = true;
      assert.equal(SessionManager.open(file).getEntry(target), undefined, "rewrite precedes registry release");
    });
    const result = await wrapper.send({ type: "rewind", entryId: target });
    assert.deepEqual(result.message, firstMessage ? manager.getEntry(first).message : selected);
    assert.equal(disposed(), true);
    assert.equal(released, true);
    const reopened = SessionManager.open(file);
    assert.deepEqual(reopened.getHeader(), originalHeader);
    assert.equal(reopened.getEntry(target), undefined);
    assert.deepEqual(reopened.buildSessionContext().messages.map(m => m.content), firstMessage ? [] : ["First prompt", [{ type: "text", text: "First answer" }]]);
    assert.doesNotMatch(await readFile(file, "utf8"), /Remove this too|Edit this/);
    await assert.rejects(wrapper.send({ type: "prompt", message: "must not resurrect history" }), /Session is stopped/);
    const next = reopened.appendMessage({ role: "user", content: "Replacement prompt", timestamp: 5000 });
    assert.equal(SessionManager.open(file).getEntry(next).message.content, "Replacement prompt");
  }));
}

test("rewind retains earlier branches but reopens at the selected message's parent", () => fixture(async ({ manager, wrapper, file, answer }) => {
  const otherBranch = manager.appendMessage({ role: "user", content: "Keep this older branch", timestamp: 3000 });
  manager.branch(answer);
  const target = manager.appendMessage({ role: "user", content: "Selected branch prompt", timestamp: 4000 });
  await wrapper.send({ type: "rewind", entryId: target });
  const reopened = SessionManager.open(file);
  assert.ok(reopened.getEntry(otherBranch));
  assert.equal(reopened.buildSessionContext().messages.length, 2);
  assert.equal(reopened.getEntry(reopened.getLeafId()).parentId, answer);
}));

test("invalid targets and active work leave the transcript and runtime intact", () => fixture(async ({ manager, wrapper, inner, file, first, answer, disposed }) => {
  const before = await readFile(file, "utf8");
  for (const entryId of [undefined, "missing", answer]) {
    await assert.rejects(wrapper.send({ type: "rewind", entryId }), /existing user message/);
  }
  for (const flag of ["isStreaming", "isBashRunning", "isCompacting"]) {
    inner[flag] = true;
    await assert.rejects(wrapper.send({ type: "rewind", entryId: first }), /session is running/);
    inner[flag] = false;
  }
  assert.equal(await readFile(file, "utf8"), before);
  assert.equal(disposed(), false);
  assert.ok(manager.getEntry(first));
}));

test("rewind excludes concurrent mutations until shutdown has written the shortened file", () => fixture(async ({ wrapper, inner, file, first }) => {
  let release;
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  inner.extensionRunner.emit = () => new Promise(resolve => { release = resolve; started(); });
  const rewind = wrapper.send({ type: "rewind", entryId: first });
  await entered;
  assert.ok(SessionManager.open(file).getEntry(first));
  await assert.rejects(wrapper.send({ type: "rewind", entryId: first }), /Session is stopped/);
  await assert.rejects(wrapper.send({ type: "prompt", message: "Do not run" }), /Session is stopped/);
  const previousRegistry = globalThis.__piSessions;
  globalThis.__piSessions = new Map([[wrapper.sessionId, wrapper]]);
  try {
    await assert.rejects(setRpcSessionTools(beginRpcSessionOperation(wrapper.sessionId), file, []), /Session is stopping/);
  } finally {
    globalThis.__piSessions = previousRegistry;
    release();
  }
  await rewind;
  assert.equal(SessionManager.open(file).getEntry(first), undefined);
}));

test("rewind preserves the session name, model, reasoning, and explicit Chat-only policy", () => fixture(async ({ manager, wrapper, file, first }) => {
  manager.appendSessionInfo("Keep this name");
  manager.appendModelChange("test", "kept-model");
  manager.appendThinkingLevelChange("high");
  manager.appendCustomEntry("pi-web:tool-selection", { version: 1, tools: [] });
  await wrapper.send({ type: "rewind", entryId: first });
  const reopened = SessionManager.open(file);
  assert.equal(reopened.getSessionName(), "Keep this name");
  assert.equal(reopened.buildSessionContext().messages.length, 0);
  assert.equal(reopened.buildSessionContext().thinkingLevel, "high");
  assert.deepEqual(reopened.buildSessionContext().model, { provider: "test", modelId: "kept-model" });
  assert.deepEqual(reopened.getEntries().find(entry => entry.customType === "pi-web:tool-selection").data, { version: 1, tools: [] });
}));


test("a disposal failure leaves the original history intact and releases the runtime", () => fixture(async ({ wrapper, inner, file, first }) => {
  const before = await readFile(file, "utf8");
  let released = false;
  wrapper.onDestroy(() => { released = true; });
  inner.dispose = () => { throw new Error("fixture disposal failure"); };
  await assert.rejects(wrapper.send({ type: "rewind", entryId: first }), /fixture disposal failure/);
  assert.equal(await readFile(file, "utf8"), before);
  assert.equal(released, true);
  assert.equal(wrapper.isAlive(), false);
}));
