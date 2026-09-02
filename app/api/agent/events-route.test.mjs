import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET } = await jiti.import("./[id]/events/route.ts");
const {
  cacheSessionPath,
  invalidateSessionPathCache,
} = await jiti.import("../../../lib/session-reader.ts");

function fakeSession(id) {
  return {
    sessionId: id,
    isAlive: () => true,
    isActive: () => true,
    isStreaming: true,
    streamingMessage: undefined,
    onEvent: () => () => {},
  };
}

// Isolated registry, lifecycle, start-lock, and agent-directory state.
async function useIsolatedRuntime(t, { sessions = new Map(), locks = new Map() } = {}) {
  const previous = {
    sessions: globalThis.__piSessions,
    lifecycles: globalThis.__piSessionLifecycles,
    locks: globalThis.__piStartLocks,
    agentDir: process.env.PI_CODING_AGENT_DIR,
  };
  const agentDir = await mkdtemp(join(tmpdir(), "pi-web-events-route-"));
  await mkdir(join(agentDir, "sessions"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  globalThis.__piSessions = sessions;
  globalThis.__piSessionLifecycles = new Map();
  globalThis.__piStartLocks = locks;
  t.after(async () => {
    globalThis.__piSessions = previous.sessions;
    globalThis.__piSessionLifecycles = previous.lifecycles;
    globalThis.__piStartLocks = previous.locks;
    if (previous.agentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous.agentDir;
    await rm(agentDir, { recursive: true, force: true });
  });
  return agentDir;
}

async function persistStoppedSession(t, agentDir, id) {
  const file = join(agentDir, "sessions", `${id}.jsonl`);
  await writeFile(file, `${JSON.stringify({
    type: "session",
    version: 3,
    id,
    timestamp: "2026-01-01T00:00:00.000Z",
    cwd: agentDir,
  })}\n`);
  cacheSessionPath(id, file);
  t.after(() => invalidateSessionPathCache(id));
  return file;
}

function requestEvents(id, query = "") {
  return GET(
    new Request(`http://localhost/api/agent/${id}/events${query}`),
    { params: Promise.resolve({ id }) },
  );
}

async function readFirstDataEvent(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  try {
    for (;;) {
      const match = /^data: (.*)$/m.exec(buffered);
      if (match) return JSON.parse(match[1]);
      const chunk = await reader.read();
      if (chunk.done) throw new Error("stream ended before a data event");
      buffered += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    await reader.cancel();
  }
}

test("an active runtime streams its connected snapshot", async (t) => {
  const id = "events-route-active";
  await useIsolatedRuntime(t, { sessions: new Map([[id, fakeSession(id)]]) });

  const response = await requestEvents(id);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/event-stream");
  assert.equal(response.headers.get("Cache-Control"), "no-cache, no-transform");
  assert.equal(response.headers.get("X-Accel-Buffering"), "no");
  assert.deepEqual(await readFirstDataEvent(response), {
    type: "connected",
    sessionId: id,
    isStreaming: true,
  });
});

test("a passive request for a stopped persisted session is refused", async (t) => {
  const id = "events-route-stopped";
  const agentDir = await useIsolatedRuntime(t);
  await persistStoppedSession(t, agentDir, id);

  const response = await requestEvents(id);

  assert.equal(response.status, 409);
  assert.equal(await response.text(), "Session is stopped");
});

test("explicit activation starts a stopped session through the shared start lock", async (t) => {
  const id = "events-route-activate";
  const session = fakeSession(id);
  const agentDir = await useIsolatedRuntime(t, {
    locks: new Map([[id, Promise.resolve({ session, realSessionId: id })]]),
  });
  await persistStoppedSession(t, agentDir, id);

  const response = await requestEvents(id, "?activate");

  assert.equal(response.status, 200);
  assert.deepEqual(await readFirstDataEvent(response), {
    type: "connected",
    sessionId: id,
    isStreaming: true,
  });
});

test("an unknown session is not found even with activation requested", async (t) => {
  await useIsolatedRuntime(t);

  const response = await requestEvents(`events-route-missing-${process.pid}`, "?activate");

  assert.equal(response.status, 404);
  assert.equal(await response.text(), "Session not found");
});
