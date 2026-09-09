import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { after } from "node:test";
import { Window } from "happy-dom";
import { createJiti } from "jiti";

registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith(".css")) return nextLoad(url, context);
    return {
      format: "module",
      shortCircuit: true,
      source: "export default {};",
    };
  },
});

process.env.NODE_ENV = "test";
const window = new Window({ url: "http://localhost" });
after(() => window.happyDOM.close());
const messageSelector = ".markdown-user-message, .markdown-assistant-message";
const viewportHeight = 600;
const transcriptTop = 100;
let messageSpacing = 320;
const messageInset = 40;
const resizeObservers = new Set();
class ResizeObserver {
  constructor(callback) {
    this.callback = callback;
    this.targets = new Set();
    resizeObservers.add(this);
  }
  observe(target) {
    this.targets.add(target);
  }
  disconnect() {
    this.targets.clear();
    resizeObservers.delete(this);
  }
}
function notifyResize(...targets) {
  for (const observer of resizeObservers) {
    const entries = targets
      .filter((target) => observer.targets.has(target))
      .map((target) => ({
        target,
        contentRect: target.getBoundingClientRect(),
      }));
    if (entries.length) observer.callback(entries, observer);
  }
}

function renderedMessages(element) {
  const transcript = element
    .closest(".chat-window")
    ?.querySelector(".chat-transcript");
  return [...(transcript?.querySelectorAll(messageSelector) ?? [])];
}

// Happy DOM has no layout. Give the real rendered transcript a regular vertical
// layout; changing the loaded messages changes its height and every later rect.
Object.defineProperty(window.HTMLElement.prototype, "clientHeight", {
  configurable: true,
  get() {
    return this.matches(".chat-scroll, .chat-minimap") ? viewportHeight : 0;
  },
});
Object.defineProperty(window.HTMLElement.prototype, "scrollHeight", {
  configurable: true,
  get() {
    return this.matches(".chat-scroll")
      ? Math.max(
          viewportHeight,
          messageInset + renderedMessages(this).length * messageSpacing,
        )
      : 0;
  },
});
window.HTMLElement.prototype.getBoundingClientRect = function () {
  const scroll = this.closest(".chat-window")?.querySelector(".chat-scroll");
  const message = this.closest(".chat-transcript")
    ? this.matches(messageSelector)
      ? this
      : this.querySelector(messageSelector)
    : null;
  const index = message ? renderedMessages(this).indexOf(message) : -1;
  const height = index >= 0 ? messageSpacing : viewportHeight;
  const top =
    index >= 0
      ? transcriptTop +
        messageInset +
        index * messageSpacing -
        (scroll?.scrollTop ?? 0)
      : transcriptTop;
  return { top, bottom: top + height, left: 0, right: 36, width: 36, height };
};
window.HTMLElement.prototype.scrollTo = function ({ top }) {
  this.scrollTop = Math.max(
    0,
    Math.min(top, this.scrollHeight - this.clientHeight),
  );
  this.dispatchEvent(new window.Event("scroll"));
};
Object.assign(globalThis, {
  window,
  document: window.document,
  Node: window.Node,
  HTMLElement: window.HTMLElement,
  HTMLButtonElement: window.HTMLButtonElement,
  Event: window.Event,
  MouseEvent: window.MouseEvent,
  localStorage: window.localStorage,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  IntersectionObserver: class {
    observe() {}
    disconnect() {}
  },
  ResizeObserver,
  IS_REACT_ACT_ENVIRONMENT: true,
});
const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { createRoot } = await jiti.import("react-dom/client");
const { ChatWindow } = await jiti.import("./ChatWindow.tsx");
const { projectTreeForResponse } = await jiti.import("../lib/project-tree.ts");

