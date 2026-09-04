import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { createJiti } from "jiti";

registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith(".css")) return nextLoad(url, context);
    return { format: "module", shortCircuit: true, source: "export default {};" };
  },
});

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { ChatWindow } = await jiti.import("./ChatWindow.tsx");
const { DockedComposer } = await jiti.import("./DockedComposer.tsx");

test("shows the product name without version details in the empty composer", () => {
  const html = renderToStaticMarkup(React.createElement(ChatWindow, {
    session: null,
    newSessionCwd: "/tmp/project",
    newSessionDraftKey: "draft",
  }));

  assert.match(html, />Pi Web<\/span>/);
  assert.doesNotMatch(html, /(?:web|pi) <span[^>]*>v/);
});

test("does not draw a hard divider above the docked composer", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      DockedComposer,
      null,
      React.createElement("span", null, "composer"),
      React.createElement("span", null, "status"),
    ),
  );

  assert.match(html, /^<div style="position:relative">/);
  assert.match(html, />composer<\/span><span>status<\/span><\/div>$/);
});
