import assert from "node:assert/strict";
import test, { after } from "node:test";
import { Window } from "happy-dom";
import { createJiti } from "jiti";
import { readFileSync } from "node:fs";

process.env.NODE_ENV = "test";
const window = new Window({ url: "http://localhost" });
after(async () => {
  await window.happyDOM.close();
});
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
const { projectTreeForResponse } = await jiti.import("../lib/project-tree.ts");
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
    await settle();
    assert.ok(document.querySelector('[role="tooltip"]'));
    await render(["first"]);
    assert.equal(document.querySelector('[role="tooltip"]'), null);
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
            {
              id: "old",
              preview: "An older prompt",
              timestamp: new Date(2025, 0, 2, 14, 35).getTime(),
            },
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
    await settle();
    return document.querySelector('[role="tooltip"]')?.textContent ?? "";
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
    assert.equal(await hover("old"), "An older prompt");
    assert.equal(
      pending.length,
      0,
      "hovering unloaded history does not fetch it",
    );
    assert.equal(await hover("recent"), "prompt");
    assert.equal(
      await hover("middle"),
      "",
      "a missing preview clears the previous tooltip",
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

test("rail markers stay out of tab order and pointer clicks do not pin previews", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const scroll = document.createElement("div");
  Object.defineProperty(scroll, "scrollHeight", { get: () => 2000 });
  const jumps = [];
  scroll.scrollTo = (options) => jumps.push(options.top);
  let loads = 0;
  const props = {
    messages: [
      { role: "user", content: "  **Hello**\n  Grüß 😀 " },
      {
        role: "user",
        content: [{ type: "image", data: "abc", mimeType: "image/png" }],
      },
      { role: "custom", customType: "compaction" },
      { role: "assistant", content: [] },
    ],
    entryIds: ["text", "image", "compact", "star"],
    starredEntryIds: ["star"],
    historyAnchors: [
      { id: "text" },
      { id: "image" },
      { id: "compact", compaction: true },
      { id: "star", starred: true, preview: "Must not appear" },
    ],
    scrollContainer: { current: scroll },
    messageRefs: {
      current: [
        { getBoundingClientRect: () => rect(500) },
        { getBoundingClientRect: () => rect(800) },
        { getBoundingClientRect: () => rect(1000) },
      ],
    },
    onLoadThrough: async () => {
      loads++;
      return false;
    },
  };
  try {
    await React.act(() => root.render(React.createElement(ChatMinimap, props)));
    await settle();
    const button = container.querySelector(
      '[data-minimap-entry-id="text"] button',
    );
    const rail = container.querySelector(".chat-minimap");
    assert.ok(
      [...rail.querySelectorAll("button")].every(
        (marker) => marker.tabIndex === -1,
      ),
    );
    await React.act(() => button.focus());
    assert.equal(document.querySelector('[role="tooltip"]'), null);
    const hoverText = async () => {
      await React.act(() =>
        rail.dispatchEvent(
          new window.MouseEvent("mousemove", { clientY: 12, bubbles: true }),
        ),
      );
      await settle();
    };
    await hoverText();
    const tip = document.querySelector('[role="tooltip"]');
    assert.equal(tip.textContent, "**Hello** Grüß 😀");
    assert.equal(tip.id, button.getAttribute("aria-describedby"));
    assert.equal(
      container.querySelector(".chat-minimap").hasAttribute("title"),
      false,
    );
    await React.act(() => {
      button.dispatchEvent(
        new window.MouseEvent("mousedown", { clientY: 12, bubbles: true }),
      );
      window.dispatchEvent(new window.MouseEvent("mouseup"));
      button.click();
    });
    assert.equal(jumps.at(-1), 320);
    await React.act(() =>
      rail.dispatchEvent(
        new window.MouseEvent("mouseout", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      ),
    );
    assert.equal(document.querySelector('[role="tooltip"]'), null);
    await React.act(() => button.blur());
    for (const id of ["image", "compact", "star"]) {
      const marker = container.querySelector(`[data-minimap-entry-id="${id}"]`);
      const clientY = Number.parseFloat(marker.style.top) * 6;
      await React.act(() =>
        marker.parentElement.dispatchEvent(
          new window.MouseEvent("mousemove", { clientY, bubbles: true }),
        ),
      );
      await settle();
      assert.equal(document.querySelector('[role="tooltip"]'), null);
    }
    assert.equal(loads, 0);
    await hoverText();
    assert.ok(document.querySelector('[role="tooltip"]'));
  } finally {
    await React.act(() => root.unmount());
    container.remove();
  }
  assert.equal(document.querySelector('[role="tooltip"]'), null);
});

test("active and inactive stars use identical markers aligned as siblings, while path markers use neutral filled and hollow squares", async () => {
  const style = document.createElement("style");
  style.textContent = readFileSync(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );
  document.head.append(style);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const scroll = document.createElement("div");
  Object.defineProperty(scroll, "scrollHeight", { get: () => 2000 });
  const switches = [];
  const jumps = [];
  scroll.scrollTo = (options) => jumps.push(options.top);
  const node = (id, children = []) => ({
    entry: {
      id,
      type: "message",
      message: { role: id === "prompt" ? "user" : "assistant", content: id },
    },
    children,
  });
  const props = {
    tree: projectTreeForResponse([
      node("prompt", [node("active"), node("other-star", [node("other-end")])]),
    ]),
    activeLeafId: "active",
    messages: [
      { role: "user", content: "prompt" },
      { role: "assistant", content: "active" },
    ],
    entryIds: ["prompt", "active"],
    starredEntryIds: ["active", "other-star"],
    scrollContainer: { current: scroll },
    messageRefs: { current: [{ getBoundingClientRect: () => rect(300) }] },
    answerRefs: {
      current: new Map([
        ["active", { getBoundingClientRect: () => rect(800) }],
      ]),
    },
    onLoadThrough: async () => false,
    onLeafChange: (leafId, entryId) => switches.push({ leafId, entryId }),
  };
  try {
    await React.act(() => root.render(React.createElement(ChatMinimap, props)));
    await React.act(() => container.querySelector(".chat-minimap").focus());
    await settle();
    const active = container.querySelector(
      '[data-minimap-entry-id="active"] .minimap-star',
    );
    const inactive = container.querySelector(
      '[data-rail-entry-id="other-star"].minimap-star',
    );
    assert.ok(active && inactive);
    assert.equal(
      inactive.querySelector("svg").outerHTML,
      active.querySelector("svg").outerHTML,
    );
    assert.equal(
      window.getComputedStyle(inactive.querySelector("svg")).color,
      window.getComputedStyle(active.querySelector("svg")).color,
    );
    assert.equal(inactive.style.height, active.style.height);
    assert.equal(
      Number.parseFloat(inactive.style.top),
      Number.parseFloat(active.parentElement.style.top) * 6,
    );
    assert.equal(
      Number.parseFloat(inactive.style.left),
      54,
      "inactive star is centered in the next 36px lane",
    );
    assert.equal(
      window.getComputedStyle(inactive).width,
      window.getComputedStyle(active).width,
    );
    assert.equal(
      container.querySelector('[data-minimap-entry-id="prompt"] button > div')
        .style.borderRadius,
      "2px",
    );
    const promptMarker = container.querySelector(
      '[data-minimap-entry-id="prompt"] button > div',
    );
    assert.match(promptMarker.style.background, /^rgba\(128,\s*128,\s*128,/);
    assert.equal(
      window.getComputedStyle(
        container.querySelector('[data-rail-entry-id="other-end"] > span'),
      ).borderRadius,
      "2px",
    );
    await React.act(() => {
      const icon = inactive.querySelector("svg");
      icon.dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true }));
      icon.dispatchEvent(
        new window.MouseEvent("mousemove", {
          bubbles: true,
          clientX: 54,
          clientY: Number.parseFloat(inactive.style.top),
        }),
      );
    });
    await settle();
    assert.equal(
      document.querySelector('[role="tooltip"]').textContent,
      "Switch branch to starred answer",
    );
    assert.deepEqual(switches, [], "hover only previews the stored star");
    await React.act(() => inactive.focus());
    await settle();
    assert.equal(
      document.querySelector('[role="tooltip"]').textContent,
      "Switch branch to starred answer",
    );
    await React.act(() => inactive.click());
    assert.deepEqual(switches, [
      { leafId: "other-end", entryId: "other-star" },
    ]);
    assert.deepEqual(jumps, []);
    await React.act(() => active.click());
    assert.equal(jumps.at(-1), 620);
    assert.deepEqual(switches, [
      { leafId: "other-end", entryId: "other-star" },
    ]);
    await React.act(() =>
      root.render(
        React.createElement(ChatMinimap, {
          ...props,
          starredEntryIds: ["active"],
        }),
      ),
    );
    await settle();
    assert.equal(
      container.querySelector('[data-rail-entry-id="other-star"]'),
      null,
    );
    assert.equal(document.querySelector('[role="tooltip"]'), null);
  } finally {
    await React.act(() => root.unmount());
    container.remove();
    style.remove();
  }
});