const session = {
  id: "rail-session",
  path: "/tmp/rail-session.jsonl",
  cwd: "/tmp/project",
  cwdAvailable: false,
  created: "2026-09-09T00:00:00.000Z",
  modified: "2026-09-09T00:00:00.000Z",
};
const entries = [
  ["common-question", "user", "Shared opening question"],
  ["common-answer", "assistant", "Shared opening answer"],
  ["active-question", "user", "Current path question"],
  ["active-star", "assistant", "Current starred answer"],
  ["active-final-question", "user", "Current final question"],
  ["active-leaf", "assistant", "Current final answer"],
  ["inactive-question", "user", "Alternative opening question"],
  ["inactive-star", "assistant", "Alternative starred answer"],
  ["inactive-later-question", "user", "Alternative later question"],
  ["inactive-later-answer", "assistant", "Alternative later answer"],
  ["inactive-final-question", "user", "Alternative final question"],
  ["inactive-leaf", "assistant", "Alternative final answer"],
];
const messagesById = new Map(
  entries.map(([id, role, text]) => [
    id,
    {
      role,
      ...(role === "assistant" ? { provider: "test", model: "test" } : {}),
      content: role === "user" ? text : [{ type: "text", text }],
    },
  ]),
);
const commonIds = ["common-question", "common-answer"];
const activeIds = [
  ...commonIds,
  "active-question",
  "active-star",
  "active-final-question",
  "active-leaf",
];
const inactiveIds = [
  ...commonIds,
  "inactive-question",
  "inactive-star",
  "inactive-later-question",
  "inactive-later-answer",
  "inactive-final-question",
  "inactive-leaf",
];
const starIds = ["active-star", "inactive-star"];
const rawNode = (id, children = []) => ({
  entry: { id, type: "message", message: messagesById.get(id) },
  children,
});
const chain = (ids) =>
  ids.reduceRight((children, id) => [rawNode(id, children)], []);
const tree = projectTreeForResponse([
  rawNode("common-question", [
    rawNode("common-answer", [
      ...chain(activeIds.slice(2)),
      ...chain(inactiveIds.slice(2)),
    ]),
  ]),
]);
function contextFor(ids, loadedIds = ids, hasMore = false) {
  return {
    messages: loadedIds.map((id) => messagesById.get(id)),
    entryIds: loadedIds,
    oldestEntryId: loadedIds[0],
    hasMore,
    starredEntryIds: starIds,
    historyAnchors: ids
      .filter(
        (id) => messagesById.get(id).role === "user" || starIds.includes(id),
      )
      .map((id) => ({
        id,
        ...(starIds.includes(id) ? { starred: true } : {}),
        preview: entries.find(([entryId]) => entryId === id)[2],
      })),
  };
}
const settle = () =>
  React.act(() => new Promise((resolve) => setTimeout(resolve, 260)));

async function scene(run, { paged = false } = {}) {
  const originalFetch = globalThis.fetch;
  const commands = [];
  const contextReads = [];
  globalThis.fetch = async (url, options) => {
    const path = String(url);
    if (path === "/api/agent/rail-session" && options?.method === "POST") {
      const command = JSON.parse(options.body);
      commands.push(command);
      return Response.json({
        success: true,
        data: { cancelled: false, leafId: command.targetId },
      });
    }
    if (path.startsWith("/api/sessions/rail-session/context?")) {
      const params = new URL(path, "http://localhost").searchParams;
      const leaf = params.get("leafId");
      const before = params.get("before");
      const through = params.get("through");
      contextReads.push({ leaf, before, through });
      const fullPath = inactiveIds.includes(leaf) ? inactiveIds : activeIds;
      assert.ok(fullPath.includes(leaf), `Unknown requested entry ${leaf}`);
      const selectedPath = fullPath.slice(0, fullPath.indexOf(leaf) + 1);
      if (before) {
        assert.equal(before, "inactive-later-question");
        return Response.json({
          context: contextFor(selectedPath, selectedPath.slice(0, 4)),
        });
      }
      const needsPage = paged && leaf === "inactive-leaf";
      return Response.json({
        context: contextFor(
          selectedPath,
          needsPage ? selectedPath.slice(4) : selectedPath,
          needsPage,
        ),
      });
    }
    if (path.startsWith("/api/sessions/rail-session?")) {
      return Response.json({
        sessionId: session.id,
        filePath: session.path,
        info: session,
        totalActiveMs: 0,
        tree,
        leafId: "active-leaf",
        context: contextFor(activeIds),
      });
    }
    if (path.endsWith("/state"))
      return Response.json({ active: false, running: false });
    if (path.startsWith("/api/models"))
      return Response.json({ models: {}, modelList: [] });
    return Response.json({});
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await React.act(() =>
      root.render(
        React.createElement(ChatWindow, {
          session,
          newSessionCwd: null,
          newSessionDraftKey: null,
        }),
      ),
    );
    await settle();
    const transcript = container.querySelector(".chat-scroll");
    assert.ok(transcript);
    assert.equal(
      renderedMessages(transcript).length,
      6,
      "the scene renders every current-path message",
    );
    assert.ok(
      container.querySelector(
        '[data-minimap-entry-id="active-star"] .minimap-star',
      ),
    );
    await run({ container, transcript, commands, contextReads });
  } finally {
    await React.act(() => root.unmount());
    container.remove();
    globalThis.fetch = originalFetch;
    messageSpacing = 320;
  }
}

