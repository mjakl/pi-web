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
const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { createRoot } = await jiti.import("react-dom/client");
const { useStreamingState } = await jiti.import("./useStreamingState.ts");
const message = (text) => ({
  role: "assistant",
  content: [{ type: "text", text }],
});

test("batches token bursts, preserves every delta, and publishes boundaries immediately", async (t) => {
  const container = document.createElement("div");
  const root = createRoot(container);
  let dispatch;
  let commits = 0;
  function Chat() {
    const [state, send] = useStreamingState();
    dispatch = send;
    React.useLayoutEffect(() => {
      commits += 1;
    });
    return React.createElement(
      "output",
      null,
      state.streamingMessage?.content[0]?.text ?? "idle",
    );
  }
  await React.act(() => root.render(React.createElement(Chat)));
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const send = (action) => React.act(() => dispatch(action));
  try {
    await send({ type: "snapshot", message: message("") });
    const before = commits;
    for (let i = 0; i < 100; i += 1) {
      await send({
        type: "delta",
        event: { type: "text_delta", contentIndex: 0, delta: "x" },
      });
    }
    assert.equal(commits, before, "100 chunks must not trigger 100 renders");
    await React.act(() => t.mock.timers.tick(50));
    assert.equal(commits, before + 1);
    assert.equal(container.textContent, "x".repeat(100));
    await send({
      type: "delta",
      event: { type: "text_delta", contentIndex: 0, delta: "pending" },
    });
    await send({
      type: "delta",
      event: { type: "text_end", contentIndex: 0, content: "Exact final text" },
    });
    assert.equal(container.textContent, "Exact final text");
    await send({ type: "end" });
    assert.equal(container.textContent, "idle");
    await React.act(() => t.mock.timers.tick(100));
    assert.equal(container.textContent, "idle");
  } finally {
    await React.act(() => root.unmount());
    t.mock.timers.reset();
  }
});

test("pending old text cannot overwrite a replacement snapshot or restart after unmount", async (t) => {
  const container = document.createElement("div");
  const root = createRoot(container);
  let dispatch;
  function Chat() {
    const [state, send] = useStreamingState();
    dispatch = send;
    return React.createElement(
      "output",
      null,
      state.streamingMessage?.content[0]?.text ?? "idle",
    );
  }
  await React.act(() =>
    root.render(
      React.createElement(React.StrictMode, null, React.createElement(Chat)),
    ),
  );
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const send = (action) => React.act(() => dispatch(action));
  try {
    await send({ type: "snapshot", message: message("old") });
    await send({
      type: "delta",
      event: { type: "text_delta", contentIndex: 0, delta: " pending" },
    });
    await send({ type: "start" });
    await send({ type: "snapshot", message: message("new") });
    await React.act(() => t.mock.timers.tick(100));
    assert.equal(container.textContent, "new");
    await send({
      type: "delta",
      event: { type: "text_delta", contentIndex: 0, delta: " pending" },
    });
    await React.act(() => root.unmount());
    await React.act(() => t.mock.timers.tick(100));
    assert.equal(container.textContent, "");
  } finally {
    t.mock.timers.reset();
  }
});
