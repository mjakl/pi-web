import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  setSessionStar,
  readSessionStars,
  copySessionStars,
  updateStarAnchors,
} = await jiti.import("./session-stars.ts");
const { buildSessionContext, cacheSessionPath, invalidateSessionPathCache } =
  await jiti.import("./session-reader.ts");
const { rewindSessionFile } = await jiti.import("./session-rewind.ts");
const { readSessionRowMetadata } = await jiti.import("./session-metadata.ts");
const { PATCH } = await jiti.import("../app/api/sessions/[id]/stars/route.ts");
const { projectTreeForResponse } = await jiti.import("./project-tree.ts");
const { buildConversationRail } = await jiti.import("./conversation-rail.ts");
const {
  getRpcSession,
  AgentSessionWrapper,
  beginRpcSessionOperation,
  setRpcSessionStar,
} = await jiti.import("./rpc-manager.ts");

const answer = {
  role: "assistant",
  content: [{ type: "text", text: "An answer" }],
  provider: "test",
  model: "test",
  api: "test",
  stopReason: "stop",
  timestamp: 2,
  usage: {
    input: 0,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 1,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
};
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-stars-"));
  const manager = SessionManager.create(dir, dir);
  const user = manager.appendMessage({
    role: "user",
    content: "Question",
    timestamp: 1,
  });
  const first = manager.appendMessage(answer);
  const next = manager.appendMessage({
    role: "user",
    content: "Next question",
    timestamp: 3,
  });
  const second = manager.appendMessage({ ...answer, timestamp: 4 });
  const file = manager.getSessionFile();
  cacheSessionPath(manager.getSessionId(), file);
  t.after(async () => {
    invalidateSessionPathCache(manager.getSessionId());
    await rm(dir, { recursive: true, force: true });
  });
  return { manager, file, user, first, next, second, dir };
}

test("stars persist in the same file without entering model context; latest value wins across branches", async (t) => {
  const { manager, file, first, second } = await fixture(t);
  const context = manager.buildSessionContext().messages;
  setSessionStar(manager, first, true);
  const length = manager.getEntries().length;
  setSessionStar(manager, first, true);
  assert.equal(
    manager.getEntries().length,
    length,
    "repeated set is idempotent",
  );
  manager.branch(first);
  setSessionStar(manager, first, false);
  setSessionStar(manager, second, true);
  manager.appendCustomEntry("pi-web:star", {
    targetId: "missing",
    starred: true,
  });
  manager.appendCustomEntry("pi-web:star", {
    targetId: second,
    starred: "false",
  });
  const reopened = SessionManager.open(file);
  assert.deepEqual(readSessionStars(reopened.getEntries()), [second]);
  assert.equal(
    (await readSessionRowMetadata(file, manager.getSessionId())).starCount,
    1,
  );
  manager.branch(second);
  assert.deepEqual(manager.buildSessionContext().messages, context);
  assert.throws(
    () => setSessionStar(manager, "missing", true),
    /assistant answer/,
  );
});

test("persisted session-wide stars reveal compressed answers on inactive rail paths and disappear when unstarred", async (t) => {
  const { manager, file, user, first } = await fixture(t);
  manager.branch(user);
  const alternative = manager.appendMessage({ ...answer, timestamp: 5 });
  setSessionStar(manager, first, true);
  setSessionStar(manager, alternative, true);
  const readRail = () => {
    const reopened = SessionManager.open(file);
    const leafId = reopened.getLeafId();
    const context = buildSessionContext(reopened.getEntries(), leafId);
    return {
      context,
      graph: buildConversationRail(
        projectTreeForResponse(reopened.getTree()),
        leafId,
        context.historyAnchors.map((anchor) => anchor.id),
        context.starredEntryIds,
      ),
    };
  };
  const { context, graph } = readRail();
  assert.deepEqual(
    new Set(context.starredEntryIds),
    new Set([first, alternative]),
  );
  assert.ok(
    !context.historyAnchors.some((anchor) => anchor.id === first),
    "inactive star is not a current transcript anchor",
  );
  assert.equal(graph.find((node) => node.id === first).active, false);
  assert.equal(graph.find((node) => node.id === first).parentId, user);
  assert.equal(graph.find((node) => node.id === alternative).active, true);
  assert.equal(
    graph.find((node) => node.id === first).row,
    graph.find((node) => node.id === alternative).row,
    "sibling answers align without moving their shared fork",
  );
  setSessionStar(manager, first, false);
  const updated = readRail();
  assert.deepEqual(updated.context.starredEntryIds, [alternative]);
  assert.ok(
    !updated.graph.some((node) => node.id === first),
    "unstarred internal answer contracts back into its path",
  );
});