test("hover expansion uses exactly one lane per path and updates when branches change", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const scroll = document.createElement("div");
  Object.defineProperty(scroll, "scrollHeight", { get: () => 2000 });
  const widths = [];
  const onExpandedWidthChange = (width) => widths.push(width);
  const node = (id, children = []) => ({
    entry: { id, type: "message", message: { role: "user", content: id } },
    children,
  });
  try {
    for (const count of [1, 2, 3, 1]) {
      await React.act(() =>
        root.render(
          React.createElement(ChatMinimap, {
            tree: projectTreeForResponse([
              node(
                "prompt",
                Array.from({ length: count }, (_, i) => node(`leaf-${i}`)),
              ),
            ]),
            activeLeafId: "leaf-0",
            messages: [{ role: "user", content: "prompt" }],
            entryIds: ["prompt"],
            scrollContainer: { current: scroll },
            messageRefs: { current: [] },
            onLoadThrough: async () => false,
            onExpandedWidthChange,
          }),
        ),
      );
      await settle();
      const rail = container.querySelector(".chat-minimap");
      await React.act(() =>
        rail.dispatchEvent(
          new window.MouseEvent("mouseover", { bubbles: true }),
        ),
      );
      assert.equal(rail.style.width, `${count * 36}px`);
      assert.equal(widths.at(-1), count * 36);
      await React.act(() =>
        rail.dispatchEvent(
          new window.MouseEvent("mouseout", { bubbles: true }),
        ),
      );
      assert.equal(rail.style.width, "36px");
    }
  } finally {
    await React.act(() => root.unmount());
    container.remove();
  }
});

