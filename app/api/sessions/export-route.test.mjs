import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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

test("HTML export uses the resolved host Pi bundle", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-export-route-"));
  const packageDir = join(dir, "pi-coding-agent");
  const bundleDir = join(packageDir, "dist", "bundle");
  const sessionId = "resolved-host-export";
  const sessionPath = join(dir, "session.jsonl");
  const localBundle = join(process.cwd(), "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js");
  const cliPath = join(bundleDir, "cli.js");
  const previousRuntime = process.env.PI_WEB_HOST_PI;
  await mkdir(bundleDir, { recursive: true });
  await writeFile(sessionPath, `${JSON.stringify({
    type: "session",
    version: 3,
    id: sessionId,
    timestamp: "2026-01-01T00:00:00.000Z",
    cwd: dir,
  })}\n`);
  await writeFile(cliPath, [
    `import { appendFileSync } from "node:fs";`,
    `import { spawnSync } from "node:child_process";`,
    `const result = spawnSync(process.execPath, [${JSON.stringify(localBundle)}, ...process.argv.slice(2)], { env: process.env, stdio: "inherit" });`,
    `if (result.status !== 0) process.exit(result.status ?? 1);`,
    `appendFileSync(process.argv[4], "<!-- resolved-host-bundle -->");`,
  ].join("\n"));
  process.env.PI_WEB_HOST_PI = JSON.stringify({
    packages: { "@earendil-works/pi-coding-agent": { dir: packageDir } },
  });
  cacheSessionPath(sessionId, sessionPath);
  t.after(async () => {
    if (previousRuntime === undefined) delete process.env.PI_WEB_HOST_PI;
    else process.env.PI_WEB_HOST_PI = previousRuntime;
    invalidateSessionPathCache(sessionId);
    await rm(dir, { recursive: true, force: true });
  });

  const response = await exportSession(
    new Request(`http://localhost/api/sessions/${sessionId}/export`),
    { params: Promise.resolve({ id: sessionId }) },
  );

  assert.equal(response.status, 200);
  assert.match(await response.text(), /resolved-host-bundle/);
});
