import assert from "node:assert/strict";
import { after, test } from "node:test";
import { Window } from "happy-dom";
import { createJiti } from "jiti";

const window = new Window({ url: "http://localhost" });
Object.assign(globalThis, {
  window,
  document: window.document,
  HTMLElement: window.HTMLElement,
  Node: window.Node,
  Event: window.Event,
  MouseEvent: window.MouseEvent,
  IS_REACT_ACT_ENVIRONMENT: true,
});
after(() => window.happyDOM.close());
const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { act } = React;
const { createRoot } = await jiti.import("react-dom/client");
const { MessageView } = await jiti.import("./MessageView.tsx");

const markdown = "## Plan\n\nUse **care** and `code`.\n\n- First\n- Second";

for (const deferred of [false, true]) {
  test(`thinking renders Markdown on expansion (deferred=${deferred})`, async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const originalFetch = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = async () => {
      requests++;
      return new Response(JSON.stringify({ thinking: markdown }));
    };
    const render = async (thinking) =>
      act(async () =>
        root.render(
          React.createElement(MessageView, {
            message: {
              role: "assistant",
              content: [{ type: "thinking", thinking, deferred }],
            },
            sessionId: "thinking-markdown-test",
            entryId: "entry-1",
            isStreaming: !deferred,
          }),
        ),
      );
    try {
      await render(deferred ? "" : markdown);
      const header = [...container.querySelectorAll("button")].find(
        (button) => button.textContent === "Thinking",
      );
      assert.ok(header.querySelector('svg[aria-hidden="true"]'));
      assert.equal(header.getAttribute("aria-expanded"), "false");
      assert.equal(container.querySelector("h2"), null);
      assert.equal(requests, 0);
      await act(async () => header.click());
      assert.equal(header.getAttribute("aria-expanded"), "true");
      assert.equal(container.querySelector("h2").textContent, "Plan");
      assert.equal(container.querySelector("strong").textContent, "care");
      assert.equal(container.querySelector("code").textContent, "code");
      assert.equal(container.querySelectorAll("li").length, 2);
      if (!deferred) {
        await render(markdown + "\n\n**Updated**");
        assert.equal(
          container.querySelectorAll("strong")[1].textContent,
          "Updated",
        );
      }
      await act(async () => header.click());
      assert.equal(header.getAttribute("aria-expanded"), "false");
      assert.equal(container.querySelector("h2"), null);
      await act(async () => header.click());
      assert.equal(container.querySelector("h2").textContent, "Plan");
      assert.equal(requests, deferred ? 1 : 0);
    } finally {
      globalThis.fetch = originalFetch;
      await act(async () => root.unmount());
      container.remove();
    }
  });
}
