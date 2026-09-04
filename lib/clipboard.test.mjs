import assert from "node:assert/strict";
import test, { after } from "node:test";
import { Window } from "happy-dom";
import { createJiti } from "jiti";

process.env.NODE_ENV = "test";
const window = new Window({ url: "http://localhost" });
Object.assign(globalThis, { document: window.document });
after(() => window.happyDOM.close());

const { copyText } = await createJiti(import.meta.url).import("./clipboard.ts");

// navigator is a getter on globalThis in Node, so it must be redefined, not assigned.
function withNavigator(value, run) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value, configurable: true });
  return Promise.resolve().then(run).finally(() => Object.defineProperty(globalThis, "navigator", original));
}

function withExecCommand(impl, run) {
  document.execCommand = impl;
  return Promise.resolve().then(run).finally(() => { delete document.execCommand; });
}

test("uses the Clipboard API when the context is secure", async () => {
  const written = [];
  await withNavigator({ clipboard: { writeText: async (t) => { written.push(t); } } }, () => copyText("hello"));
  assert.deepEqual(written, ["hello"]);
});

test("falls back to execCommand outside a secure context and resolves when it copies", async () => {
  await withNavigator({}, () => withExecCommand(() => true, () => copyText("hello")));
  assert.equal(document.querySelector("textarea"), null, "the scratch textarea must not leak");
});

test("rejects when execCommand refuses, so callers cannot report a copy that did not happen", async () => {
  await withNavigator({}, () => withExecCommand(() => false, () =>
    assert.rejects(copyText("hello"), { message: "The browser refused to copy to the clipboard" }),
  ));
  assert.equal(document.querySelector("textarea"), null, "the scratch textarea must not leak on refusal");
});

test("rejects with the thrown error when execCommand throws", async () => {
  await withNavigator({}, () => withExecCommand(() => { throw new Error("boom"); }, () =>
    assert.rejects(copyText("hello"), { message: "boom" }),
  ));
});
