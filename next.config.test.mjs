import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

test("scopes Next.js output file tracing to the pi-web package", async () => {
  const config = await createJiti(import.meta.url).import("./next.config.ts", { default: true });

  assert.equal(config.outputFileTracingRoot, projectRoot);
});

test("resolves config paths without CommonJS globals", async () => {
  const configUrl = new URL("./next.config.ts", import.meta.url);
  const config = await import(`${configUrl.href}?esm-test`);
  assert.equal(typeof config.default.env.NEXT_PUBLIC_APP_VERSION, "string");
});
