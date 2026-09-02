import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const agentEventsSource = await readFile(new URL("./[id]/events/route.ts", import.meta.url), "utf8");
const agentEventStreamSource = await readFile(new URL("../../../lib/agent-event-stream.ts", import.meta.url), "utf8");

test("agent SSE activates only explicit live connections and disables response buffering", () => {
  assert.match(agentEventsSource, /createAgentEventStream\(req, id, sessionPromise\)/);
  assert.match(agentEventsSource, /searchParams\.has\("activate"\)/);
  assert.match(agentEventsSource, /if \(!activate\) return new Response\("Session is stopped", \{ status: 409 \}\)/);
  assert.match(agentEventsSource, /isRpcSessionActive\(activeSession\)/);
  assert.match(agentEventsSource, /sessionPromise = activateRpcSession\(operation, filePath\)/);
  assert.doesNotMatch(agentEventsSource, /await activateRpcSession\(/);
  assert.match(agentEventsSource, /if \(req\.signal\.aborted\) return new Response\(null, \{ status: 204 \}\)/);
  assert.match(agentEventsSource, /"Cache-Control": "no-cache, no-transform"/);
  assert.match(agentEventsSource, /"X-Accel-Buffering": "no"/);
});

test("agent SSE reuses one TextEncoder per stream", () => {
  assert.equal((agentEventStreamSource.match(/new TextEncoder\(\)/g) ?? []).length, 1);
  assert.match(agentEventStreamSource, /controller\.enqueue\(encoder\.encode\(/);
});
