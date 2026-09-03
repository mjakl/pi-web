import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const {
  isCurrentTranscriptRefresh,
  mergeTranscriptRefreshMessages,
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

test("only the latest response for the same selection, run, and baseline is current", () => {
  const request = { requestId: 2, sessionId: "session-a", runId: 4, transcriptRevision: 7 };

  assert.equal(isCurrentTranscriptRefresh(request, request), true);
  assert.equal(isCurrentTranscriptRefresh(request, { ...request, requestId: 3 }), false);
  assert.equal(isCurrentTranscriptRefresh(request, { ...request, sessionId: "session-b" }), false);
  assert.equal(isCurrentTranscriptRefresh(request, { ...request, runId: 5 }), false);
  assert.equal(isCurrentTranscriptRefresh(request, { ...request, transcriptRevision: 8 }), false);
});
