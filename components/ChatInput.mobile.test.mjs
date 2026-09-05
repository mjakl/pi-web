import assert from "node:assert/strict";
import test, { after } from "node:test";
import { Window } from "happy-dom";
import { createJiti } from "jiti";
import { readFileSync } from "node:fs";

process.env.NODE_ENV = "test";
const window = new Window({ url: "http://localhost", width: 390, height: 844 });
Object.assign(globalThis, {
  window, document: window.document,
  HTMLElement: window.HTMLElement, Event: window.Event,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  IS_REACT_ACT_ENVIRONMENT: true,
});
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { createRoot } = await jiti.import("react-dom/client");
const { ChatInput } = await jiti.import("./ChatInput.tsx");
const { ExtensionStatusBar } = await jiti.import("./ExtensionStatusBar.tsx");
after(() => window.happyDOM.close());

test("Session controls is mobile-only and disappears when its menu has no actions", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const props = {
    onSend() {}, onAbort() {}, onModelChange() {}, isStreaming: false,
    onThinkingLevelChange() {}, thinkingLevel: "high",
    extensionStatuses: [{ key: "mode", text: "ponytail: FULL" }],
  };
  const more = () => container.querySelector('button[aria-label="Session controls"]');
  try {
    window.happyDOM.setWindowSize({ width: 1024, height: 844 });
    await React.act(() => root.render(React.createElement(ChatInput, props)));
    assert.equal(more(), null);
    await React.act(() => root.render(React.createElement(ChatInput, { ...props, isStreaming: true })));
    assert.equal(more(), null);
    await React.act(() => window.happyDOM.setWindowSize({ width: 390, height: 844 }));
    assert.ok(more());
    assert.match(container.querySelector(".menu-composer-controls").textContent, /ponytail: FULL/);
    await React.act(() => root.render(React.createElement(ChatInput, { ...props, extensionStatuses: [] })));
    assert.equal(more(), null);
    await React.act(() => root.render(React.createElement(ChatInput, { ...props, extensionStatuses: [], isStreaming: true })));
    assert.ok(more());
    await React.act(() => container.querySelector(".menu-composer-controls").dispatchEvent(Object.assign(new window.Event("toggle"), { newState: "open", oldState: "closed" })));
    assert.equal(more().getAttribute("aria-expanded"), "true");
    await React.act(() => window.happyDOM.setWindowSize({ width: 1024, height: 844 }));
    assert.equal(more(), null);
    await React.act(() => root.render(React.createElement(ChatInput, { ...props, onModelChange: undefined })));
    assert.equal(more(), null);
    assert.ok(container.querySelector("select"), "standalone reasoning stays accessible");
    await React.act(() => window.happyDOM.setWindowSize({ width: 390, height: 844 }));
    assert.equal(more().getAttribute("aria-expanded"), "false");
  } finally {
    await React.act(() => root.unmount());
    container.remove();
    window.happyDOM.setWindowSize({ width: 390, height: 844 });
  }
});

test("More scrolls long status lists within its available space", async () => {
  const style = document.createElement("style");
  style.textContent = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  document.head.append(style);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await React.act(() => root.render(React.createElement(ChatInput, { onSend() {}, onAbort() {}, isStreaming: true })));
    const menu = container.querySelector(".menu-composer-controls");
    assert.equal(getComputedStyle(menu).overflow, "auto");
  } finally {
    await React.act(() => root.unmount());
    container.remove();
    style.remove();
  }
});

test("the combined model picker retains reasoning while More keeps Stop and extension status", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const changes = [];
  let aborts = 0;
  const props = {
    onSend() { assert.fail("must not send"); }, onAbort() { aborts++; },
    onThinkingLevelChange(level) { changes.push(level); }, thinkingLevel: "high",
    availableThinkingLevels: ["low", "high"], thinkingLevelMap: { high: "max" },
    extensionStatuses: [{ key: "mode", text: "ponytail: FULL" }],
    model: { provider: "openai", modelId: "gpt-5.4" },
    modelList: [{ provider: "openai", id: "gpt-5.4", name: "GPT-5.4" }],
    onModelChange() {}, isStreaming: false,
  };
  try {
    await React.act(() => root.render(React.createElement(ChatInput, props)));
    const textarea = container.querySelector("textarea");
    assert.equal(textarea.placeholder, "Message…");
    await React.act(() => container.querySelector('button[aria-label="Model and reasoning"]').click());
    const select = container.querySelector('select');
    assert.deepEqual([...select.options].map(option => [option.value, option.textContent]), [["auto", "auto"], ["low", "low"], ["high", "max"]]);
    await React.act(() => { select.value = "low"; select.dispatchEvent(new window.Event("change", { bubbles: true })); });
    assert.deepEqual(changes, ["low"]);
    assert.doesNotMatch(container.textContent, /Compact context/);
    await React.act(() => root.render(React.createElement(ChatInput, { ...props, isStreaming: true })));
    assert.equal(container.querySelector('button[aria-label="Model and reasoning"]').disabled, true);
    assert.equal(container.querySelector('button[aria-label="Session controls"]').disabled, false);
    const menu = container.querySelector('.menu-composer-controls');
    assert.match(menu.textContent, /ponytail: FULL/);
    await React.act(() => menu.querySelector('button').click());
    assert.equal(aborts, 1);
    assert.equal(container.querySelector("textarea"), textarea);
  } finally { await React.act(() => root.unmount()); container.remove(); }
});

test("the mobile footer keeps status updates exposed while the menu provides a non-live copy", async () => {
  const style = document.createElement("style");
  style.textContent = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  document.head.append(style);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (text, widgets = []) => React.createElement("footer", { className: "chat-composer" },
    React.createElement(ChatInput, {
      onSend() {}, onAbort() {}, isStreaming: true,
      extensionStatuses: [{ key: "mode", text }],
    }),
    React.createElement(ExtensionStatusBar, { statuses: [{ key: "mode", text }], widgets }),
  );
  try {
    for (const widgets of [[], [{ key: "usage", lines: ["Ready"], placement: "aboveEditor" }]]) {
      await React.act(() => root.render(render("Working", widgets)));
      const status = container.querySelector(".chat-composer > .extension-status-shelf [role=status]");
      assert.ok(status);
      for (let element = status; element; element = element.parentElement) {
        assert.notEqual(getComputedStyle(element).display, "none");
        assert.notEqual(getComputedStyle(element).visibility, "hidden");
      }
      assert.equal(container.querySelectorAll('.extension-status-shelf [role="status"]').length, 1);
      assert.match(container.querySelector(".menu-composer-controls").textContent, /Working/);
      await React.act(() => root.render(render("Ready", widgets)));
      assert.equal(status.textContent, "Ready");
    }
  } finally {
    await React.act(() => root.unmount());
    container.remove();
    style.remove();
  }
});
