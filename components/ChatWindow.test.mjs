import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { DockedComposer } = await jiti.import("./DockedComposer.tsx");

test("separates the docked composer from the full chat pane", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      DockedComposer,
      null,
      React.createElement("span", null, "composer"),
      React.createElement("span", null, "status"),
    ),
  );

  assert.match(html, /^<div style="position:relative;border-top:1px solid var\(--border\)">/);
  assert.match(html, />composer<\/span><span>status<\/span><\/div>$/);
});