test("branch copies inherit current stars only for retained answers, and rewind keeps later annotations on surviving answers", async (t) => {
  const { manager, file, first, next, second, dir } = await fixture(t);
  setSessionStar(manager, first, true);
  setSessionStar(manager, second, true);
  const child = SessionManager.open(file, dir);
  child.createBranchedSession(first);
  copySessionStars(manager.getEntries(), child);
  assert.deepEqual(
    readSessionStars(SessionManager.open(child.getSessionFile()).getEntries()),
    [first],
  );
  setSessionStar(child, first, false);
  assert.deepEqual(readSessionStars(manager.getEntries()), [first, second]);
  rewindSessionFile(file, manager.getSessionId(), next);
  const reopened = SessionManager.open(file);
  assert.deepEqual(readSessionStars(reopened.getEntries()), [first]);
  assert.equal(reopened.getEntry(second), undefined);
});

test("copying a branch clears stale copied stars that were removed later", async (t) => {
  const { manager, file, first, second, dir } = await fixture(t);
  manager.branch(first);
  setSessionStar(manager, first, true);
  const leaf = manager.appendMessage({ ...answer, timestamp: 5 });
  setSessionStar(manager, first, false);
  setSessionStar(manager, second, true);
  const child = SessionManager.open(file, dir);
  child.createBranchedSession(leaf);
  copySessionStars(manager.getEntries(), child);
  assert.deepEqual(readSessionStars(child.getEntries()), []);
});

test("paged rail includes unloaded starred answers and loads their whole turn for navigation", async (t) => {
  const { manager, first, user } = await fixture(t);
  setSessionStar(manager, first, true);
  const context = buildSessionContext(
    manager.getEntries(),
    manager.getLeafId(),
    { tail: 2 },
  );
  assert.ok(!context.entryIds.includes(first));
  assert.ok(
    context.historyAnchors.some(
      (anchor) => anchor.id === first && anchor.starred,
    ),
  );
  const older = buildSessionContext(
    manager.getEntries(),
    context.oldestEntryId,
    { tail: 2, excludeLeaf: true, throughEntryId: first },
  );
  assert.deepEqual(older.entryIds.slice(0, 2), [user, first]);
});

test("toggle projection preserves unloaded stars and inserts the loaded answer in transcript order", () => {
  const anchors = [
    { id: "old", preview: "Older preview" },
    { id: "old-answer", starred: true },
    { id: "u" },
    { id: "u2" },
  ];
  const messages = [
    { role: "user", content: "First prompt", timestamp: 1 },
    answer,
    { role: "user", content: "Second prompt", timestamp: 3 },
  ];
  const next = updateStarAnchors(
    anchors,
    messages,
    ["u", "a", "u2"],
    ["old-answer", "a"],
  );
  assert.equal(next[0].preview, "Older preview");
  assert.equal(
    next.find((anchor) => anchor.id === "u").preview,
    "First prompt",
  );
  assert.deepEqual(
    next.map((anchor) => anchor.id),
    ["old", "old-answer", "u", "a", "u2"],
  );
  assert.deepEqual(
    updateStarAnchors(next, messages, ["u", "a", "u2"], []).map(
      (anchor) => anchor.id,
    ),
    ["old", "u", "u2"],
  );
});

