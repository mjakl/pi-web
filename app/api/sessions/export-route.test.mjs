import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET: exportSession } = await jiti.import("./[id]/export/route.ts");
const { cacheSessionPath, invalidateSessionPathCache } = await jiti.import("../../../lib/session-reader.ts");
const { resolveHostPi } = createRequire(import.meta.url)("../../../bin/host-pi.js");

test("HTML export runs the host Pi CLI and patches its recursive helpers", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-export-route-"));
  const sessionId = "resolved-host-export";
  const sessionPath = join(dir, "session.jsonl");
  const previous = { runtime: process.env.PI_WEB_HOST_PI, agentDir: process.env.PI_CODING_AGENT_DIR };
  await writeFile(sessionPath, `${JSON.stringify({
    type: "session",
    version: 3,
    id: sessionId,
    timestamp: "2026-01-01T00:00:00.000Z",
    cwd: dir,
  })}\n`);
  process.env.PI_WEB_HOST_PI = JSON.stringify(resolveHostPi());
  process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
  cacheSessionPath(sessionId, sessionPath);
  t.after(async () => {
    for (const [name, value] of [["PI_WEB_HOST_PI", previous.runtime], ["PI_CODING_AGENT_DIR", previous.agentDir]]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    invalidateSessionPathCache(sessionId);
    await rm(dir, { recursive: true, force: true });
  });

  const response = await exportSession(
    new Request(`http://localhost/api/sessions/${sessionId}/export`),
    { params: Promise.resolve({ id: sessionId }) },
  );

  assert.equal(response.status, 200);
  const html = await response.text();
  // The host template still carries the anchors the route rewrites, and the
  // response carries the iterative replacements rather than the originals.
  assert.match(html, /function sortChildren\(root\)/);
  assert.match(html, /function markActive\(root\)/);
  assert.doesNotMatch(html, /node\.children\.forEach\(sortChildren\)/);
});
