import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { shouldAbortOnEscape } = await jiti.import("./useKeyboardShortcuts.ts");

test("aborts the running turn on a plain Esc", () => {
  assert.equal(shouldAbortOnEscape({ defaultPrevented: false, tagName: "DIV" }), true);
});

test("leaves the turn running when an overlay already handled Esc", () => {
  assert.equal(shouldAbortOnEscape({ defaultPrevented: true, tagName: "BUTTON" }), false);
});

test("leaves the turn running for Esc on a dialog backdrop that handled it", () => {
  assert.equal(shouldAbortOnEscape({ defaultPrevented: true, tagName: "DIALOG" }), false);
});

test("lets a textarea handle Esc itself", () => {
  assert.equal(shouldAbortOnEscape({ defaultPrevented: false, tagName: "TEXTAREA" }), false);
});

test("lets an input handle Esc itself", () => {
  assert.equal(shouldAbortOnEscape({ defaultPrevented: false, tagName: "INPUT" }), false);
});

test("tolerates an event with no element target", () => {
  assert.equal(shouldAbortOnEscape({ defaultPrevented: false, tagName: undefined }), true);
});
