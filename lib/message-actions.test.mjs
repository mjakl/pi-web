import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const answer = {
  role: "assistant",
  content: [{ type: "text", text: "Answer" }],
  api: "test",
  provider: "test",
  model: "test",
  stopReason: "stop",
  timestamp: 2,
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
};
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "pi-message-actions-"));
  const manager = SessionManager.create(dir, dir);
  const user = manager.appendMessage({
    role: "user",
    content: "Question",
    timestamp: 1,
  });
  const assistant = manager.appendMessage(answer);
  const custom = manager.appendCustomMessageEntry(
    "test",
    "Extension context",
    true,
  );
  const later = manager.appendMessage({
    role: "user",
    content: "Later",
    timestamp: 3,
  });
  const agent = new Agent({
    streamFn: () => {
      throw new Error("No provider calls expected");
    },
  });
  agent.state.messages = manager.buildSessionContext().messages;
  const events = [];
  const inner = {
    sessionManager: manager,
    sessionFile: manager.getSessionFile(),
    sessionId: manager.getSessionId(),
    agent,
    isStreaming: false,
    isBashRunning: false,
    isCompacting: false,
    bindExtensions: async () => {},
    dispose() {},
    extensionRunner: {
      emit: async (event) => {
        events.push(event);
      },
    },
  };
  const wrapper = new AgentSessionWrapper(inner);
  t.after(async () => {
    wrapper.destroy();
    await rm(dir, { recursive: true, force: true });
  });
  return {
    dir,
    manager,
    agent,
    inner,
    wrapper,
    events,
    user,
    assistant,
    custom,
    later,
  };
}
test("message branching keeps custom context and delivers hooks at the exact new position", async (t) => {
  const { manager, agent, wrapper, events, custom, user } = await fixture(t);
  const previousLeaf = manager.getLeafId();
  const result = await wrapper.send({
    type: "branch_from_message",
    entryId: custom,
  });
  assert.equal(result.leafId, custom);
  assert.equal(result.message, undefined);
  assert.equal(agent.state.messages.at(-1).customType, "test");
  assert.equal(
    events.find((e) => e.type === "session_before_tree").preparation.targetId,
    custom,
  );
  assert.deepEqual(
    events.find((e) => e.type === "session_tree"),
    { type: "session_tree", oldLeafId: previousLeaf, newLeafId: custom },
  );
  const root = await wrapper.send({
    type: "branch_from_message",
    entryId: user,
  });
  assert.equal(root.leafId, null);
  assert.equal(root.message.content, "Question");
  assert.deepEqual(agent.state.messages, []);
  assert.ok(manager.getEntry(previousLeaf), "original continuation survives");
});
test("cancelled navigation leaves the original leaf and context untouched", async (t) => {
  const { manager, agent, inner, wrapper, custom } = await fixture(t);
  const leaf = manager.getLeafId();
  const messages = agent.state.messages;
  inner.extensionRunner.emit = async (event) =>
    event.type === "session_before_tree" ? { cancel: true } : undefined;
  assert.deepEqual(
    await wrapper.send({ type: "branch_from_message", entryId: custom }),
    { cancelled: true },
  );
  assert.equal(manager.getLeafId(), leaf);
  assert.deepEqual(agent.state.messages, messages);
});
test("copies a fixed point during agent and shell activity; later source output remains separate", async (t) => {
  const { manager, inner, wrapper, assistant, custom, dir } = await fixture(t);
  for (const activity of ["isStreaming", "isBashRunning", "isCompacting"]) {
    inner[activity] = true;
    const leaf = manager.getLeafId();
    const sourceBefore = await readFile(manager.getSessionFile(), "utf8");
    const result = await wrapper.send({ type: "fork", entryId: custom });
    assert.equal(manager.getLeafId(), leaf);
    assert.equal(
      await readFile(manager.getSessionFile(), "utf8"),
      sourceBefore,
    );
    assert.equal(inner[activity], true);
    assert.equal(wrapper.isActive(), true);
    const info = (await SessionManager.list(dir, dir)).find(
      (s) => s.id === result.newSessionId,
    );
    const child = SessionManager.open(info.path);
    assert.equal(child.getHeader().parentSession, manager.getSessionFile());
    assert.equal(child.getLeafId(), custom);
    assert.ok(child.getEntry(assistant));
    const next = manager.appendMessage({ ...answer, timestamp: 4 });
    assert.equal(SessionManager.open(info.path).getEntry(next), undefined);
    await assert.rejects(
      wrapper.send({ type: "branch_from_message", entryId: custom }),
      /current operation/,
    );
    inner[activity] = false;
  }
});
test("copying before the first user message creates a readable empty child with the prompt returned as a draft", async (t) => {
  const { manager, wrapper, user, dir } = await fixture(t);
  const result = await wrapper.send({ type: "fork", entryId: user });
  const info = (await SessionManager.list(dir, dir)).find(
    (s) => s.id === result.newSessionId,
  );
  // Pi's listing can omit empty sessions; the runtime path cache still resolves them.
  const { resolveSessionPath } = await jiti.import("./session-reader.ts");
  const file = info?.path ?? (await resolveSessionPath(result.newSessionId));
  const child = SessionManager.open(file);
  assert.equal(child.getSessionId(), result.newSessionId);
  assert.equal(child.getHeader().parentSession, manager.getSessionFile());
  assert.deepEqual(child.buildSessionContext().messages, []);
  assert.equal(result.message.content, "Question");
});

