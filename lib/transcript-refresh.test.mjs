import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const {
  getPersistedThinkingLevel,
  isCurrentTranscriptRefresh,
  mergeTranscriptRefreshMessages,
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
