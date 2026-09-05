import assert from "node:assert/strict";
import { after, test } from "node:test";
import { Window } from "happy-dom";
import { createJiti } from "jiti";

const window = new Window({ url: "http://localhost" });
Object.assign(globalThis, {
  window, document: window.document, HTMLElement: window.HTMLElement,
  Node: window.Node, Event: window.Event, MouseEvent: window.MouseEvent,
  IS_REACT_ACT_ENVIRONMENT: true,
});
after(() => window.happyDOM.close());
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { act } = React;
const { createRoot } = await jiti.import("react-dom/client");
const { MessageView } = await jiti.import("./MessageView.tsx");

async function mount(message) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = async (nextMessage) => {
    await act(async () => root.render(React.createElement(MessageView, { message: nextMessage })));
  };
  await render(message);
  return { container, render, close: async () => {
    await act(async () => root.unmount());
    container.remove();
  } };
}

for (const display of [true, false]) {
  test(`extension messages with display=${display} start collapsed and can be opened and closed`, async () => {
    const message = {
      role: "custom", customType: "pi-processes:readiness", display, timestamp: 1000,
      content: [
        { type: "text", text: "## Server ready\n\nListening on **localhost**." },
        { type: "image", data: "YWJj", mimeType: "image/png" },
      ],
      details: { processId: "process-42" },
    };
    const view = await mount(message);
    try {
      const header = view.container.querySelector("button");
      assert.equal(header.getAttribute("aria-expanded"), "false");
      assert.equal(header.title, "Expand");
      assert.match(header.textContent, /pi-processes:readiness/);
      assert.match(header.textContent, /Server ready/);
      assert.equal(header.textContent.includes("hidden extension message"), !display);
      assert.equal(view.container.querySelector(".markdown-custom-message"), null);
      assert.equal(view.container.querySelector("img"), null);
      assert.doesNotMatch(view.container.textContent, /process-42|Copy|Show details/);

      await view.render({ ...message, details: { processId: "process-42", status: "ready" } });
      assert.equal(header.getAttribute("aria-expanded"), "false", "updates do not expand the message");
      await act(async () => header.click());
      assert.equal(header.getAttribute("aria-expanded"), "true");
      assert.equal(header.title, "Collapse");
      assert.equal(view.container.querySelector("h2").textContent, "Server ready");
      assert.equal(view.container.querySelector("strong").textContent, "localhost");
      assert.equal(view.container.querySelector('button[aria-label="Preview image"] img').src, "data:image/png;base64,YWJj");
      assert.match(view.container.textContent, /Copy/);
      assert.equal(view.container.querySelector("pre"), null);

      const details = [...view.container.querySelectorAll("button")].find((button) => button.textContent === "Show details");
      await act(async () => details.click());
      assert.equal(details.getAttribute("aria-expanded"), "true");
      assert.match(view.container.querySelector("pre").textContent, /process-42/);
      await act(async () => header.click());
      assert.equal(header.getAttribute("aria-expanded"), "false");
      assert.equal(view.container.querySelector(".markdown-custom-message"), null);
      assert.equal(view.container.querySelector("img"), null);
      assert.equal(view.container.querySelector("pre"), null);
      await act(async () => header.click());
      assert.equal(view.container.querySelector("h2").textContent, "Server ready");
    } finally { await view.close(); }
  });
}

test("an extension message without text or metadata still has an expansion control", async () => {
  const view = await mount({ role: "custom", customType: "extension", display: true, content: "" });
  try {
    const header = view.container.querySelector("button");
    assert.match(header.textContent, /Show extension message/);
    await act(async () => header.click());
    assert.equal(header.getAttribute("aria-expanded"), "true");
    assert.match(view.container.textContent, /\(no message\)/);
    await act(async () => header.click());
    assert.equal(header.getAttribute("aria-expanded"), "false");
  } finally { await view.close(); }
});

test("compaction starts collapsed with context counts and reveals its summary and file context", async () => {
  const message = {
    role: "custom", customType: "compaction", display: true, timestamp: 1000,
    content: "## Retained context\n\nKeep the **existing controls**.\n\n<read-files>\nlib/session-reader.ts\n</read-files>\n<modified-files>\ncomponents/MessageView.tsx\n</modified-files>",
    details: { tokensBefore: 120000, estimatedTokensAfter: 18000 },
  };
  const view = await mount(message);
  try {
    const header = view.container.querySelector("button");
    assert.equal(header.getAttribute("aria-expanded"), "false");
    assert.match(header.textContent, /Conversation compacted/);
    assert.match(header.textContent, /120k → ~18k tokens/);
    const time = header.querySelector(".compaction-time").textContent;
    assert.match(time, /\d{2}:\d{2}$/);
    assert.equal(view.container.querySelector(".markdown-compaction-message"), null);
    assert.doesNotMatch(view.container.textContent, /existing controls|File context/);
    await act(async () => header.click());
    assert.equal(header.getAttribute("aria-expanded"), "true");
    assert.equal(view.container.querySelector(".compaction-body").id, header.getAttribute("aria-controls"));
    assert.equal(header.querySelector(".compaction-time").textContent, time);
    assert.equal(view.container.querySelector("h2").textContent, "Retained context");
    assert.equal(view.container.querySelector("strong").textContent, "existing controls");
    assert.match(view.container.querySelector(".compaction-file-details").textContent, /1 read, 1 modified/);
    assert.match(view.container.querySelector(".compaction-file-details").textContent, /lib\/session-reader.ts/);
    await act(async () => header.click());
    assert.equal(header.getAttribute("aria-expanded"), "false");
    assert.equal(view.container.querySelector(".markdown-compaction-message"), null);
    assert.equal(view.container.querySelector(".compaction-file-details"), null);
    assert.match(header.textContent, /120k → ~18k tokens/);
  } finally { await view.close(); }
});

test("compaction counts handle legacy, missing, invalid, and zero values without fabricating a reduction", async () => {
  for (const [details, expected] of [
    [{ tokensBefore: 120000 }, "120k tokens before"],
    [{ estimatedTokensAfter: 18000 }, "~18k tokens after"],
    [{ tokensBefore: 0, estimatedTokensAfter: 0 }, "0 → ~0 tokens"],
    [{ tokensBefore: -1, estimatedTokensAfter: NaN }, null],
    [{ tokensBefore: Infinity, estimatedTokensAfter: "18000" }, null],
    [undefined, null],
  ]) {
    const view = await mount({ role: "custom", customType: "compaction", display: true, content: "", details });
    try {
      assert.equal(view.container.querySelector(".compaction-token-count")?.textContent ?? null, expected);
      const header = view.container.querySelector("button");
      await act(async () => header.click());
      assert.match(view.container.textContent, /\(no summary\)/);
    } finally { await view.close(); }
  }
});
