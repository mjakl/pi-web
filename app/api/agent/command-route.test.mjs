import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { POST } = await jiti.import("./[id]/route.ts");

function registerFakeSession(t, id, send) {
  const previousRegistry = globalThis.__piSessions;
  const previousLifecycles = globalThis.__piSessionLifecycles;
  globalThis.__piSessionLifecycles = new Map();
  globalThis.__piSessions = new Map([[id, {
    sessionId: id,
    sessionFile: `/tmp/${id}.jsonl`,
    isAlive: () => true,
    isActive: () => true,
    send,
  }]]);
  t.after(() => {
    globalThis.__piSessions = previousRegistry;
    globalThis.__piSessionLifecycles = previousLifecycles;
  });
}

async function post(id, command) {
  const response = await POST(
    new Request(`http://localhost/api/agent/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(command),
    }),
    { params: Promise.resolve({ id }) },
  );
  return { status: response.status, body: await response.json() };
}

test("a prompt rejected before acceptance reports prompt_rejected", async (t) => {
  const id = "command-route-rejected-prompt";
  registerFakeSession(t, id, async () => {
    throw new Error("Authentication failed");
  });

  assert.deepEqual(await post(id, { type: "prompt", message: "hello" }), {
    status: 500,
    body: { error: "Authentication failed", code: "prompt_rejected", accepted: false },
  });
});

test("an accepted prompt succeeds without a rejection code", async (t) => {
  const id = "command-route-accepted-prompt";
  const received = [];
  registerFakeSession(t, id, async (command) => {
    received.push(command);
    return null;
  });

  assert.deepEqual(await post(id, { type: "prompt", message: "hello" }), {
    status: 200,
    body: { success: true, data: null },
  });
  assert.deepEqual(received, [{ type: "prompt", message: "hello" }]);
});

test("non-prompt command failures carry no prompt rejection code", async (t) => {
  const id = "command-route-failed-command";
  registerFakeSession(t, id, async () => {
    throw new Error("Model not found");
  });

  assert.deepEqual(await post(id, { type: "set_model", provider: "test", modelId: "missing" }), {
    status: 500,
    body: { error: "Model not found" },
  });
});
