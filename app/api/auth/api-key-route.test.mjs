import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { POST } = await jiti.import("./api-key/[provider]/route.ts");

test("saving an API key stores the trimmed credential in the agent auth file", async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-web-api-key-route-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(async () => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(agentDir, { recursive: true, force: true });
  });

  const response = await POST(
    new Request("http://localhost/api/auth/api-key/anthropic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: " sk-test " }),
    }),
    { params: Promise.resolve({ provider: "anthropic" }) },
  );

  assert.deepEqual(await response.json(), { success: true });
  assert.deepEqual(JSON.parse(await readFile(join(agentDir, "auth.json"), "utf8")), {
    anthropic: { type: "api_key", key: "sk-test" },
  });
});
