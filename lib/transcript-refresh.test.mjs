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
  timestamp,
});

test("a transcript refresh replaces persisted messages without losing the live tail", () => {
  const previous = [user("old", 1)];
  const liveAssistant = assistant("still running", 3);
  const current = [...previous, user("new prompt", 2), liveAssistant];
  const refreshed = [user("old", 1), user("new prompt", 20)];

  assert.deepEqual(
    mergeTranscriptRefreshMessages(refreshed, current, previous.length),
    [...refreshed, liveAssistant],
  );
});

test("a transcript refresh does not duplicate live messages already persisted", () => {
  const previous = [user("old", 1)];
  const completed = assistant("done", 3);
  const current = [...previous, user("new prompt", 2), completed];
  const refreshed = [user("old", 1), user("new prompt", 20), completed];

  assert.deepEqual(
    mergeTranscriptRefreshMessages(refreshed, current, previous.length),
    refreshed,
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
