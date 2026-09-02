import assert from "node:assert/strict";
import test from "node:test";

test("resolves config paths without CommonJS globals", async () => {
  const configUrl = new URL("../next.config.ts", import.meta.url);
  const config = await import(`${configUrl.href}?esm-test`);
  assert.equal(typeof config.default.env.NEXT_PUBLIC_APP_VERSION, "string");
});
