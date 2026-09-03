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

test("shows the validated runtime Pi version in the empty composer", () => {
  const html = renderToStaticMarkup(React.createElement(ChatWindow, {
    piVersion: "0.84.4",
    session: null,
    newSessionCwd: "/tmp/project",
    newSessionDraftKey: "draft",
  }));

  assert.match(html, /pi <span[^>]*>v0\.84\.4<\/span>/);
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