test("a dense branched rail keeps its last turn in the viewport and navigable", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const scroll = document.createElement("div");
  Object.defineProperty(scroll, "scrollHeight", { get: () => 300000 });
  const jumps = [];
  scroll.scrollTo = (options) => jumps.push(options.top);
  const ids = Array.from({ length: 700 }, (_, index) => `turn-${index}`);
  try {
    await React.act(() =>
      root.render(
        React.createElement(ChatMinimap, {
          tree: [
            {
              entry: { id: "turn-0", type: "message" },
              children: [
                {
                  entry: { id: "turn-699", type: "message" },
                  compressedEntryIds: ids.slice(1, -1),
                  children: [],
                },
                { entry: { id: "other", type: "message" }, children: [] },
              ],
            },
          ],
          activeLeafId: "turn-699",
          messages: ids.map((id) => ({ role: "user", content: id })),
          entryIds: ids,
          scrollContainer: { current: scroll },
          messageRefs: {
            current: ids.map((_, index) => ({
              getBoundingClientRect: () => rect(300 + index * 300),
            })),
          },
          onLoadThrough: async () => assert.fail("all turns are loaded"),
          onLeafChange: () =>
            assert.fail("scroll navigation cannot switch branches"),
        }),
      ),
    );
    await settle();
    const last = container.querySelector('[data-minimap-entry-id="turn-699"]');
    const clientY = Number.parseFloat(last.style.top) * 6;
    assert.ok(
      clientY < 600 - 30,
      "last turn clears the footer even in a dense graph",
    );
    await React.act(() => {
      container.querySelector(".chat-minimap").dispatchEvent(
        new window.MouseEvent("mousedown", {
          bubbles: true,
          clientX: 18,
          clientY,
        }),
      );
      window.dispatchEvent(new window.MouseEvent("mouseup"));
    });
    assert.equal(jumps.at(-1), 300 + 699 * 300 - 180);
  } finally {
    await React.act(() => root.unmount());
    container.remove();
  }
});

