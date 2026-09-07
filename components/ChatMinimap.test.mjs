import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { createJiti } from "jiti";
import { readFileSync } from "node:fs";

process.env.NODE_ENV = "test";
const window = new Window({ url: "http://localhost" });
const resizeCallbacks = new Set();
Object.assign(globalThis, {
  window,
  document: window.document,
  HTMLElement: window.HTMLElement,
  ResizeObserver: class {
    constructor(callback) {
      this.callback = callback;
      resizeCallbacks.add(callback);
    }
    observe() {}
    disconnect() {
      resizeCallbacks.delete(this.callback);
    }
  },
  IS_REACT_ACT_ENVIRONMENT: true,
});
const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { createRoot } = await jiti.import("react-dom/client");
const { ChatMinimap } = await jiti.import("./ChatMinimap.tsx");
const rect = (top = 0) => ({
  top,
  left: 0,
  width: 36,
  height: 600,
  bottom: top + 600,
  right: 36,
});
Object.defineProperty(window.HTMLElement.prototype, "clientHeight", {
  configurable: true,
  get: () => 600,
});
window.HTMLElement.prototype.getBoundingClientRect = () => rect();
const settle = () =>
  React.act(() => new Promise((resolve) => setTimeout(resolve, 230)));

test("content growth keeps an unchanged rail stable but refreshes moved navigation targets", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const scroll = document.createElement("div");
  let height = 2000;
  Object.defineProperty(scroll, "scrollHeight", { get: () => height });
  let anchorTop = 500;
  const jumps = [];
  scroll.scrollTo = (options) => jumps.push(options.top);
  let roleReads = 0;
  const props = {
    messages: [
      {
        get role() {
          roleReads += 1;
          return "user";
        },
        content: "Prompt",
      },
    ],
    entryIds: ["u"],
    scrollContainer: { current: scroll },
    messageRefs: {
      current: [{ getBoundingClientRect: () => rect(anchorTop) }],
    },
    onLoadThrough: async () => false,
  };
  const render = () =>
    React.act(() => root.render(React.createElement(ChatMinimap, props)));
  try {
    await render();
    await settle();
    roleReads = 0;
    for (let i = 0; i < 20; i += 1) await render();
    assert.equal(
      roleReads,
      0,
      "parent streaming updates must not rescan unchanged history",
    );
    height += 200;
    await React.act(() => {
      for (let i = 0; i < 20; i += 1)
        for (const callback of resizeCallbacks) callback();
    });
    await settle();
    anchorTop = 800;
    await React.act(() => {
      for (const callback of resizeCallbacks) callback();
    });
    await settle();
    await React.act(() => {
      container
        .querySelector(".chat-minimap")
        .dispatchEvent(
          new window.MouseEvent("mousedown", { bubbles: true, clientY: 12 }),
        );
      window.dispatchEvent(new window.MouseEvent("mouseup"));
    });
    assert.equal(
      jumps.at(-1),
      620,
      "navigation uses the refreshed anchor position",
    );
  } finally {
    await React.act(() => root.unmount());
    container.remove();
  }
});

test("paints the rail on the whole chat pane only while desktop navigation is visible", async () => {
  const style = document.createElement("style");
  style.textContent = readFileSync(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );
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
    await React.act(() =>
      root.render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(
            "div",
            { className: "chat-body" },
            React.createElement(ChatMinimap, {
              messages: [{ role: "user", content: "Prompt" }],
              entryIds: ["prompt"],
              scrollContainer: { current: scroll },
              messageRefs: { current: [] },
              onLoadThrough: async () => false,
            }),
          ),
          React.createElement(
            "footer",
            { className: "chat-composer" },
            React.createElement("textarea"),
          ),
        ),
      ),
    );
    await settle();
    assert.ok(container.querySelector(".chat-minimap"));
    assert.ok(
      background().includes("linear-gradient"),
      "the pane paints the strip behind both transcript and composer",
    );
    assert.ok(
      !container.querySelector(".chat-minimap textarea"),
      "composer stays outside the navigation target",
    );
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

