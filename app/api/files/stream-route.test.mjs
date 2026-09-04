import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET } = await jiti.import("./[...path]/route.ts");
const { allowFileRoot } = await jiti.import("@/lib/file-access");

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';

async function readAllowedFile(t, name, content, headers = {}) {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-web-stream-route-agent-"));
  const dir = await realpath(await mkdtemp(join(tmpdir(), "pi-web-stream-route-")));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousRoots = globalThis.__piAdditionalAllowedRoots;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  globalThis.__piAdditionalAllowedRoots = undefined;
  t.after(async () => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    globalThis.__piAdditionalAllowedRoots = previousRoots;
    await rm(agentDir, { recursive: true, force: true });
    await rm(dir, { recursive: true, force: true });
  });
  await mkdir(join(agentDir, "sessions"));
  const filePath = join(dir, name);
  await writeFile(filePath, content);
  allowFileRoot(dir);

  const response = await GET(
    new Request(`http://localhost/api/files${filePath}?type=read`, { headers }),
    { params: Promise.resolve({ path: filePath.split("/").filter(Boolean) }) },
  );
  return { response, body: Buffer.from(await response.arrayBuffer()) };
}

function assertSvgDocumentPolicy(response) {
  assert.equal(response.headers.get("Content-Type"), "image/svg+xml");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.match(response.headers.get("Content-Security-Policy"), /^default-src 'none';/);
  assert.match(response.headers.get("Content-Security-Policy"), /frame-ancestors 'self'/);
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
}

test("inline SVG previews carry a script-blocking content security policy", async (t) => {
  const { response, body } = await readAllowedFile(t, "probe.svg", SVG);

  assert.equal(response.status, 200);
  assertSvgDocumentPolicy(response);
  assert.equal(body.toString("utf8"), SVG);
});

test("ranged and rejected-range SVG responses keep the same security headers", async (t) => {
  const partial = await readAllowedFile(t, "probe.svg", SVG, { Range: "bytes=0-3" });
  assert.equal(partial.response.status, 206);
  assert.equal(partial.response.headers.get("Content-Range"), `bytes 0-3/${SVG.length}`);
  assertSvgDocumentPolicy(partial.response);
  assert.equal(partial.body.toString("utf8"), SVG.slice(0, 4));

  const rejected = await readAllowedFile(t, "probe.svg", SVG, { Range: `bytes=${SVG.length}-` });
  assert.equal(rejected.response.status, 416);
  assert.equal(rejected.response.headers.get("Content-Range"), `bytes */${SVG.length}`);
  assertSvgDocumentPolicy(rejected.response);
  assert.equal(rejected.body.length, 0);
});

test("other streamed previews are nosniff without a document policy", async (t) => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const { response, body } = await readAllowedFile(t, "probe.png", png);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/png");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("Content-Security-Policy"), null);
  assert.deepEqual(body, png);
});

test("rejects a path-like sessionId reference for a file outside the allowed roots", async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-web-stream-route-agent-"));
  const outside = await realpath(await mkdtemp(join(tmpdir(), "pi-web-stream-route-outside-")));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousRoots = globalThis.__piAdditionalAllowedRoots;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  globalThis.__piAdditionalAllowedRoots = undefined;
  t.after(async () => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    globalThis.__piAdditionalAllowedRoots = previousRoots;
    await rm(agentDir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });
  await mkdir(join(agentDir, "sessions"));
  const filePath = join(outside, "secret.txt");
  await writeFile(filePath, "secret");

  const sessionId = encodeURIComponent("../../sessions/foo");
  const response = await GET(
    new Request(`http://localhost/api/files${filePath}?type=read&sessionId=${sessionId}`),
    { params: Promise.resolve({ path: filePath.split("/").filter(Boolean) }) },
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Access denied" });
});
