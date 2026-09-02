import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { POST } = await jiti.import("./route.ts");

test("does not reject requests based on their external host or origin", async () => {
  const response = await POST(new Request("http://internal:30141/api/models-config/test", {
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
  assert.deepEqual(await response.json(), { ok: false, error: "providerName is required" });
});