test("expanded inactive paths preview each prompt and switch only on explicit selection, never rail scrolling or dragging", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const scroll = document.createElement("div");
  Object.defineProperty(scroll, "scrollHeight", { get: () => 2000 });
  const jumps = [];
  scroll.scrollTo = (options) => jumps.push(options.top);
  const switches = [];
  const node = (id, children = []) => ({
    entry: { id, type: "message", message: { role: "user", content: id } },
    children,
  });
  const props = {
    tree: projectTreeForResponse([
      node("prompt", [
        node("fork", [
          node("current"),
          node("alternative", [node("follow-up", [node("other-end")])]),
        ]),
      ]),
    ]),
    activeLeafId: "current",
    messages: [
      { role: "user", content: "prompt" },
      { role: "user", content: "current" },
    ],
    entryIds: ["prompt", "current"],
    scrollContainer: { current: scroll },
    messageRefs: {
      current: [500, 800].map((top) => ({
        getBoundingClientRect: () => rect(top),
      })),
    },
    onLoadThrough: async () => assert.fail("preview must not fetch history"),
    onLeafChange: (leafId, entryId) => switches.push({ leafId, entryId }),
  };
  try {
    await React.act(() => root.render(React.createElement(ChatMinimap, props)));
    await settle();
    const rail = container.querySelector(".chat-minimap.has-branches");
    assert.equal(rail.style.width, "36px");
    assert.equal(rail.querySelector(".minimap-branch"), null);
    assert.equal(rail.querySelector("svg").getAttribute("width"), "36");
    assert.equal(rail.tabIndex, 0);
    await React.act(() =>
      rail.dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true })),
    );
    assert.equal(rail.style.width, "72px");
    assert.ok(rail.classList.contains("is-expanded"));
    await React.act(() => {
      rail.scrollLeft = 108;
      rail.dispatchEvent(new window.MouseEvent("mouseout", { bubbles: true }));
    });
    assert.equal(rail.style.width, "36px");
    assert.equal(rail.scrollLeft, 0);
    assert.equal(rail.querySelector(".minimap-branch"), null);
    await React.act(() => rail.focus());
    assert.equal(rail.style.width, "72px");
    assert.equal(rail.querySelectorAll("path").length, 5);
    assert.ok(rail.querySelector('[data-rail-entry-id="fork"]'));
    const alternative = rail.querySelector(
      'button[data-rail-entry-id="alternative"]',
    );
    assert.ok(alternative);
    for (const id of ["alternative", "follow-up", "other-end"]) {
      const marker = rail.querySelector(`button[data-rail-entry-id="${id}"]`);
      assert.ok(marker, `each inactive prompt has a marker: ${id}`);
      assert.equal(marker.getAttribute("aria-label"), `Switch branch: ${id}`);
      assert.equal(marker.style.left, alternative.style.left);
    }
    assert.ok(
      Number.parseFloat(
        rail.querySelector('[data-rail-entry-id="other-end"]').style.top,
      ) > Number.parseFloat(alternative.style.top),
    );
    assert.equal(alternative.tabIndex, 0);
    await React.act(() => alternative.focus());
    await settle();
    assert.equal(
      document.querySelector('[role="tooltip"]').textContent,
      "Switch branch: alternative",
    );
    assert.deepEqual(switches, []);
    await React.act(() => {
      rail.dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true }));
      scroll.dispatchEvent(new window.Event("scroll"));
      rail.dispatchEvent(
        new window.MouseEvent("mousedown", {
          bubbles: true,
          clientX: 18,
          clientY: 12,
        }),
      );
      window.dispatchEvent(
        new window.MouseEvent("mousemove", { clientX: 46, clientY: 112 }),
      );
      window.dispatchEvent(new window.MouseEvent("mouseup"));
    });
    assert.ok(jumps.length > 0);
    assert.deepEqual(switches, []);
    const beforeSelection = jumps.length;
    await React.act(() => {
      alternative.dispatchEvent(
        new window.MouseEvent("mousedown", {
          bubbles: true,
          clientX: 46,
          clientY: 112,
        }),
      );
      alternative.click();
    });
    assert.deepEqual(switches, [
      { leafId: "other-end", entryId: "alternative" },
    ]);
    assert.equal(
      jumps.length,
      beforeSelection,
      "switching must not also scroll the old path",
    );
    await React.act(() =>
      rail.dispatchEvent(new window.MouseEvent("mouseout", { bubbles: true })),
    );
    assert.equal(rail.style.width, "36px");
    assert.equal(rail.querySelector(".minimap-branch"), null);
    assert.equal(document.querySelector('[role="tooltip"]'), null);
    await React.act(() => rail.focus());
    await React.act(() =>
      root.render(
        React.createElement(ChatMinimap, { ...props, branchDisabled: true }),
      ),
    );
    const disabledAlternative = rail.querySelector(
      'button[data-rail-entry-id="alternative"]',
    );
    assert.equal(disabledAlternative.disabled, true);
    await React.act(() => disabledAlternative.click());
    assert.deepEqual(switches, [
      { leafId: "other-end", entryId: "alternative" },
    ]);
  } finally {
    await React.act(() => root.unmount());
    container.remove();
  }
});

