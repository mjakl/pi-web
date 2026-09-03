import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const {
  advancePersistedSnapshotVersion,
  getPersistedThinkingLevel,
  isCurrentTranscriptRefresh,
  mergeTranscriptRefreshMessages,
  projectPersistedSnapshot,
  runSessionLoadPhases,
  runTranscriptNavigation,
} = await createJiti(import.meta.url).import("./transcript-refresh.ts");

const user = (content, timestamp) => ({ role: "user", content, timestamp });
const assistant = (content, timestamp) => ({
  role: "assistant",
  content: [{ type: "text", text: content }],
  model: "test-model",
  provider: "test-provider",
  timestamp,
});

test("a persisted snapshot projects every authoritative UI field together", () => {
  const messages = [user("refreshed", 1)];
  const snapshot = {
    sessionId: "session-a",
    info: { id: "session-a", path: "/session.jsonl", cwd: "/project", created: "now", modified: "now", messageCount: 1, firstMessage: "refreshed" },
    leafId: "leaf-b",
    tree: [{ id: "leaf-b", parentId: null, type: "message", label: "refreshed" }],
    toolNames: ["read", "grep", "find", "ls"],
    stats: { totalMessages: 1 },
    context: {
      messages,
      entryIds: ["leaf-b"],
      oldestEntryId: "leaf-b",
      hasMore: true,
      thinkingLevel: "high",
      model: { provider: "test", modelId: "model-b" },
    },
  };

  assert.deepEqual(projectPersistedSnapshot(snapshot), {
    data: snapshot,
    activeLeafId: "leaf-b",
    persistedMessages: messages,
    entryIds: ["leaf-b"],
    historyCursor: "leaf-b",
    hasEarlierMessages: true,
    toolPreset: "read-only",
    thinkingLevel: "high",
    sessionStatsOverride: null,
    error: null,
    metadata: snapshot.info,
  });
});

test("persisted tool projection is side-effect-free for legacy, empty, and nonempty selections", () => {
  const snapshot = (toolNames) => ({
    leafId: null,
    ...(toolNames === undefined ? {} : { toolNames }),
    context: {
      messages: [], entryIds: [], oldestEntryId: null, hasMore: false,
      thinkingLevel: null, model: null,
    },
  });

  assert.equal(projectPersistedSnapshot(snapshot(undefined)).toolPreset, "default");
  assert.equal(projectPersistedSnapshot(snapshot([])).toolPreset, "none");
  assert.equal(projectPersistedSnapshot(snapshot(["read", "grep", "find", "ls"])).toolPreset, "read-only");
  assert.equal(projectPersistedSnapshot(snapshot(["bash", "read", "edit", "write", "grep", "find", "ls"])).toolPreset, "full");
});

test("persisted snapshot projection leaves runtime state outside its boundary", () => {
  const runtime = {
    agentRunning: true,
    bashRunning: true,
    isCompacting: true,
    queuedMessages: { steering: ["keep"], followUp: [] },
    streamState: { active: true },
  };
  const snapshot = {
    leafId: null,
    context: {
      messages: [], entryIds: [], oldestEntryId: null, hasMore: false,
      thinkingLevel: null, model: null,
    },
  };

  const combined = { ...runtime, ...projectPersistedSnapshot(snapshot) };
  assert.deepEqual({
    agentRunning: combined.agentRunning,
    bashRunning: combined.bashRunning,
    isCompacting: combined.isCompacting,
    queuedMessages: combined.queuedMessages,
    streamState: combined.streamState,
  }, runtime);
});

test("a transcript refresh replaces persisted messages without losing the live tail", () => {
  const previous = [user("old", 1)];
  const liveAssistant = assistant("still running", 3);
  const current = [...previous, user("new prompt", 2), liveAssistant];
  const refreshed = [user("old", 1), user("new prompt", 20)];

  assert.deepEqual(
    mergeTranscriptRefreshMessages(refreshed, current, previous),
    [...refreshed, liveAssistant],
  );
});

test("a transcript refresh does not duplicate live messages already persisted", () => {
  const previous = [user("old", 1)];
  const completed = assistant("done", 3);
  const current = [...previous, user("new prompt", 2), completed];
  const refreshed = [user("old", 1), user("new prompt", 20), completed];

  assert.deepEqual(
    mergeTranscriptRefreshMessages(refreshed, current, previous),
    refreshed,
  );
});

test("one persisted occurrence consumes only one repeated live prompt", () => {
  const previous = [user("old", 1)];
  const first = user("same prompt", 2);
  const second = user("same prompt", 3);
  const persisted = [...previous, user("same prompt", 20)];

  assert.deepEqual(
    mergeTranscriptRefreshMessages(persisted, [...previous, first, second], previous),
    [...persisted, second],
  );
});

