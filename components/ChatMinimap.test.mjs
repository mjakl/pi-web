import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { createJiti } from "jiti";
import { readFileSync } from "node:fs";

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

test("paints the rail on the whole chat pane only while desktop navigation is visible", async () => {
  const style = document.createElement("style");
  style.textContent = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  document.head.append(style);
  const container = document.createElement("section");
  container.className = "chat-window";
  document.body.append(container);
  const root = createRoot(container);
  const scroll = document.createElement("div");
  Object.defineProperty(scroll, "scrollHeight", { get: () => 2000 });
  const background = () => window.getComputedStyle(container).backgroundImage;
  try {
    window.happyDOM.setWindowSize({ width: 1024, height: 844 });
    assert.ok(!background().includes("linear-gradient"));
    await React.act(() => root.render(React.createElement(React.Fragment, null,
      React.createElement("div", { className: "chat-body" }, React.createElement(ChatMinimap, {
        messages: [{ role: "user", content: "Prompt" }], entryIds: ["prompt"],
        scrollContainer: { current: scroll }, messageRefs: { current: [] }, onLoadThrough: async () => false,
      })),
      React.createElement("footer", { className: "chat-composer" }, React.createElement("textarea")),
    )));
    await settle();
    assert.ok(container.querySelector(".chat-minimap"));
    assert.ok(background().includes("linear-gradient"), "the pane paints the strip behind both transcript and composer");
    assert.ok(!container.querySelector(".chat-minimap textarea"), "composer stays outside the navigation target");
    window.happyDOM.setWindowSize({ width: 390, height: 844 });
    // Happy DOM does not invalidate cached media-query styles on resize.
    style.remove();
    document.head.append(style);
    assert.equal(background(), "none");
    window.happyDOM.setWindowSize({ width: 1024, height: 844 });
    style.remove();
    document.head.append(style);
    assert.ok(background().includes("linear-gradient"));
    await React.act(() => root.render(null));
    assert.ok(!background().includes("linear-gradient"));
  } finally {
    await React.act(() => root.unmount());
    container.remove();
    style.remove();
    window.happyDOM.setWindowSize({ width: 1024, height: 768 });
  }
});

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
      messages: ids.map(id => ({ role: "user", content: "prompt", ...(id === "recent" ? { timestamp: new Date(2025, 0, 2, 16, 42).getTime() } : {}) })),
      entryIds: ids, historyAnchors: [{ id: "old", timestamp: new Date(2025, 0, 2, 14, 35).getTime() }, { id: "middle" }, { id: "recent" }],
      scrollContainer, messageRefs, onLoadThrough,
    })));
    await settle();
  };
  const hover = async (id) => {
    const node = container.querySelector(`[data-minimap-entry-id="${id}"]`);
    const clientY = Number.parseFloat(node.style.top) * 6;
    await React.act(() => node.parentElement.dispatchEvent(new window.MouseEvent("mousemove", { bubbles: true, clientY })));
    return node.parentElement.title;
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
    assert.match(await hover("old"), /14:35$/);
    assert.equal(pending.length, 0, "hovering unloaded history does not fetch it");
    assert.match(await hover("recent"), /16:42$/);
    assert.equal(await hover("middle"), "", "a missing timestamp clears the previous tooltip");
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