function targetOffset(transcript, text) {
  const target = renderedMessages(transcript).find(
    (message) => message.textContent.trim() === text,
  );
  return target
    ? target.getBoundingClientRect().top -
        transcript.getBoundingClientRect().top
    : null;
}

async function clickInactive(container, id) {
  await React.act(() =>
    container
      .querySelector(".chat-minimap")
      .dispatchEvent(new MouseEvent("mouseover", { bubbles: true })),
  );
  const marker = container.querySelector(`[data-rail-entry-id="${id}"]`);
  assert.ok(marker, `the expanded graph exposes ${id}`);
  await React.act(() => {
    marker.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    marker.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    marker.click();
  });
  await settle();
  await settle();
  await React.act(() =>
    container.querySelector(".chat-minimap").dispatchEvent(
      new MouseEvent("mouseout", {
        bubbles: true,
        relatedTarget: document.body,
      }),
    ),
  );
}

test("active starred answer navigation aligns the answer in the real transcript", async () => {
  await scene(async ({ container, transcript, commands, contextReads }) => {
    await React.act(() =>
      container
        .querySelector('[data-minimap-entry-id="active-star"] .minimap-star')
        .click(),
    );
    await settle();
    assert.equal(targetOffset(transcript, "Current starred answer"), 180);
    assert.deepEqual(commands, []);
    assert.deepEqual(contextReads, []);
  });
});

for (const [name, id, text, paged] of [
  [
    "an internal inactive star",
    "inactive-star",
    "Alternative starred answer",
    false,
  ],
  [
    "an internal inactive prompt",
    "inactive-question",
    "Alternative opening question",
    false,
  ],
  [
    "an unloaded internal inactive star",
    "inactive-star",
    "Alternative starred answer",
    true,
  ],
]) {
  test(`${name} opens its complete path, aligns the selected message, and retains later squares after hover ends`, async () => {
    await scene(
      async ({ container, transcript, commands, contextReads }) => {
        await clickInactive(container, id);
        assert.equal(
          container
            .querySelector(".chat-minimap")
            .classList.contains("is-expanded"),
          false,
        );
        const activePromptIds = [
          ...container.querySelectorAll("[data-minimap-entry-id]"),
        ]
          .filter((marker) => marker.querySelector(".minimap-message"))
          .map((marker) => marker.dataset.minimapEntryId);
        assert.deepEqual(
          {
            navigation: commands.filter(
              (command) => command.type === "navigate_tree",
            ),
            contextReads,
            selectedMessageOffset: targetOffset(transcript, text),
            renderedText: renderedMessages(transcript).map((message) =>
              message.textContent.trim(),
            ),
            activePromptIds,
          },
          {
            navigation: [{ type: "navigate_tree", targetId: "inactive-leaf" }],
            contextReads: [
              { leaf: "inactive-leaf", before: null, through: null },
              ...(paged
                ? [
                    {
                      leaf: "inactive-leaf",
                      before: "inactive-later-question",
                      through: id,
                    },
                  ]
                : []),
            ],
            selectedMessageOffset: 180,
            renderedText: inactiveIds.map(
              (entryId) => entries.find(([entry]) => entry === entryId)[2],
            ),
            activePromptIds: [
              "common-question",
              "inactive-question",
              "inactive-later-question",
              "inactive-final-question",
            ],
          },
        );
      },
      { paged },
    );
  });
}

