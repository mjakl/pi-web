import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { createJiti } from "jiti";

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

test("mobile session controls retain reasoning, status, and compaction while keeping Stop available", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const changes = [];
  let compactions = 0;
  let aborts = 0;
  const props = {
    onSend() { assert.fail("must not send"); },
    onAbort() { aborts++; },
    onCompact() { compactions++; },
    onThinkingLevelChange(level) { changes.push(level); },
    thinkingLevel: "high",
    availableThinkingLevels: ["low", "high"],
    thinkingLevelMap: { high: "max" },
    extensionStatuses: [{ key: "mode", text: "ponytail: FULL" }],
    model: { provider: "openai", modelId: "gpt-5.4" },
    modelList: [{ provider: "openai", id: "gpt-5.4", name: "GPT-5.4" }],
    onModelChange() {},
    isStreaming: false,
  };
  try {
    await React.act(() => root.render(React.createElement(ChatInput, props)));
    const textarea = container.querySelector("textarea");
    assert.equal(textarea.placeholder, "Message…");
    const trigger = container.querySelector('button[aria-label="Session controls"]');
    assert.ok(trigger);
    const menu = document.getElementById(trigger.getAttribute("popovertarget"));
    assert.equal(menu.getAttribute("popover"), "auto");
    assert.match(menu.textContent, /ponytail: FULL/);
    const select = menu.querySelector("select");
    assert.deepEqual([...select.options].map((option) => [option.value, option.textContent]), [
      ["auto", "auto"], ["low", "low"], ["high", "max"],
    ]);
    await React.act(() => {
      select.value = "low";
      select.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    assert.deepEqual(changes, ["low"]);
    const compact = [...menu.querySelectorAll("button")].find((button) => button.textContent === "Compact context");
    await React.act(() => compact.click());
    assert.equal(compactions, 1);

    await React.act(() => root.render(React.createElement(ChatInput, { ...props, isStreaming: true })));
    assert.equal(container.querySelector('button[aria-label="Session controls"]').disabled, false);
    assert.equal(menu.querySelector("select").disabled, true);
    assert.equal(compact.disabled, true);
    assert.match(menu.textContent, /ponytail: FULL/);
    await React.act(() => container.querySelector('button[title="Stop agent"]').click());
    assert.equal(aborts, 1);

    await React.act(() => root.render(React.createElement(ChatInput, { ...props, compactWarning: true })));
    assert.ok(container.querySelector('.composer-immediate-actions button[aria-label="Compact context"]'));
    assert.equal(container.querySelector("textarea"), textarea);
  } finally {
    await React.act(() => root.unmount());
    container.remove();
    await window.happyDOM.close();
  }
});
