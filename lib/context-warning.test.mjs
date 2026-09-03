import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { createStorage } from "./browser-storage.test-helpers.mjs";

const jiti = createJiti(import.meta.url);
const {
  DEFAULT_DUMB_ZONE_TOKENS,
  getContextWarningLevel,
  getDumbZoneTokens,
  setDumbZoneTokens,
} = await jiti.import("./context-warning.ts");

test("context warnings turn yellow at the token threshold and red at 75 percent", () => {
  assert.equal(getContextWarningLevel(null, 100_000), "none");
  assert.equal(getContextWarningLevel({ percent: 50, contextWindow: 200_000, tokens: 99_999 }, 100_000), "none");
  assert.equal(getContextWarningLevel({ percent: 50, contextWindow: 200_000, tokens: 100_000 }, 100_000), "yellow");
  assert.equal(getContextWarningLevel({ percent: 75, contextWindow: 128_000, tokens: 96_000 }, 100_000), "red");
  assert.equal(getContextWarningLevel({ percent: 80, contextWindow: 200_000, tokens: 160_000 }, 100_000), "red");
});

test("the dumb-zone token threshold persists and defaults safely", () => {
  const storage = createStorage();
  assert.equal(getDumbZoneTokens(storage), DEFAULT_DUMB_ZONE_TOKENS);
  setDumbZoneTokens(120_000, storage);
  assert.equal(getDumbZoneTokens(storage), 120_000);
  assert.equal(getDumbZoneTokens(createStorage({ "pi-web:dumb-zone-tokens": "invalid" })), DEFAULT_DUMB_ZONE_TOKENS);
});