test("keyboard activation restores rail focus and keeps the selected answer and later squares visible after blur", async () => {
  await scene(async ({ container, transcript, commands }) => {
    await React.act(() => container.querySelector(".chat-minimap").focus());
    const marker = container.querySelector(
      '[data-rail-entry-id="inactive-star"]',
    );
    assert.ok(marker);
    await React.act(() => marker.focus());
    assert.equal(document.activeElement, marker);
    // Browsers activate focused native buttons with Enter; Happy DOM needs the
    // corresponding click dispatched explicitly.
    await React.act(() => {
      marker.dispatchEvent(
        new window.KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
      marker.click();
    });
    await settle();
    await settle();
    const rail = container.querySelector(".chat-minimap");
    assert.equal(
      document.activeElement,
      rail,
      "removing the selected inactive marker must leave keyboard focus on the rail",
    );
    assert.equal(
      rail.tabIndex,
      0,
      "the rail remains in sequential keyboard navigation",
    );
    assert.equal(
      targetOffset(transcript, "Alternative starred answer"),
      180,
      "restoring focus does not move the selected answer",
    );
    assert.deepEqual(
      commands.filter((command) => command.type === "navigate_tree"),
      [{ type: "navigate_tree", targetId: "inactive-leaf" }],
    );
    await React.act(() => {
      rail.blur();
      rail.dispatchEvent(
        new MouseEvent("mouseout", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      );
    });
    await settle();
    assert.equal(rail.classList.contains("is-expanded"), false);
    assert.equal(targetOffset(transcript, "Alternative starred answer"), 180);
    for (const id of ["inactive-later-question", "inactive-final-question"])
      assert.ok(
        rail.querySelector(`[data-minimap-entry-id="${id}"] .minimap-message`),
      );
  });
});

test("branch selection stays aligned as hover changes wrapping, then wheel scrolling releases the target", async () => {
  await scene(async ({ container, transcript }) => {
    await clickInactive(container, "inactive-star");
    assert.equal(targetOffset(transcript, "Alternative starred answer"), 180);
    const rail = container.querySelector(".chat-minimap");
    const resizeMessages = async (spacing) => {
      await React.act(() => {
        messageSpacing = spacing;
        notifyResize(transcript, transcript.firstElementChild);
      });
      await settle();
    };
    await React.act(() =>
      rail.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })),
    );
    await resizeMessages(480);
    assert.equal(rail.classList.contains("is-expanded"), true);
    assert.equal(
      targetOffset(transcript, "Alternative starred answer"),
      180,
      "narrower text and taller messages preserve the selected answer",
    );
    await React.act(() =>
      rail.dispatchEvent(
        new MouseEvent("mouseout", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      ),
    );
    await resizeMessages(320);
    assert.equal(rail.classList.contains("is-expanded"), false);
    assert.equal(
      targetOffset(transcript, "Alternative starred answer"),
      180,
      "collapsing the rail preserves the same answer alignment",
    );
    await React.act(() => {
      transcript.dispatchEvent(
        new window.WheelEvent("wheel", { bubbles: true, deltaY: 190 }),
      );
      transcript.scrollTo({ top: 1010 });
    });
    assert.equal(targetOffset(transcript, "Alternative starred answer"), -10);
    await resizeMessages(400);
    assert.equal(
      transcript.scrollTop,
      1010,
      "later content resizing must not override the user's scroll position",
    );
    assert.equal(targetOffset(transcript, "Alternative starred answer"), 230);
  });
});

test("keyboard selection of an inactive unstarred endpoint retains focus in the expanded rail until blur", async () => {
  await scene(async ({ container, transcript, commands }) => {
    await React.act(() => container.querySelector(".chat-minimap").focus());
    const endpoint = container.querySelector(
      '[data-rail-entry-id="inactive-leaf"]',
    );
    assert.ok(
      endpoint,
      "the complete inactive path exposes its final endpoint",
    );
    assert.equal(endpoint.classList.contains("minimap-star"), false);
    await React.act(() => endpoint.focus());
    assert.equal(document.activeElement, endpoint);
    await React.act(() => {
      endpoint.dispatchEvent(
        new window.KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
      endpoint.click();
    });
    await settle();
    await settle();
    assert.deepEqual(
      commands.filter((command) => command.type === "navigate_tree"),
      [{ type: "navigate_tree", targetId: "inactive-leaf" }],
    );
    assert.deepEqual(
      renderedMessages(transcript).map((message) => message.textContent.trim()),
      inactiveIds.map(
        (entryId) => entries.find(([entry]) => entry === entryId)[2],
      ),
    );
    const rail = container.querySelector(".chat-minimap");
    assert.ok(
      document.activeElement?.isConnected &&
        rail.contains(document.activeElement),
      "selecting a terminal endpoint must retain connected keyboard focus inside the replacement rail",
    );
    assert.equal(rail.classList.contains("is-expanded"), true);
    await React.act(() => document.activeElement.blur());
    await settle();
    assert.equal(rail.classList.contains("is-expanded"), false);
  });
});
