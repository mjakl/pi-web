import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { DELETE: deleteSession, GET: getSessionDetail } = await jiti.import("./[id]/route.ts");
const { GET: getSessionState } = await jiti.import("./[id]/state/route.ts");
const { GET: getSessionContext } = await jiti.import("./[id]/context/route.ts");
const {
  cacheSessionPath,
  invalidateSessionPathCache,
} = await jiti.import("../../../lib/session-reader.ts");

test("deleting a parent preserves legacy subagent bytes and reparents generic children", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-delete-reparent-"));
  const grandparentPath = join(dir, "grandparent.jsonl");
  const parentPath = join(dir, "parent.jsonl");
  const legacyChildPath = join(dir, "legacy-child.jsonl");
  const genericChildPath = join(dir, "generic-child.jsonl");
  const parentId = "delete-reparent-parent";
  const header = (id, parentSession) => JSON.stringify({
    type: "session",
    version: 3,
    id,
    timestamp: "2026-01-01T00:00:00.000Z",
    cwd: dir,
    ...(parentSession ? { parentSession } : {}),
  });
  const legacyContent = [
    header("delete-reparent-legacy-child", parentPath),
    JSON.stringify({
      type: "custom",
      customType: "pi-web:subagent",
      id: "meta",
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      data: {
        version: 1,
        parentSessionId: parentId,
        parentSessionPath: parentPath,
        profile: "Explore",
        description: "Inspect parser",
      },
    }),
    "",
  ].join("\n");
  await writeFile(grandparentPath, `${header("delete-reparent-grandparent")}\n`);
  await writeFile(parentPath, `${header(parentId, grandparentPath)}\n`);
  await writeFile(legacyChildPath, legacyContent);
  await writeFile(genericChildPath, `${header("delete-reparent-generic-child", parentPath)}\n`);
  cacheSessionPath(parentId, parentPath);
  t.after(async () => {
    invalidateSessionPathCache(parentId);
    await rm(dir, { recursive: true, force: true });
  });

  const response = await deleteSession(
    new Request(`http://localhost/api/sessions/${parentId}`, { method: "DELETE" }),
    { params: Promise.resolve({ id: parentId }) },
  );

  assert.equal(response.status, 200);
  await assert.rejects(readFile(parentPath), { code: "ENOENT" });
  assert.equal(await readFile(legacyChildPath, "utf8"), legacyContent);
  const genericHeader = JSON.parse((await readFile(genericChildPath, "utf8")).trim());
  assert.equal(genericHeader.parentSession, grandparentPath);
});

test("directly deleting a legacy subagent session still removes it", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-delete-legacy-"));
  const parentPath = join(dir, "parent.jsonl");
  const childPath = join(dir, "legacy-child.jsonl");
  const childId = "delete-legacy-child";
  const header = (id, parentSession) => JSON.stringify({
    type: "session",
    version: 3,
    id,
    timestamp: "2026-01-01T00:00:00.000Z",
    cwd: dir,
    ...(parentSession ? { parentSession } : {}),
  });
  await writeFile(parentPath, `${header("delete-legacy-parent")}\n`);
  await writeFile(childPath, [
    header(childId, parentPath),
    JSON.stringify({ type: "custom", customType: "pi-web:subagent", data: { version: 1 } }),
    "",
  ].join("\n"));
  cacheSessionPath(childId, childPath);
  t.after(async () => {
    invalidateSessionPathCache(childId);
    await rm(dir, { recursive: true, force: true });
  });

  const response = await deleteSession(
    new Request(`http://localhost/api/sessions/${childId}`, { method: "DELETE" }),
    { params: Promise.resolve({ id: childId }) },
  );

  assert.equal(response.status, 200);
  await assert.rejects(readFile(childPath), { code: "ENOENT" });
  assert.equal(typeof await readFile(parentPath, "utf8"), "string");
});

test("deleting a session with a missing parent promotes its direct child to a root", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-delete-missing-parent-"));
  const sessionPath = join(dir, "child.jsonl");
  const directChildPath = join(dir, "direct-child.jsonl");
  const missingParentPath = join(dir, "missing-parent.jsonl");
  const sessionId = "delete-missing-parent-child";
  const directChildId = "delete-missing-parent-direct-child";
  await writeFile(sessionPath, `${JSON.stringify({
    type: "session",
    version: 3,
    id: sessionId,
    timestamp: "2026-01-01T00:00:00.000Z",
    cwd: dir,
    parentSession: missingParentPath,
  })}\n`);
  await writeFile(directChildPath, `${JSON.stringify({
    type: "session",
    version: 3,
    id: directChildId,
    timestamp: "2026-01-01T00:00:00.000Z",
    cwd: dir,
    parentSession: sessionPath,
  })}\n`);
  cacheSessionPath(sessionId, sessionPath);
  t.after(async () => {
    invalidateSessionPathCache(sessionId);
    await rm(dir, { recursive: true, force: true });
  });

  const response = await deleteSession(
    new Request(`http://localhost/api/sessions/${sessionId}`, { method: "DELETE" }),
    { params: Promise.resolve({ id: sessionId }) },
  );

  assert.equal(response.status, 200);
  await assert.rejects(readFile(sessionPath), { code: "ENOENT" });
  const [directChildHeaderLine] = (await readFile(directChildPath, "utf8")).split("\n");
  assert.equal("parentSession" in JSON.parse(directChildHeaderLine), false);
});

