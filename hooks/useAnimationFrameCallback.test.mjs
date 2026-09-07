import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { createJiti } from "jiti";

const window = new Window();
Object.assign(globalThis, {
  window,
  document: window.document,
  IS_REACT_ACT_ENVIRONMENT: true,
});
const frames = new Map();
let nextId = 0;
window.requestAnimationFrame = (callback) => {
  const id = ++nextId;
  frames.set(id, callback);
  return id;
};
window.cancelAnimationFrame = (id) => frames.delete(id);
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" } });
const React = await jiti.import("react");
const { createRoot } = await jiti.import("react-dom/client");
const { useAnimationFrameCallback } = await jiti.import(
  "./useAnimationFrameCallback.ts",
);

test("coalesces layout requests, uses the current view, and cancels on unmount", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  const updates = [];
  let schedule;
  function View({ page }) {
    schedule = useAnimationFrameCallback(() => updates.push(page));
    return null;
  }
  const render = (page) =>
    React.act(() =>
      root.render(
        React.createElement(
          React.StrictMode,
          null,
          React.createElement(View, { page }),
        ),
      ),
    );
  try {
    await render("first");
    for (let i = 0; i < 100; i += 1) schedule();
    assert.equal(frames.size, 1);
    await render("current");
    const [id, callback] = [...frames.entries()][0];
    frames.delete(id);
    callback();
    assert.deepEqual(updates, ["current"]);
    schedule();
    assert.equal(frames.size, 1);
  } finally {
    await React.act(() => root.unmount());
  }
  assert.equal(frames.size, 0);
});