for (const dense of [false, true]) {
  test(
    dense
      ? "dense rail omits connecting lines when adjacent squares leave no gap"
      : "rail connecting lines stop outside filled and hollow squares in both hover modes",
    async () => {
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      const scroll = document.createElement("div");
      Object.defineProperty(scroll, "scrollHeight", { get: () => 2000 });
      const ids = Array.from(
        { length: dense ? 100 : 2 },
        (_, index) => `square-${index}`,
      );
      const node = (id, children = []) => ({
        entry: {
          id,
          type: "message",
          message: { role: "user", content: id },
        },
        children,
      });
      const descendants = ids
        .slice(1)
        .reduceRight((children, id) => [node(id, children)], []);
      const markerCenter = (rail, id) => {
        const active = rail.querySelector(`[data-minimap-entry-id="${id}"]`);
        if (active)
          return {
            x:
              Number.parseFloat(active.style.left) +
              Number.parseFloat(active.style.width) / 2,
            y: (Number.parseFloat(active.style.top) * rail.clientHeight) / 100,
          };
        const inactive = rail.querySelector(`[data-rail-entry-id="${id}"]`);
        assert.ok(inactive, `the visible graph contains ${id}`);
        return {
          x: Number.parseFloat(inactive.style.left),
          y: Number.parseFloat(inactive.style.top),
        };
      };
      try {
        await React.act(() =>
          root.render(
            React.createElement(ChatMinimap, {
              tree: projectTreeForResponse([
                node(ids[0], [...descendants, node("other-square")]),
              ]),
              activeLeafId: ids.at(-1),
              messages: ids.map((id) => ({ role: "user", content: id })),
              entryIds: ids,
              scrollContainer: { current: scroll },
              messageRefs: {
                current: ids.map((_, index) => ({
                  getBoundingClientRect: () => rect(300 + index * 300),
                })),
              },
              onLoadThrough: async () => false,
            }),
          ),
        );
        await settle();
        const rail = container.querySelector(".chat-minimap");
        for (const expanded of [false, true]) {
          if (expanded)
            await React.act(() =>
              rail.dispatchEvent(
                new window.MouseEvent("mouseover", { bubbles: true }),
              ),
            );
          assert.equal(rail.classList.contains("is-expanded"), expanded);
          const paths = [...rail.querySelector("svg").querySelectorAll("path")];
          const parent = markerCenter(rail, ids[0]);
          const activeChild = markerCenter(rail, ids[1]);
          if (dense) {
            assert.ok(
              activeChild.y - parent.y < 8,
              "the fixture's 8px squares overlap vertically",
            );
            assert.equal(
              paths.length,
              0,
              "a graph without space between squares must omit its connecting lines",
            );
            continue;
          }
          const children = [
            activeChild,
            ...(expanded ? [markerCenter(rail, "other-square")] : []),
          ];
          assert.equal(paths.length, children.length);
          for (const child of children) {
            const endpoints = paths
              .map((path) => {
                const coordinates = path
                  .getAttribute("d")
                  .match(/-?\d+(?:\.\d+)?/g)
                  .map(Number);
                return {
                  startX: coordinates[0],
                  startY: coordinates[1],
                  endX: coordinates.at(-2),
                  endY: coordinates.at(-1),
                };
              })
              .find(
                (path) => path.startX === parent.x && path.endX === child.x,
              );
            assert.ok(
              endpoints,
              "each visible child has its own connecting line",
            );
            assert.ok(
              endpoints.startY >= parent.y + 5,
              "a connecting line starts outside the parent square",
            );
            assert.ok(
              endpoints.endY <= child.y - 5,
              "a connecting line ends outside the child square",
            );
            assert.ok(
              endpoints.endY > endpoints.startY,
              "a connecting line has a forward gap between the squares",
            );
          }
        }
      } finally {
        await React.act(() => root.unmount());
        container.remove();
      }
    },
  );
}
