import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET } = await jiti.import("./route.ts");
const { NextRequest } = await jiti.import("next/server");
const { getAdditionalAllowedRoots } = await jiti.import("../../../lib/allowed-roots.ts");
const request = (q, cwd) => GET(new NextRequest(`http://localhost/api/file-completion?${new URLSearchParams({ q, ...(cwd ? { cwd } : {}) })}`));

test("completes outside the project without granting file access", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-web-completion-route-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = path.join(root, "project");
  await mkdir(cwd);
  await writeFile(path.join(root, "outside.txt"), "");
  const allowedBefore = [...getAdditionalAllowedRoots()];
  const response = await request("../out", cwd);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { matches: [{ path: path.join(root, "outside.txt"), isDir: false }] });
  assert.deepEqual([...getAdditionalAllowedRoots()], allowedBefore);
  assert.equal((await request(path.join(root, "missing") + path.sep)).status, 404);
  assert.equal((await request("../out")).status, 400);
  assert.equal((await request("report", cwd)).status, 400);
});
