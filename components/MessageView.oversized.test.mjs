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

for (const role of ["user", "assistant"]) {
  test(`oversized ${role} text keeps the reveal safeguard and its intended height behavior`, async () => {
    const text = "**Large pasted content**\n".repeat(5000);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          React.createElement(MessageView, {
            message: { role, content: [{ type: "text", text }] },
          }),
        ),
      );
      assert.equal(container.querySelector("pre"), null);
      const reveal = [...container.querySelectorAll("button")].find((button) =>
        button.textContent.includes("125 KB"),
      );
      assert.ok(reveal, "oversized text starts behind the reveal button");
      await act(async () => reveal.click());
      const raw = container.querySelector("pre");
      assert.equal(raw.textContent, text);
      assert.equal(raw.querySelector("strong"), null);
      if (role === "user") {
        for (
          let ancestor = raw.parentElement;
          ancestor && ancestor !== container;
          ancestor = ancestor.parentElement
        ) {
          assert.ok(["", "none"].includes(ancestor.style.maxHeight));
          assert.ok(["", "visible"].includes(ancestor.style.overflow));
          assert.ok(["", "visible"].includes(ancestor.style.overflowY));
        }
      } else {
        assert.equal(raw.parentElement.style.maxHeight, "420px");
        assert.equal(raw.parentElement.style.overflow, "auto");
      }
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
}
