import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const {
  canAcceptBranchContext,
  canAcceptPagination,
  canAcceptPersistedSnapshot,
  enqueuePersistedWrite,
  getPersistedThinkingLevel,
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

function createAuthorityState() {
  return {
    nextOrder: 0,
    acceptedSnapshotOrder: 0,
    acceptedTranscriptOrder: 0,
    latestCanonicalOrder: 0,
    latestRefreshOrder: 0,
    sessionId: "session-a",
    runId: 4,
  };
}

function currentAuthority(state) {
  return {
    acceptedSnapshotOrder: state.acceptedSnapshotOrder,
    acceptedTranscriptOrder: state.acceptedTranscriptOrder,
    sessionId: state.sessionId,
    runId: state.runId,
  };
}

function startSnapshot(state, channel) {
  const request = { order: ++state.nextOrder, sessionId: state.sessionId, runId: state.runId };
  if (channel === "canonical") state.latestCanonicalOrder = request.order;
  else state.latestRefreshOrder = request.order;
  return request;
}

function acceptSnapshot(state, request, channel) {
  const latestOrder = channel === "canonical" ? state.latestCanonicalOrder : state.latestRefreshOrder;
  if (!canAcceptPersistedSnapshot(request, currentAuthority(state), latestOrder)) return false;
  state.acceptedSnapshotOrder = request.order;
  state.acceptedTranscriptOrder = request.order;
  return true;
}

function startPagination(state) {
  return {
    order: ++state.nextOrder,
    sessionId: state.sessionId,
    transcriptBaseline: state.acceptedTranscriptOrder,
    refreshOrder: state.latestRefreshOrder,
  };
}

function acceptPagination(state, request) {
  if (!canAcceptPagination(request, {
    sessionId: state.sessionId,
    acceptedTranscriptOrder: state.acceptedTranscriptOrder,
    latestRefreshOrder: state.latestRefreshOrder,
  })) return false;
  state.acceptedTranscriptOrder = request.order;
  return true;
}

function acceptLocalSnapshotMutation(state) {
  state.acceptedSnapshotOrder = ++state.nextOrder;
}

function startBranch(state) {
  const request = { intentOrder: ++state.nextOrder, sessionId: state.sessionId, runId: state.runId };
  state.acceptedTranscriptOrder = request.intentOrder;
  return request;
}

function acceptBranchContext(state, request) {
  return canAcceptBranchContext(request, currentAuthority(state));
}

test("canonical and Refresh use successful acceptance in both start and completion orders", () => {
  for (const [firstChannel, secondChannel] of [["canonical", "refresh"], ["refresh", "canonical"]]) {
    for (const secondCompletesFirst of [false, true]) {
      const state = createAuthorityState();
      const first = startSnapshot(state, firstChannel);
      const second = startSnapshot(state, secondChannel);

      if (secondCompletesFirst) {
        assert.equal(acceptSnapshot(state, second, secondChannel), true);
        assert.equal(acceptSnapshot(state, first, firstChannel), false);
      } else {
        assert.equal(acceptSnapshot(state, first, firstChannel), true);
        assert.equal(acceptSnapshot(state, second, secondChannel), true);
      }
    }
  }
});

test("a failed canonical or Refresh request stamps no authority", () => {
  for (const failedChannel of ["canonical", "refresh"]) {
    const state = createAuthorityState();
    const fallbackChannel = failedChannel === "canonical" ? "refresh" : "canonical";
    const fallback = startSnapshot(state, fallbackChannel);
    startSnapshot(state, failedChannel);

    assert.equal(acceptSnapshot(state, fallback, fallbackChannel), true, failedChannel);
  }
});

test("only the latest request in each replace channel may commit", () => {
  for (const channel of ["canonical", "refresh"]) {
    const state = createAuthorityState();
    const older = startSnapshot(state, channel);
    const newer = startSnapshot(state, channel);

    assert.equal(acceptSnapshot(state, older, channel), false, channel);
    assert.equal(acceptSnapshot(state, newer, channel), true, channel);
  }
});

test("Refresh start supersedes older pagination intent", () => {
  const state = createAuthorityState();
  const page = startPagination(state);
  const refresh = startSnapshot(state, "refresh");

  assert.equal(acceptPagination(state, page), false);
  assert.equal(acceptSnapshot(state, refresh, "refresh"), true);
});

test("canonical load and pagination preserve the first accepted baseline", () => {
  for (const pageStartsFirst of [false, true]) {
    for (const pageCompletesFirst of [false, true]) {
      const state = createAuthorityState();
      const first = pageStartsFirst ? startPagination(state) : startSnapshot(state, "canonical");
      const second = pageStartsFirst ? startSnapshot(state, "canonical") : startPagination(state);
      const page = pageStartsFirst ? first : second;
      const canonical = pageStartsFirst ? second : first;

      if (pageCompletesFirst) {
        assert.equal(acceptPagination(state, page), true);
        assert.equal(acceptSnapshot(state, canonical, "canonical"), pageStartsFirst);
      } else {
        assert.equal(acceptSnapshot(state, canonical, "canonical"), true);
        assert.equal(acceptPagination(state, page), false);
      }
    }
  }
});

test("newer pagination and older Refresh use first successful completion", () => {
  for (const pageCompletesFirst of [false, true]) {
    const state = createAuthorityState();
    const refresh = startSnapshot(state, "refresh");
    const page = startPagination(state);

    if (pageCompletesFirst) {
      assert.equal(acceptPagination(state, page), true);
      assert.equal(acceptSnapshot(state, refresh, "refresh"), false);
    } else {
      assert.equal(acceptSnapshot(state, refresh, "refresh"), true);
      assert.equal(acceptPagination(state, page), false);
    }
  }
});

test("failure leaves the competing Refresh or newer pagination eligible", () => {
  const refreshFails = createAuthorityState();
  startSnapshot(refreshFails, "refresh");
  const pageAfterRefresh = startPagination(refreshFails);
  assert.equal(acceptPagination(refreshFails, pageAfterRefresh), true);

  const pageFails = createAuthorityState();
  const refresh = startSnapshot(pageFails, "refresh");
  startPagination(pageFails);
  assert.equal(acceptSnapshot(pageFails, refresh, "refresh"), true);
});

test("pagination chains from the exact accepted transcript baseline", () => {
  const state = createAuthorityState();
  const first = startPagination(state);
  assert.equal(acceptPagination(state, first), true);
  const second = startPagination(state);
  assert.equal(acceptPagination(state, second), true);

  const competing = startPagination(state);
  const winner = startPagination(state);
  assert.equal(acceptPagination(state, winner), true);
  assert.equal(acceptPagination(state, competing), false);
});

test("branch intents reject older work and keep their original authority", () => {
  const state = createAuthorityState();
  const oldRefresh = startSnapshot(state, "refresh");
  const oldPage = startPagination(state);
  const firstBranch = startBranch(state);
  const secondBranch = startBranch(state);

  assert.equal(acceptSnapshot(state, oldRefresh, "refresh"), false);
  assert.equal(acceptPagination(state, oldPage), false);
  assert.equal(acceptBranchContext(state, firstBranch), false);
  assert.equal(acceptBranchContext(state, secondBranch), true);
});

test("branch context and canonical load use transcript authority", () => {
  const branchWins = createAuthorityState();
  const oldCanonical = startSnapshot(branchWins, "canonical");
  const branch = startBranch(branchWins);
  assert.equal(acceptSnapshot(branchWins, oldCanonical, "canonical"), false);
  assert.equal(acceptBranchContext(branchWins, branch), true);

  const canonicalWins = createAuthorityState();
  const earlierBranch = startBranch(canonicalWins);
  const laterCanonical = startSnapshot(canonicalWins, "canonical");
  assert.equal(acceptSnapshot(canonicalWins, laterCanonical, "canonical"), true);
  assert.equal(acceptBranchContext(canonicalWins, earlierBranch), false);
});

test("branch context and a later Refresh use successful acceptance", () => {
  for (const refreshCompletesFirst of [false, true]) {
    const state = createAuthorityState();
    const branch = startBranch(state);
    const refresh = startSnapshot(state, "refresh");

    if (refreshCompletesFirst) {
      assert.equal(acceptSnapshot(state, refresh, "refresh"), true);
      assert.equal(acceptBranchContext(state, branch), false);
    } else {
      assert.equal(acceptBranchContext(state, branch), true);
      assert.equal(acceptSnapshot(state, refresh, "refresh"), true);
    }
  }

  const failedRefresh = createAuthorityState();
  const branch = startBranch(failedRefresh);
  startSnapshot(failedRefresh, "refresh");
  assert.equal(acceptBranchContext(failedRefresh, branch), true);
});

test("local persisted mutations reject older full snapshots without rejecting transcript-only work", () => {
  for (const mutation of ["thinking", "tools", "model"]) {
    const state = createAuthorityState();
    const refresh = startSnapshot(state, "refresh");
    const branch = startBranch(state);
    const page = startPagination(state);
    acceptLocalSnapshotMutation(state);

    assert.equal(acceptSnapshot(state, refresh, "refresh"), false, mutation);
    assert.equal(acceptBranchContext(state, branch), true, mutation);
    assert.equal(acceptPagination(state, page), true, mutation);

    const laterRefresh = startSnapshot(state, "refresh");
    assert.equal(acceptSnapshot(state, laterRefresh, "refresh"), true, mutation);
  }
});

test("session and run changes reject replacement work while pagination may cross runs", () => {
  const sessionChange = createAuthorityState();
  const sessionRefresh = startSnapshot(sessionChange, "refresh");
  const sessionPage = startPagination(sessionChange);
  sessionChange.sessionId = "session-b";
  assert.equal(acceptSnapshot(sessionChange, sessionRefresh, "refresh"), false);
  assert.equal(acceptPagination(sessionChange, sessionPage), false);

  const runChange = createAuthorityState();
  const runRefresh = startSnapshot(runChange, "refresh");
  const runBranch = startBranch(runChange);
  const runPage = startPagination(runChange);
  runChange.runId += 1;
  assert.equal(acceptSnapshot(runChange, runRefresh, "refresh"), false);
  assert.equal(acceptBranchContext(runChange, runBranch), false);
  assert.equal(acceptPagination(runChange, runPage), true);
});

test("persisted writes settle in invocation order and expose a read barrier", async () => {
  const events = [];
  let releaseFirst;
  const first = enqueuePersistedWrite(Promise.resolve(), async () => {
    events.push("write one started");
    await new Promise((resolve) => { releaseFirst = resolve; });
    events.push("write one finished");
  });
  const second = enqueuePersistedWrite(first.settled, async () => {
    events.push("write two");
  });
  const read = second.settled.then(() => events.push("read"));

  await Promise.resolve();
  assert.deepEqual(events, ["write one started"]);
  releaseFirst();
  await Promise.all([first.result, second.result, read]);
  assert.deepEqual(events, ["write one started", "write one finished", "write two", "read"]);
});

test("a failed persisted write releases later writes and reads", async () => {
  const events = [];
  const failed = enqueuePersistedWrite(Promise.resolve(), async () => {
    events.push("failed write");
    throw new Error("expected");
  });
  const next = enqueuePersistedWrite(failed.settled, async () => {
    events.push("next write");
  });
  const read = next.settled.then(() => events.push("read"));

  await assert.rejects(failed.result, /expected/);
  await Promise.all([next.result, read]);
  assert.deepEqual(events, ["failed write", "next write", "read"]);
});

test("branch context loading releases later settings before prompt submission", async () => {
  const events = [];
  let writeTail = Promise.resolve();
  let contextStarted;
  let releaseContext;
  const contextHasStarted = new Promise((resolve) => { contextStarted = resolve; });
  const contextMayFinish = new Promise((resolve) => { releaseContext = resolve; });
  const runWrite = (write) => {
    const queued = enqueuePersistedWrite(writeTail, write);
    writeTail = queued.settled;
    return queued.result;
  };

  const navigation = runTranscriptNavigation(
    () => runWrite(async () => { events.push("navigate command"); }),
    async () => {
      events.push("context read");
      contextStarted();
      await contextMayFinish;
    },
  );
  await contextHasStarted;

  runWrite(async () => { events.push("thinking command"); });
  await writeTail;
  events.push("prompt");
  assert.deepEqual(events, ["navigate command", "context read", "thinking command", "prompt"]);

  releaseContext();
  await navigation;
});
