import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { createJiti } from "jiti";

const window = new Window();
Object.assign(globalThis, {
  window,
  document: window.document,
  IS_REACT_ACT_ENVIRONMENT: true,
});
const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { createRoot } = await jiti.import("react-dom/client");
const { MessageView } = await jiti.import("./MessageView.tsx");
const { markdownRemarkPlugins } = await jiti.import("../lib/markdown.ts");

test("the live speed counter updates without reparsing unchanged Markdown", async (t) => {
  const container = document.createElement("div");
  const root = createRoot(container);
  let parses = 0;
  // Observe the real Markdown pipeline, including any reparses caused by timers.
  const observeParse = () => () => {
    parses += 1;
  };
  markdownRemarkPlugins.push(observeParse);
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 1000 });
  try {
    const message = {
      role: "assistant",
      content: [{ type: "text", text: "A **streaming** response" }],
    };
    await React.act(() =>
      root.render(
        React.createElement(MessageView, { message, isStreaming: true }),
      ),
    );
    assert.ok(parses > 0);
    parses = 0;
    for (let tick = 0; tick < 4; tick += 1) {
      await React.act(() => t.mock.timers.tick(300));
    }
    assert.match(container.textContent, /t\/s/);
    assert.equal(
      parses,
      0,
      "speed updates must not rerun the Markdown pipeline",
    );
    await React.act(() =>
      root.render(
        React.createElement(MessageView, {
          message: {
            ...message,
            content: [{ type: "text", text: "A **finished** response" }],
          },
          isStreaming: false,
        }),
      ),
    );
    assert.equal(container.querySelector("strong").textContent, "finished");
    assert.doesNotMatch(container.textContent, /t\/s/);
  } finally {
    await React.act(() => root.unmount());
    markdownRemarkPlugins.splice(
      markdownRemarkPlugins.indexOf(observeParse),
      1,
    );
    t.mock.timers.reset();
  }
});
