import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from "node:fs/promises";
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

function readServerSentEvents(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  return {
    async next(timeoutMs = 5000) {
      for (;;) {
        const separator = buffered.indexOf("\n\n");
        if (separator !== -1) {
          const raw = buffered.slice(0, separator);
          buffered = buffered.slice(separator + 2);
          const data = /^data: (.*)$/m.exec(raw)?.[1];
          return { event: /^event: (.*)$/m.exec(raw)?.[1], data: data ? JSON.parse(data) : undefined };
        }
        const chunk = await Promise.race([
          reader.read(),
          new Promise((_resolve, reject) => {
            setTimeout(() => reject(new Error(`no SSE event within ${timeoutMs}ms`)), timeoutMs).unref();
          }),
        ]);
        if (chunk.done) throw new Error("SSE stream ended");
        buffered += decoder.decode(chunk.value, { stream: true });
      }
    },
    cancel: () => reader.cancel(),
  };
}

async function replaceAtomically(filePath, content) {
  await writeFile(`${filePath}.tmp`, content);
  await rename(`${filePath}.tmp`, filePath);
}

test("file watching keeps reporting changes across same-path replacements", async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-web-watch-route-agent-"));
  const dir = await realpath(await mkdtemp(join(tmpdir(), "pi-web-watch-route-")));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousRoots = globalThis.__piAdditionalAllowedRoots;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  globalThis.__piAdditionalAllowedRoots = undefined;
  let events;
  t.after(async () => {
    await events?.cancel();
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    globalThis.__piAdditionalAllowedRoots = previousRoots;
    await rm(agentDir, { recursive: true, force: true });
    await rm(dir, { recursive: true, force: true });
  });
  await mkdir(join(agentDir, "sessions"));
  const filePath = join(dir, "watched.txt");
  await writeFile(filePath, "first");
  allowFileRoot(dir);

  const response = await GET(
    new Request(`http://localhost/api/files${filePath}?type=watch`),
    { params: Promise.resolve({ path: filePath.split("/").filter(Boolean) }) },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/event-stream");
  events = readServerSentEvents(response);
  assert.equal((await events.next()).event, "connected");

  await replaceAtomically(filePath, "second version");
  const first = await events.next();
  assert.equal(first.event, "change");
  assert.equal(first.data.size, "second version".length);

  await replaceAtomically(filePath, "third");
  const second = await events.next();
  assert.equal(second.event, "change");
  assert.equal(second.data.size, "third".length);
});
