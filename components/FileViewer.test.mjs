import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { createJiti } from "jiti";

process.env.NODE_ENV = "test";
const window = new Window({ url: "http://localhost" });
Object.assign(globalThis, {
  window, document: window.document, Node: window.Node,
  Element: window.Element, HTMLElement: window.HTMLElement,
  getComputedStyle: window.getComputedStyle.bind(window),
  IS_REACT_ACT_ENVIRONMENT: true,
});
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { createRoot } = await jiti.import("react-dom/client");
const { FileViewer } = await jiti.import("./FileViewer.tsx");

test("selected file lines are mentioned by the button, not Cmd/Ctrl+I", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => String(url).startsWith("/api/git/diff")
    ? Response.json({ patch: null })
    : Response.json({ content: "first line\nsecond line", language: "text", size: 22 });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const mentions = [];
  try {
    await React.act(async () => {
      root.render(React.createElement(FileViewer, {
        filePath: "/project/example.txt", cwd: "/project", watchEnabled: false,
        onMentionLines: (...args) => mentions.push(args),
      }));
    });
    const line = container.querySelector(".file-source-line-content");
    assert.ok(line);
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(line);
    await React.act(() => {
      selection.addRange(range);
      document.dispatchEvent(new window.Event("selectionchange"));
    });
    const button = container.querySelector('button[aria-label="mention"]');
    assert.match(button.title, /L1/);
    for (const modifier of [{ metaKey: true }, { ctrlKey: true }]) {
      const event = new window.KeyboardEvent("keydown", { key: "i", bubbles: true, cancelable: true, ...modifier });
      await React.act(() => line.dispatchEvent(event));
      assert.equal(event.defaultPrevented, false);
      assert.deepEqual(mentions, []);
    }
    await React.act(() => button.click());
    assert.deepEqual(mentions, [["example.txt", 1, 1]]);
  } finally {
    await React.act(() => root.unmount());
    container.remove();
    globalThis.fetch = originalFetch;
    await window.happyDOM.close();
  }
});