test("empty and single-turn rails preserve hit testing and clear a removed hover target", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const scroll = document.createElement("div");
  Object.defineProperty(scroll, "scrollHeight", { get: () => 2000 });
  const jumps = [];
  scroll.scrollTo = (options) => jumps.push(options.top);
  const scrollContainer = { current: scroll };
  const messageRefs = { current: [] };
  const render = async (ids) => {
    messageRefs.current = ids.map((_, index) => ({
      getBoundingClientRect: () => rect(500 + index * 300),
    }));
    await React.act(() =>
      root.render(
        React.createElement(ChatMinimap, {
          messages: ids.map((id) => ({
            role: "user",
            content: id,
            timestamp: 1000,
          })),
          entryIds: ids,
          scrollContainer,
          messageRefs,
          onLoadThrough: async () =>
            assert.fail("loaded turns must not fetch history"),
        }),
      ),
    );
    await settle();
  };
  const click = async (clientY) =>
    React.act(() => {
      container
        .querySelector(".chat-minimap")
        .dispatchEvent(
          new window.MouseEvent("mousedown", { bubbles: true, clientY }),
        );
      window.dispatchEvent(new window.MouseEvent("mouseup"));
    });
  try {
    await render([]);
    await click(12);
    assert.deepEqual(jumps, []);
    await render(["first"]);
    await click(12);
    assert.deepEqual(jumps, [320]);
    await click(200);
    assert.deepEqual(
      jumps,
      [320],
      "space outside the short rail is not a target",
    );
    await render(["first", "second"]);
    const secondNode = container.querySelector(
      '[data-minimap-entry-id="second"]',
    );
    const secondY = Number.parseFloat(secondNode.style.top) * 6;
    await click(secondY);
    assert.equal(jumps.at(-1), 620, "the second dot selects its loaded turn");
    await React.act(() =>
      container.querySelector(".chat-minimap").dispatchEvent(
        new window.MouseEvent("mousemove", {
          bubbles: true,
          clientY: secondY,
        }),
      ),
    );
    assert.notEqual(container.querySelector(".chat-minimap").title, "");
    await render(["first"]);
    assert.equal(container.querySelector(".chat-minimap").title, "");
  } finally {
    await React.act(() => root.unmount());
    container.remove();
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
  const onLoadThrough = (id) =>
    new Promise((resolve) => pending.push({ id, resolve }));
  const render = async (ids) => {
    messageRefs.current = ids.map((id) => ({
      getBoundingClientRect: () =>
        rect(id === "old" ? 500 : id === "middle" ? 800 : 1000),
    }));
    await React.act(() =>
      root.render(
        React.createElement(ChatMinimap, {
          messages: ids.map((id) => ({
            role: "user",
            content: "prompt",
            ...(id === "recent"
              ? { timestamp: new Date(2025, 0, 2, 16, 42).getTime() }
              : {}),
          })),
          entryIds: ids,
          historyAnchors: [
            { id: "old", timestamp: new Date(2025, 0, 2, 14, 35).getTime() },
            { id: "middle" },
            { id: "recent" },
          ],
          scrollContainer,
          messageRefs,
          onLoadThrough,
        }),
      ),
    );
    await settle();
  };
  const hover = async (id) => {
    const node = container.querySelector(`[data-minimap-entry-id="${id}"]`);
    const clientY = Number.parseFloat(node.style.top) * 6;
    await React.act(() =>
      node.parentElement.dispatchEvent(
        new window.MouseEvent("mousemove", { bubbles: true, clientY }),
      ),
    );
    return node.parentElement.title;
  };
  const select = async (id) => {
    const node = container.querySelector(`[data-minimap-entry-id="${id}"]`);
    const clientY = Number.parseFloat(node.style.top) * 6;
    await React.act(() => {
      node.parentElement.dispatchEvent(
        new window.MouseEvent("mousedown", { bubbles: true, clientY }),
      );
      window.dispatchEvent(new window.MouseEvent("mouseup"));
    });
  };
  try {
    await render(["recent"]);
    assert.equal(
      container.querySelectorAll("[data-minimap-entry-id]").length,
      3,
    );
    assert.match(await hover("old"), /14:35$/);
    assert.equal(
      pending.length,
      0,
      "hovering unloaded history does not fetch it",
    );
    assert.match(await hover("recent"), /16:42$/);
    assert.equal(
      await hover("middle"),
      "",
      "a missing timestamp clears the previous tooltip",
    );
    await select("old");
    assert.equal(pending[0].id, "old");
    assert.deepEqual(jumps, []);
    await render(["old", "middle", "recent"]);
    await React.act(() => pending[0].resolve(true));
    await settle();
    assert.equal(jumps.at(-1), 320);
    assert.equal(
      container
        .querySelector('[data-minimap-entry-id="old"]')
        .hasAttribute("data-minimap-node-active"),
      true,
    );

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

test("filled answer stars jump to answer refs without displacing prompt refs", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const scroll = document.createElement("div");
  Object.defineProperty(scroll, "scrollHeight", { get: () => 2000 });
  const jumps = [];
  scroll.scrollTo = (options) => jumps.push(options.top);
  try {
    await React.act(() =>
      root.render(
        React.createElement(ChatMinimap, {
          messages: [{ role: "user" }, { role: "assistant" }, { role: "user" }],
          entryIds: ["u", "a", "u2"],
          historyAnchors: [
            { id: "u" },
            { id: "a", starred: true },
            { id: "u2" },
          ],
          starredEntryIds: ["a"],
          answerRefs: {
            current: new Map([
              ["a", { getBoundingClientRect: () => rect(800) }],
            ]),
          },
          scrollContainer: { current: scroll },
          messageRefs: {
            current: [
              { getBoundingClientRect: () => rect(300) },
              { getBoundingClientRect: () => rect(1100) },
            ],
          },
          onLoadThrough: async () => false,
        }),
      ),
    );
    await settle();
    const star = container.querySelector(
      'button[aria-label="Jump to starred answer"]',
    );
    assert.ok(star);
    assert.equal(
      star.querySelector("svg").getAttribute("fill"),
      "currentColor",
    );
    await React.act(() => star.click());
    assert.equal(jumps.at(-1), 620);
    assert.equal(
      container.querySelectorAll("[data-minimap-entry-id]").length,
      3,
    );
  } finally {
    await React.act(() => root.unmount());
    container.remove();
  }
});

test("clicking markers in a long rail selects their own scroll targets", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const scroll = document.createElement("div");
  Object.defineProperty(scroll, "scrollHeight", { get: () => 20000 });
  const jumps = [];
  scroll.scrollTo = (options) => jumps.push(options.top);
  const ids = Array.from({ length: 25 }, (_, index) => `entry-${index}`);
  try {
    await React.act(() =>
      root.render(
        React.createElement(ChatMinimap, {
          messages: ids.map((_, index) =>
            index === 20
              ? { role: "custom", customType: "compaction" }
              : { role: "user" },
          ),
          entryIds: ids,
          scrollContainer: { current: scroll },
          messageRefs: {
            current: ids.map((_, index) => ({
              getBoundingClientRect: () => rect(300 + index * 300),
            })),
          },
          onLoadThrough: async () =>
            assert.fail("loaded markers must not fetch history"),
        }),
      ),
    );
    await settle();
    const rail = container.querySelector(".chat-minimap");
    for (const [index, id] of ids.entries()) {
      const marker = rail.querySelector(`[data-minimap-entry-id="${id}"]`);
      if (index === 20) assert.ok(marker.querySelector('[role="separator"]'));
      await React.act(() => {
        rail.dispatchEvent(
          new window.MouseEvent("mousedown", {
            bubbles: true,
            clientY: Number.parseFloat(marker.style.top) * 6,
          }),
        );
        window.dispatchEvent(new window.MouseEvent("mouseup"));
      });
      assert.equal(jumps.at(-1), 120 + index * 300, `${id} scroll target`);
      assert.equal(
        rail.querySelector("[data-minimap-node-active]").dataset.minimapEntryId,
        id,
      );
    }
  } finally {
    await React.act(() => root.unmount());
    container.remove();
  }
});

test("compactions render as neutral dividers for unloaded, loaded and live history", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const scroll = document.createElement("div");
  Object.defineProperty(scroll, "scrollHeight", { get: () => 2000 });
  const loads = [];
  const jumps = [];
  scroll.scrollTo = (options) => jumps.push(options.top);
  const scrollContainer = { current: scroll };
  const messageRefs = { current: [] };
  const render = async (loaded) => {
    messageRefs.current = loaded
      ? [300, 600, 900, 1200].map((top) => ({
          getBoundingClientRect: () => rect(top),
        }))
      : [{ getBoundingClientRect: () => rect(900) }];
    await React.act(() =>
      root.render(
        React.createElement(ChatMinimap, {
          messages: loaded
            ? [
                { role: "user" },
                { role: "custom", customType: "compaction" },
                { role: "user" },
                { role: "custom", customType: "compaction" },
              ]
            : [{ role: "user" }],
          entryIds: loaded ? ["old", "compact", "recent"] : ["recent"],
          historyAnchors: [
            { id: "old" },
            { id: "compact", compaction: true },
            { id: "recent" },
          ],
          scrollContainer,
          messageRefs,
          onLoadThrough: async (id) => {
            loads.push(id);
            return false;
          },
        }),
      ),
    );
    await settle();
  };
  const select = async (node) =>
    React.act(() => {
      container.querySelector(".chat-minimap").dispatchEvent(
        new window.MouseEvent("mousedown", {
          bubbles: true,
          clientY: Number.parseFloat(node.style.top) * 6,
        }),
      );
      window.dispatchEvent(new window.MouseEvent("mouseup"));
    });
  try {
    await render(false);
    const divider = container.querySelector('[role="separator"]');
    assert.equal(divider.getAttribute("aria-label"), "Conversation compacted");
    assert.equal(divider.style.background, "var(--text-muted)");
    assert.ok(
      Number.parseFloat(divider.style.width) >
        Number.parseFloat(divider.style.height),
    );
    assert.equal(divider.parentElement.dataset.minimapEntryId, "compact");
    await select(divider.parentElement);
    assert.deepEqual(loads, ["compact"]);
    await render(true);
    assert.equal(container.querySelectorAll('[role="separator"]').length, 2);
    await select(container.querySelector('[data-minimap-entry-id="compact"]'));
    assert.equal(jumps.at(-1), 420);
    await select(container.querySelector('[data-minimap-entry-id="recent"]'));
    assert.equal(
      jumps.at(-1),
      720,
      "compactions keep later prompt refs aligned",
    );
  } finally {
    await React.act(() => root.unmount());
    container.remove();
  }
});
