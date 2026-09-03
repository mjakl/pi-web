import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { getBrowserStorage } = await jiti.import("./browser-storage.ts");

function withWindow(value, run) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, "window");
  const previous = globalThis.window;
  if (value === undefined) delete globalThis.window;
  else globalThis.window = value;
  try {
    return run();
  } finally {
    if (had) globalThis.window = previous;
    else delete globalThis.window;
  }
}

test("returns null without a window", () => {
  assert.equal(withWindow(undefined, () => getBrowserStorage()), null);
});

test("returns the browser localStorage when it is readable", () => {
  const localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
  assert.equal(withWindow({ localStorage }, () => getBrowserStorage()), localStorage);
});

test("returns null when localStorage access throws", () => {
  const blocked = {
    get localStorage() {
      throw new Error("SecurityError");
    },
  };
  assert.equal(withWindow(blocked, () => getBrowserStorage()), null);
});