test("an unmatched live message keeps every later repeated occurrence", () => {
  const previous = [user("old", 1)];
  const first = user("same prompt", 2);
  const answer = assistant("first answer", 3);
  const second = user("same prompt", 4);
  const persisted = [...previous, user("same prompt", 20)];

  assert.deepEqual(
    mergeTranscriptRefreshMessages(persisted, [...previous, first, answer, second], previous),
    [...persisted, answer, second],
  );
});

test("a repeated live prompt is matched after the previous persisted boundary", () => {
  const previous = [user("same prompt", 1)];
  const live = user("same prompt", 2);
  const persisted = [...previous, user("same prompt", 20)];

  assert.deepEqual(
    mergeTranscriptRefreshMessages(persisted, [...previous, live], previous),
    persisted,
  );
});

test("deferred persisted content still identifies a completed live message", () => {
  const previous = [user("old", 1)];
  const live = {
    ...assistant("answer", 3),
    content: [
      { type: "thinking", thinking: "private reasoning" },
      { type: "text", text: "answer" },
    ],
  };
  const persisted = [
    ...previous,
    { ...live, content: [{ type: "thinking", thinking: "", deferred: true }, { type: "text", text: "answer" }] },
  ];

  assert.deepEqual(
    mergeTranscriptRefreshMessages(persisted, [...previous, live], previous),
    persisted,
  );
});

test("a bounded refresh does not restore live messages that fell before its window", () => {
  const previous = Array.from({ length: 50 }, (_, index) => user(`old ${index}`, index));
  const live = Array.from({ length: 60 }, (_, index) => assistant(`live ${index}`, 100 + index));
  const persisted = live.slice(-50);

  assert.deepEqual(
    mergeTranscriptRefreshMessages(persisted, [...previous, ...live], previous),
    persisted,
  );
});

test("runtime state still loads when a transcript load is superseded", async () => {
  const events = [];

  const state = await runSessionLoadPhases(
    async () => { events.push("transcript superseded"); return true; },
    async () => { events.push("state loaded"); return { running: true }; },
  );

  assert.deepEqual(events, ["transcript superseded", "state loaded"]);
  assert.deepEqual(state, { running: true });
});

test("a refreshed branch preserves explicit thinking and defaults missing choices to auto", () => {
  assert.equal(getPersistedThinkingLevel("low"), "low");
  assert.equal(getPersistedThinkingLevel("off"), "off");
  assert.equal(getPersistedThinkingLevel(null), "auto");
});

test("branch navigation invalidates old and in-flight refreshes before loading its context", async () => {
  const events = [];
  let revision = 0;
  let releaseNavigation;
  const navigation = new Promise((resolve) => { releaseNavigation = resolve; });

  const transition = runTranscriptNavigation(
    () => { revision += 1; events.push(`invalidate:${revision}`); },
    async () => { events.push("navigate"); await navigation; },
    async () => { events.push("load"); },
  );
  const refreshRevision = revision;

  assert.deepEqual(events, ["invalidate:1", "navigate"]);
  releaseNavigation();
  await transition;

  assert.deepEqual(events, ["invalidate:1", "navigate", "invalidate:2", "load"]);
  assert.notEqual(refreshRevision, revision);
});

test("only the latest response for the same selection, run, and baseline is current", () => {
  const request = { requestId: 2, sessionId: "session-a", runId: 4, transcriptRevision: 7 };

  assert.equal(isCurrentTranscriptRefresh(request, { ...request, transcriptRevision: 6 }), false);
  assert.equal(isCurrentTranscriptRefresh(request, request), true);
  assert.equal(isCurrentTranscriptRefresh(request, { ...request, requestId: 3 }), false);
  assert.equal(isCurrentTranscriptRefresh(request, { ...request, sessionId: "session-b" }), false);
  assert.equal(isCurrentTranscriptRefresh(request, { ...request, runId: 5 }), false);
  assert.equal(isCurrentTranscriptRefresh(request, { ...request, transcriptRevision: 8 }), false);
});

test("a local tool change rejects older Refresh tools but not a later Refresh", () => {
  const oldRefresh = { requestId: 2, sessionId: "session-a", runId: 4, transcriptRevision: 7 };
  const afterToolChange = { ...oldRefresh, ...advancePersistedSnapshotVersion(oldRefresh) };

  assert.equal(isCurrentTranscriptRefresh(oldRefresh, afterToolChange), false);

  const laterRefresh = { ...afterToolChange, ...advancePersistedSnapshotVersion(afterToolChange) };
  assert.equal(isCurrentTranscriptRefresh(laterRefresh, laterRefresh), true);
});
