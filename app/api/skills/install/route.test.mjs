import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { POST } = await jiti.import("./route.ts");

// Pi Web has no built-in authentication and deliberately does not restrict the
// request Host or Origin. Non-loopback access is expected to be fronted by a
// trusted network or an external security layer, so a cross-site request must
// reach the handler and fail on its own validation, not on an origin check.
test("does not reject requests based on their external host or origin", async () => {
  const response = await POST(new Request("http://internal:30141/api/skills/install", {
    method: "POST",
    headers: {
      host: "pi-web.example",
      origin: "https://pi-web.example",
      "sec-fetch-site": "cross-site",
      "content-type": "application/json",
    },
    body: "{}",
  }));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "package required" });
});
