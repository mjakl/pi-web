import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

import { createStorage } from "../lib/browser-storage.test-helpers.mjs";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { readSoundEnabled } = await jiti.import("./useAudio.ts");

test("defaults to enabled when storage is unavailable", () => {
  assert.equal(readSoundEnabled(null), true);
});

test("defaults to enabled when nothing was ever stored", () => {
  assert.equal(readSoundEnabled(createStorage()), true);
});

test("restores a stored opt-out", () => {
  assert.equal(readSoundEnabled(createStorage({ "pi-sound-enabled": "false" })), false);
});

test("restores a stored opt-in", () => {
  assert.equal(readSoundEnabled(createStorage({ "pi-sound-enabled": "true" })), true);
});

test("treats an unrecognised stored value as opted out", () => {
  assert.equal(readSoundEnabled(createStorage({ "pi-sound-enabled": "yes" })), false);
});