test("copying preserves current stars and labels only for retained answers", async (t) => {
  const { manager, wrapper, assistant, custom, dir } = await fixture(t);
  const { setSessionStar, readSessionStars } =
    await jiti.import("./session-stars.ts");
  manager.appendLabelChange(assistant, "Decision");
  setSessionStar(manager, assistant, true);
  const excluded = manager.appendMessage({ ...answer, timestamp: 5 });
  setSessionStar(manager, excluded, true);
  const result = await wrapper.send({ type: "fork", entryId: custom });
  const info = (await SessionManager.list(dir, dir)).find(
    (s) => s.id === result.newSessionId,
  );
  const child = SessionManager.open(info.path);
  assert.deepEqual(readSessionStars(child.getEntries()), [assistant]);
  assert.equal(child.getLabel(assistant), "Decision");
  assert.equal(child.getEntry(excluded), undefined);
});

test("branching waits for extension cancellation and rejects conflicting commands", async (t) => {
  const { manager, agent, inner, wrapper, custom } = await fixture(t);
  const leaf = manager.getLeafId();
  const messages = [...agent.state.messages];
  let release;
  const entered = new Promise((resolve) => {
    inner.extensionRunner.emit = async (event) => {
      if (event.type !== "session_before_tree") return;
      resolve();
      return new Promise((done) => {
        release = done;
      });
    };
  });
  const branch = wrapper.send({ type: "branch_from_message", entryId: custom });
  await entered;
  await assert.rejects(
    wrapper.send({ type: "prompt", message: "Too early" }),
    /history is being changed/,
  );
  release({ cancel: true });
  assert.deepEqual(await branch, { cancelled: true });
  assert.equal(manager.getLeafId(), leaf);
  assert.deepEqual(agent.state.messages, messages);
});

test("explicit empty root context never falls back to the latest message", async (t) => {
  const { manager } = await fixture(t);
  const { buildSessionContext } = await jiti.import("./session-reader.ts");
  for (const tail of [undefined, 50]) {
    const context = buildSessionContext(manager.getEntries(), null, {
      root: true,
      tail,
    });
    assert.deepEqual(context.messages, []);
    assert.deepEqual(context.entryIds, []);
    assert.equal(context.hasMore, false);
  }
});

test("stopping while a branch hook waits cancels navigation without changing context", async (t) => {
  const { manager, agent, inner, wrapper, custom } = await fixture(t);
  const leaf = manager.getLeafId();
  const messages = [...agent.state.messages];
  let entered;
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  inner.extensionRunner.emit = async (event) => {
    if (event.type !== "session_before_tree") return;
    entered();
    await new Promise((resolve) =>
      event.signal.addEventListener("abort", resolve, { once: true }),
    );
  };
  const branch = wrapper.send({ type: "branch_from_message", entryId: custom });
  await ready;
  await wrapper.shutdown({ manual: true });
  assert.deepEqual(await branch, { cancelled: true });
  assert.equal(manager.getLeafId(), leaf);
  assert.deepEqual(agent.state.messages, messages);
});

test("assistant, tool, shell, compaction and branch-summary targets retain the selected entry without a draft", async (t) => {
  const { manager, wrapper, assistant, user, dir } = await fixture(t);
  const tool = manager.appendMessage({
    role: "toolResult",
    toolCallId: "fixture-tool",
    toolName: "bash",
    content: [{ type: "text", text: "Tool output" }],
    isError: false,
    timestamp: 4,
  });
  const shell = manager.appendMessage({
    role: "bashExecution",
    command: "echo fixture",
    output: "fixture",
    exitCode: 0,
    cancelled: false,
    truncated: false,
    timestamp: 5,
  });
  const compaction = manager.appendCompaction("Earlier context", user, 100);
  const summary = manager.branchWithSummary(compaction, "Branch context");
  for (const target of [assistant, tool, shell, compaction, summary]) {
    const copied = await wrapper.send({ type: "fork", entryId: target });
    assert.equal(copied.message, undefined);
    const info = (await SessionManager.list(dir, dir)).find(
      (s) => s.id === copied.newSessionId,
    );
    const child = SessionManager.open(info.path);
    assert.equal(child.getLeafId(), target);
    assert.ok(child.getEntry(target));
    const branched = await wrapper.send({
      type: "branch_from_message",
      entryId: target,
    });
    assert.equal(branched.leafId, target);
    assert.equal(branched.message, undefined);
  }
});
