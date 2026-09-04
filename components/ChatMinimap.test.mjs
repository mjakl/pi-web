import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { createJiti } from "jiti";

process.env.NODE_ENV = "test";
const window = new Window({ url: "http://localhost" });
Object.assign(globalThis, {
  window, document: window.document, HTMLElement: window.HTMLElement,
  ResizeObserver: class { observe() {} disconnect() {} },
  IS_REACT_ACT_ENVIRONMENT: true,
});
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { createRoot } = await jiti.import("react-dom/client");
const { ChatMinimap } = await jiti.import("./ChatMinimap.tsx");
const rect = (top = 0) => ({ top, left: 0, width: 36, height: 600, bottom: top + 600, right: 36 });
Object.defineProperty(window.HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 600 });
window.HTMLElement.prototype.getBoundingClientRect = () => rect();
const settle = () => React.act(() => new Promise((resolve) => setTimeout(resolve, 230)));

test("shows unloaded turns and completes the latest requested jump after its messages mount", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const scroll = document.createElement("div");
  Object.defineProperty(scroll, "scrollHeight", { get: () => 2000 });
  const jumps = [];
  scroll.scrollTo = (options) => jumps.push(options.top);
  const scrollContainer = { current: scroll };
  const messageRefs = { current: [] };
  const pending = [];
  const onLoadThrough = (id) => new Promise((resolve) => pending.push({ id, resolve }));
  const render = async (ids) => {
    messageRefs.current = ids.map((id) => ({ getBoundingClientRect: () => rect(id === "old" ? 500 : id === "middle" ? 800 : 1000) }));
    await React.act(() => root.render(React.createElement(ChatMinimap, {
      messages: ids.map(() => ({ role: "user", content: "prompt" })),
      entryIds: ids, historyAnchorIds: ["old", "middle", "recent"],
      scrollContainer, messageRefs, onLoadThrough,
    })));
    await settle();
  };
  const select = async (id) => {
    const node = container.querySelector(`[data-minimap-entry-id="${id}"]`);
    const clientY = Number.parseFloat(node.style.top) * 6;
    await React.act(() => {
      node.parentElement.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, clientY }));
      window.dispatchEvent(new window.MouseEvent("mouseup"));
    });
  };
  try {
    await render(["recent"]);
    assert.equal(container.querySelectorAll("[data-minimap-entry-id]").length, 3);
    await select("old");
    assert.equal(pending[0].id, "old");
    assert.deepEqual(jumps, []);
    await render(["old", "middle", "recent"]);
    await React.act(() => pending[0].resolve(true));
    await settle();
    assert.equal(jumps.at(-1), 320);
    assert.equal(container.querySelector('[data-minimap-entry-id="old"]').hasAttribute("data-minimap-node-active"), true);

    // Selecting a loaded turn while a fetch is pending must cancel the old jump.
    await render(["recent"]);
    await select("old");
    await select("recent");
    const jumpCount = jumps.length;
    assert.equal(jumps.at(-1), 820);
    await render(["old", "middle", "recent"]);
    await React.act(() => pending[1].resolve(true));
    await settle();
    assert.equal(jumps.length, jumpCount);
  } finally {
    await React.act(() => root.unmount());
    container.remove();
    await window.happyDOM.close();
  }
});
