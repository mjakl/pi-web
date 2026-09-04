import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("next.config.ts loads as a native ES module", async () => {
  const { default: config } = await import(new URL("./next.config.ts", import.meta.url).href);

  assert.equal(config.outputFileTracingRoot, path.dirname(fileURLToPath(import.meta.url)));
  assert.equal(typeof config.env.NEXT_PUBLIC_APP_VERSION, "string");
  assert.ok(config.serverExternalPackages.includes("@earendil-works/pi-coding-agent"));
});
