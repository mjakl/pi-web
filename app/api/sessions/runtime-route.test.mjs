import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const listRoute = await readFile(new URL("./route.ts", import.meta.url), "utf8");
const detailRoute = await readFile(new URL("./[id]/route.ts", import.meta.url), "utf8");
const contextRoute = await readFile(new URL("./[id]/context/route.ts", import.meta.url), "utf8");
const stateRoute = await readFile(new URL("./[id]/state/route.ts", import.meta.url), "utf8");
const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { DELETE: deleteSession, GET: getSessionDetail } = await jiti.import("./[id]/route.ts");
const { GET: getSessionState } = await jiti.import("./[id]/state/route.ts");
const {
  cacheSessionPath,
  invalidateSessionPathCache,
} = await jiti.import("../../../lib/session-reader.ts");

test("session listing merges live registry identity into the uncached inventory", () => {
  assert.match(listRoute, /listAllSessions\(\)/);
  assert.doesNotMatch(listRoute, /SessionManager\.listAll/);
  assert.doesNotMatch(listRoute, /allowFileRoot/);
  assert.match(listRoute, /attachSessionProjectInfo\(getRpcSessionInfos\(\)\)/);
  assert.match(listRoute, /mergeSessionLists\(persistedSessions, runtimeSessions\)/);
  assert.match(listRoute, /if \(!inventory\.transient\)/);
  assert.match(listRoute, /delete inventory\.firstMessage/);
  assert.match(listRoute, /delete inventory\.messageCount/);
  assert.match(listRoute, /"Cache-Control": "no-store"/);
});

test("session reads use the live SessionManager before requiring a JSONL path", () => {
  for (const source of [detailRoute, contextRoute]) {
    const liveLookup = source.indexOf("getRpcSession(id)");
    const pathLookup = source.indexOf("resolveSessionPath(id)");
    assert.ok(liveLookup >= 0);
    assert.ok(pathLookup > liveLookup);
    assert.match(source, /liveRpc\?\.inner\.sessionManager \?\? SessionManager\.open/);
  }
});

test("live agent state is available before the session file is persisted", () => {
  const liveLookup = stateRoute.indexOf("getRpcSession(id)");
  const pathLookup = stateRoute.indexOf("resolveSessionPath(id)");
  assert.ok(liveLookup >= 0);
  assert.ok(pathLookup > liveLookup);
  assert.match(stateRoute, /if \(rpc && isRpcSessionActive\(rpc\)\)/);
});

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
