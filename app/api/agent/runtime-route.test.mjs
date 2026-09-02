import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { DELETE: stopSession } = await jiti.import("./[id]/route.ts");
const { GET: getRuntimeSnapshot } = await jiti.import("./running/route.ts");
const {
  cacheSessionPath,
  invalidateSessionPathCache,
} = await jiti.import("../../../lib/session-reader.ts");

function context(id) {
  return { params: Promise.resolve({ id }) };
}

test("stopping an active runtime returns true and waits until it is inactive", async (t) => {
  const previousRegistry = globalThis.__piSessions;
  const previousLifecycles = globalThis.__piSessionLifecycles;
  const id = "stop-active-runtime";
  let manual = false;
  const wrapper = {
    sessionId: id,
    isActive: () => true,
    isAlive: () => true,
    isRunning: () => true,
    async shutdown(options) {
      manual = options?.manual === true;
      globalThis.__piSessions.delete(id);
    },
  };
  globalThis.__piSessions = new Map([[id, wrapper]]);
  globalThis.__piSessionLifecycles = new Map();
  t.after(() => {
    globalThis.__piSessions = previousRegistry;
    globalThis.__piSessionLifecycles = previousLifecycles;
  });

  const response = await stopSession(
    new Request(`http://localhost/api/agent/${id}`, { method: "DELETE" }),
    context(id),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { stopped: true });
  assert.equal(manual, true);
  assert.equal(globalThis.__piSessions.has(id), false);
});

test("stopping a persisted inactive runtime returns false", async (t) => {
  const previousRegistry = globalThis.__piSessions;
  const previousLifecycles = globalThis.__piSessionLifecycles;
  const dir = await mkdtemp(join(tmpdir(), "pi-web-stop-route-"));
  const id = "stop-persisted-runtime";
  const file = join(dir, "session.jsonl");
  await writeFile(file, `${JSON.stringify({
    type: "session",
    version: 3,
    id,
    timestamp: "2026-01-01T00:00:00.000Z",
    cwd: dir,
  })}\n`);
  cacheSessionPath(id, file);
  globalThis.__piSessions = new Map();
  globalThis.__piSessionLifecycles = new Map();
  t.after(async () => {
    invalidateSessionPathCache(id);
    globalThis.__piSessions = previousRegistry;
    globalThis.__piSessionLifecycles = previousLifecycles;
    await rm(dir, { recursive: true, force: true });
  });

  const response = await stopSession(
    new Request(`http://localhost/api/agent/${id}`, { method: "DELETE" }),
    context(id),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { stopped: false });
});

test("stopping an unknown runtime returns 404", async (t) => {
  const previousRegistry = globalThis.__piSessions;
  const previousLifecycles = globalThis.__piSessionLifecycles;
  globalThis.__piSessions = new Map();
  globalThis.__piSessionLifecycles = new Map();
  t.after(() => {
    globalThis.__piSessions = previousRegistry;
    globalThis.__piSessionLifecycles = previousLifecycles;
  });

  const id = `missing-stop-runtime-${Date.now()}`;
  const response = await stopSession(
    new Request(`http://localhost/api/agent/${id}`, { method: "DELETE" }),
    context(id),
  );

  assert.equal(response.status, 404);
});

test("runtime snapshot exposes active IDs separately from running IDs", async (t) => {
  const previousRegistry = globalThis.__piSessions;
  globalThis.__piSessions = new Map([
    ["idle", {
      sessionId: "idle",
      isAlive: () => true,
      isRunning: () => false,
    }],
    ["running", {
      sessionId: "running",
      isActive: () => true,
      isRunning: () => true,
    }],
  ]);
  t.after(() => { globalThis.__piSessions = previousRegistry; });

  const response = await getRuntimeSnapshot();
  const body = await response.json();

  assert.deepEqual(new Set(body.activeSessionIds), new Set(["idle", "running"]));
  assert.deepEqual(body.runningSessionIds, ["running"]);
});
