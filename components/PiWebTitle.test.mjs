import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { PiWebTitle } = await jiti.import("./PiWebTitle.tsx");

test("renders the product name as a plain button before any scramble runs", () => {
  const html = renderToStaticMarkup(React.createElement(PiWebTitle));
  assert.match(html, /^<button style="[^"]*">Pi Web<\/button>$/);
  assert.match(html, /color:var\(--text\)/);
  assert.match(html, /font-family:var\(--font-mono\)/);
  assert.match(html, /min-width:6ch/);
});
