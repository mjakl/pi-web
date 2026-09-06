import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { POST } = await createJiti(import.meta.url, {
  tsconfigPaths: true,
}).import("./route.ts");

for (const body of [
  null,
  [],
  0,
  "subscription",
  {},
  { subscription: null },
  { subscription: { endpoint: "http://invalid", keys: {} } },
]) {
  test(`rejects an invalid subscription body: ${JSON.stringify(body)}`, async () => {
    const response = await POST(
      new Request("http://localhost/api/push/subscribe", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Invalid push subscription",
    });
  });
}

test("rejects malformed JSON separately from invalid subscriptions", async () => {
  const response = await POST(
    new Request("http://localhost/api/push/subscribe", {
      method: "POST",
      body: "{",
    }),
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Invalid JSON body" });
});
