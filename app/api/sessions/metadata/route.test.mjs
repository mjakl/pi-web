import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { POST } = await jiti.import("./route.ts");

function request(sessions) {
  return new Request("http://localhost/api/sessions/metadata", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessions }),
  });
}

test("rejects oversized and malformed metadata batches", async () => {
  const oversized = Array.from({ length: 11 }, (_, index) => ({
    id: `session-${index}`,
    fileSize: 1,
    modified: "2026-01-01T00:00:00.000Z",
  }));
  assert.equal((await POST(request(oversized))).status, 400);
  assert.equal((await POST(request([{ id: "../escape", fileSize: 1, modified: "bad" }]))).status, 400);
});

test("returns metadata only when the requested fingerprint is current", async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-web-metadata-route-"));
  const projectDir = join(agentDir, "sessions", "project");
  const id = "metadata-route-session";
  const filePath = join(projectDir, `2026-01-01_${id}.jsonl`);
  await mkdir(projectDir, { recursive: true });
  await writeFile(filePath, [
    JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-01-01T00:00:00.000Z", cwd: agentDir }),
    JSON.stringify({ type: "message", id: "u1", parentId: null, timestamp: "2026-01-01T00:00:01.000Z", message: { role: "user", content: "hello" } }),
    "",
  ].join("\n"));
  const fingerprint = await stat(filePath);
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousPathCache = globalThis.__piSessionPathCache;
  const previousReverseCache = globalThis.__piPathToSessionIdCache;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  globalThis.__piSessionPathCache = undefined;
  globalThis.__piPathToSessionIdCache = undefined;
  t.after(async () => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    globalThis.__piSessionPathCache = previousPathCache;
    globalThis.__piPathToSessionIdCache = previousReverseCache;
    await rm(agentDir, { recursive: true, force: true });
  });

  const response = await POST(request([{
    id,
    fileSize: fingerprint.size,
    modified: fingerprint.mtime.toISOString(),
  }]));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.metadata[0].firstMessage, "hello");
  assert.equal(body.metadata[0].messageCount, 1);
  assert.deepEqual(body.staleSessionIds, []);
});
