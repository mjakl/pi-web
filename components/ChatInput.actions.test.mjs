import assert from "node:assert/strict";
import test, { after } from "node:test";
import { Window } from "happy-dom";
import { createJiti } from "jiti";

process.env.NODE_ENV = "test";
const window = new Window({ url: "http://localhost", width: 390, height: 844 });
Object.assign(globalThis, {
  window, document: window.document, HTMLElement: window.HTMLElement, Event: window.Event,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  IS_REACT_ACT_ENVIRONMENT: true,
});
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { createRoot } = await jiti.import("react-dom/client");
const { ChatInput } = await jiti.import("./ChatInput.tsx");
const { CompactButton } = await jiti.import("./CompactButton.tsx");
after(() => window.happyDOM.close());

async function withComposer(props, check) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = async (overrides = {}) => React.act(() => root.render(React.createElement(ChatInput, { ...props, ...overrides })));
  try {
    await render();
    const input = container.querySelector("textarea");
    const type = async (text) => React.act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set.call(input, text);
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    const key = async (name, { altGraph = false, ...options } = {}, eventType = "keydown") => React.act(() => {
      const event = new window.KeyboardEvent(eventType, { key: name, bubbles: true, cancelable: true, ...options });
      // Happy DOM aliases AltGraph to Alt; browsers distinguish them.
      const getModifierState = event.getModifierState.bind(event);
      event.getModifierState = modifier => modifier === "AltGraph" ? altGraph : getModifierState(modifier);
      input.dispatchEvent(event);
    });
    await check({ container, input, type, key, render, action: () => container.querySelector(".composer-action-primary") });
  } finally { await React.act(() => root.unmount()); container.remove(); }
}

test("the action switches between Send, Stop, Steer, and transient keyboard Queue", async () => {
  const sent = [], steered = [], queued = [];
  let aborts = 0;
  await withComposer({ isStreaming: false, onSend: text => sent.push(text), onSteer: text => steered.push(text), onFollowUp: text => queued.push(text), onAbort: () => aborts++ }, async ({ action, type, key, render, input, container }) => {
    assert.equal(action().getAttribute("aria-label"), "Send");
    assert.equal(action().disabled, true);
    await type("First prompt");
    await React.act(() => action().click());
    assert.deepEqual(sent, ["First prompt"]);
    await render({ isStreaming: true });
    assert.equal(action().getAttribute("aria-label"), "Stop agent");
    await type("Next prompt");
    assert.equal(action().getAttribute("aria-label"), "Steer");
    await key("Alt", { altKey: true });
    assert.equal(action().getAttribute("aria-label"), "Queue");
    await key("Alt", {}, "keyup");
    assert.equal(action().getAttribute("aria-label"), "Steer");
    await key("AltGraph", { altKey: true, ctrlKey: true, altGraph: true });
    assert.equal(action().getAttribute("aria-label"), "Steer");
    // Alt+Enter works with a hardware keyboard even at the mobile width.
    await key("Enter", { altKey: true });
    assert.deepEqual(queued, ["Next prompt"]);
    assert.equal(input.value, "");
    assert.equal(action().getAttribute("aria-label"), "Stop agent");
    await type("Keep this draft");
    await key("Alt", { altKey: true });
    await React.act(() => window.dispatchEvent(new window.Event("blur")));
    assert.equal(action().getAttribute("aria-label"), "Steer");
    await React.act(() => container.querySelector(".menu-composer-controls button").click());
    assert.equal(aborts, 1);
    assert.equal(input.value, "Keep this draft");
    await render({ isStreaming: false });
    assert.equal(action().getAttribute("aria-label"), "Send");
    assert.deepEqual(steered, []);
  });
});

test("touch steers, composition and Shift+Enter do not submit, and non-steerable work remains stoppable", async () => {
  const steered = [], queued = [];
  let aborts = 0;
  await withComposer({ isStreaming: true, onSend() { assert.fail("busy"); }, onSteer: text => steered.push(text), onFollowUp: text => queued.push(text), onAbort: () => aborts++ }, async ({ action, type, key, render, input }) => {
    await type("Draft");
    await key("Enter", { shiftKey: true });
    await key("Enter", { isComposing: true, altKey: true });
    await key("Enter"); // Touch keyboard Enter remains a newline.
    assert.equal(input.value, "Draft");
    assert.deepEqual(steered, []);
    assert.deepEqual(queued, []);
    await key("Alt", { altKey: true });
    await React.act(() => {
      action().dispatchEvent(new window.PointerEvent("pointerdown", { pointerType: "touch", bubbles: true }));
    });
    assert.equal(action().getAttribute("aria-label"), "Steer");
    await React.act(() => action().dispatchEvent(new window.MouseEvent("click", { bubbles: true, altKey: true })));
    assert.deepEqual(steered, ["Draft"]);
    assert.deepEqual(queued, []);
    await type("Draft during shell command");
    await render({ onSteer: undefined, onFollowUp: undefined });
    await key("Enter", { altKey: true });
    assert.equal(input.value, "Draft during shell command");
    assert.equal(action().getAttribute("aria-label"), "Stop agent");
    await React.act(() => action().click());
    assert.equal(aborts, 1);
    assert.equal(input.value, "Draft during shell command");
  });
});

test("the top bar invokes the current compaction or cancellation callback", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  const calls = [];
  try {
    for (const compacting of [false, true]) {
      await React.act(() => root.render(React.createElement(CompactButton, { control: { disabled: false, compacting, onClick: () => calls.push(compacting ? "cancel" : "compact") } })));
      await React.act(() => container.querySelector("button").click());
    }
    assert.deepEqual(calls, ["compact", "cancel"]);
  } finally { await React.act(() => root.unmount()); }
});