test("star toggles retain loaded and unloaded compaction markers", () => {
  const anchors = [
    { id: "old-compact", compaction: true },
    { id: "compact", compaction: true },
  ];
  const next = updateStarAnchors(
    anchors,
    [{ role: "custom", customType: "compaction", timestamp: 1 }, answer],
    ["compact", "a"],
    ["a"],
  );
  assert.deepEqual(
    next.filter((anchor) => anchor.compaction).map((anchor) => anchor.id),
    ["old-compact", "compact"],
  );
});

test("star annotations do not consume the visible history page", async (t) => {
  const { manager, first, second } = await fixture(t);
  for (let index = 0; index < 60; index++)
    setSessionStar(manager, first, index % 2 === 0);
  const context = buildSessionContext(
    manager.getEntries(),
    manager.getLeafId(),
    { tail: 2 },
  );
  assert.equal(context.messages.length, 2);
  assert.equal(context.entryIds.at(-1), second);
  assert.equal(context.hasMore, true);
});

test("star endpoint annotates an inactive session without starting an agent and rejects invalid targets", async (t) => {
  const { manager, file, first, user } = await fixture(t);
  const id = manager.getSessionId();
  const request = (body) =>
    PATCH(
      new Request(`http://localhost/api/sessions/${id}/stars`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id }) },
    );
  const response = await request({ targetId: first, starred: true });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).starredEntryIds, [first]);
  assert.equal(getRpcSession(id), undefined);
  const before = await readFile(file, "utf8");
  assert.equal((await request({ targetId: user, starred: true })).status, 400);
  assert.equal(
    (await request({ targetId: first, starred: "true" })).status,
    400,
  );
  assert.equal(await readFile(file, "utf8"), before);
});

test("live stars update the owning manager", async (t) => {
  const { manager, file, first } = await fixture(t);
  const wrapper = new AgentSessionWrapper({
    sessionId: manager.getSessionId(),
    sessionFile: file,
    sessionManager: manager,
    agent: { state: {} },
    subscribe: () => () => {},
    dispose: () => {},
    extensionRunner: { emit: async () => {} },
  });
  const registry = globalThis.__piSessions;
  globalThis.__piSessions = new Map([[manager.getSessionId(), wrapper]]);
  try {
    await setRpcSessionStar(
      beginRpcSessionOperation(manager.getSessionId()),
      file,
      first,
      true,
    );
    assert.deepEqual(readSessionStars(manager.getEntries()), [first]);
    await setRpcSessionStar(
      beginRpcSessionOperation(manager.getSessionId()),
      file,
      null,
      false,
    );
    assert.deepEqual(readSessionStars(manager.getEntries()), []);
    assert.deepEqual(
      readSessionStars(SessionManager.open(file).getEntries()),
      [],
    );
  } finally {
    globalThis.__piSessions = registry;
    wrapper.destroy();
  }
});

test("clearing stars removes all branches' stars without starting an agent or changing messages", async (t) => {
  const { manager, file, first, second } = await fixture(t);
  setSessionStar(manager, first, true);
  setSessionStar(manager, second, true);
  manager.branch(first);
  manager.appendCustomEntry("test:branch", {});
  const context = manager.buildSessionContext().messages;
  const id = manager.getSessionId();
  const { DELETE } = await jiti.import(
    "../app/api/sessions/[id]/stars/route.ts",
  );
  const clear = () =>
    DELETE(
      new Request(`http://localhost/api/sessions/${id}/stars`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id }) },
    );
  const response = await clear();
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.starredEntryIds, []);
  assert.equal(result.starCount, 0);
  assert.equal(getRpcSession(id), undefined);
  const reopened = SessionManager.open(file);
  assert.deepEqual(readSessionStars(reopened.getEntries()), []);
  assert.deepEqual(reopened.buildSessionContext().messages, context);
  const after = await readFile(file, "utf8");
  assert.equal((await clear()).status, 200);
  assert.equal(
    await readFile(file, "utf8"),
    after,
    "repeated clearing writes nothing",
  );
});