test("live detail and state routes work without a persisted JSONL file", async (t) => {
  const previousRegistry = globalThis.__piSessions;
  const id = "live-route-test";
  const timestamp = "2026-08-12T01:02:03.000Z";
  const entry = {
    type: "message",
    id: "u1",
    parentId: null,
    timestamp,
    message: { role: "user", content: "hello live" },
  };
  const sessionManager = {
    getHeader: () => ({ type: "session", id, cwd: "/tmp", timestamp }),
    getEntries: () => [entry],
    getLeafId: () => entry.id,
    getTree: () => [],
    getSessionName: () => undefined,
    getSessionFile: () => `/tmp/pi-web-live-route-not-persisted-${process.pid}.jsonl`,
  };
  globalThis.__piSessions = new Map([[id, {
    isAlive: () => true,
    isActive: () => true,
    isRunning: () => true,
    inner: { sessionManager },
    sessionFile: sessionManager.getSessionFile(),
    sessionId: id,
    cwd: "/tmp",
    send: async () => ({ isStreaming: true }),
  }]]);
  t.after(() => {
    globalThis.__piSessions = previousRegistry;
  });

  const routeContext = { params: Promise.resolve({ id }) };
  const detailResponse = await getSessionDetail(
    new Request(`http://localhost/api/sessions/${id}`),
    routeContext,
  );
  const stateResponse = await getSessionState(
    new Request(`http://localhost/api/sessions/${id}/state`),
    routeContext,
  );
  const detail = await detailResponse.json();

  assert.equal(detailResponse.status, 200);
  assert.equal(detail.info.transient, true);
  assert.equal(detail.info.projectRoot, "/tmp");
  assert.equal(typeof detail.info.projectKey, "string");
  assert.deepEqual(detail.context.messages.map((message) => message.content), ["hello live"]);
  assert.equal(stateResponse.status, 200);
  assert.deepEqual(await stateResponse.json(), {
    active: true,
    running: true,
    state: { isStreaming: true },
  });
});

test("detail and context routes bound history to the tail window", async (t) => {
  const previousRegistry = globalThis.__piSessions;
  const id = "live-pagination-route-test";
  const entries = [];
  for (let i = 0; i < 5000; i++) {
    entries.push({
      id: `e${i}`,
      parentId: i === 0 ? null : `e${i - 1}`,
      type: "message",
      timestamp: new Date(1000 + i * 1000).toISOString(),
      message: { role: i % 2 === 0 ? "user" : "assistant", content: `m${i}` },
    });
  }
  const sessionManager = {
    getHeader: () => ({ type: "session", id, cwd: "/tmp", timestamp: entries[0].timestamp }),
    getEntries: () => entries,
    getLeafId: () => "e4999",
    getTree: () => [],
    getSessionName: () => undefined,
    getSessionFile: () => `/tmp/pi-web-live-pagination-not-persisted-${process.pid}.jsonl`,
  };
  globalThis.__piSessions = new Map([[id, {
    isAlive: () => true,
    isActive: () => true,
    isRunning: () => false,
    inner: { sessionManager },
    sessionFile: sessionManager.getSessionFile(),
    sessionId: id,
    cwd: "/tmp",
    send: async () => ({}),
  }]]);
  t.after(() => {
    globalThis.__piSessions = previousRegistry;
  });
  const routeContext = { params: Promise.resolve({ id }) };
  const detail = async (query = "") => (await getSessionDetail(
    new Request(`http://localhost/api/sessions/${id}${query}`),
    routeContext,
  )).json();
  const context = async (query = "") => (await getSessionContext(
    new Request(`http://localhost/api/sessions/${id}/context${query}`),
    routeContext,
  )).json();

  const defaultDetail = await detail();
  assert.equal(defaultDetail.context.messages.length, 50);
  assert.equal(defaultDetail.context.entryIds[0], "e4950");
  assert.equal(defaultDetail.context.hasMore, true);
  assert.equal(defaultDetail.stats.totalMessages, 5000);
  assert.equal((await detail("?tail=5000")).context.messages.length, 1000);
  assert.equal((await detail("?tail=abc")).context.messages.length, 50);

  const defaultPage = await context();
  assert.equal(defaultPage.tail, 50);
  assert.equal(defaultPage.context.entryIds.length, 50);
  const olderPage = await context("?tail=5&before=e4950");
  assert.deepEqual(olderPage.context.entryIds, ["e4945", "e4946", "e4947", "e4948", "e4949"]);
  assert.equal(olderPage.before, "e4950");
  assert.equal((await context("?tail=5000&before=e4950")).context.entryIds.length, 1000);
});
