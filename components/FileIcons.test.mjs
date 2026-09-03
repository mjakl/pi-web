import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { MentionIcon } = await jiti.import("./FileIcons.tsx");

test("renders the mention glyph at 14px by default and at a requested size", () => {
  const html = renderToStaticMarkup(React.createElement(MentionIcon));
  assert.match(html, /^<svg width="14" height="14" viewBox="0 0 24 24"[^>]*aria-hidden="true">/);
  assert.match(html, /<circle cx="12" cy="12" r="4"><\/circle><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"><\/path>/);

  const small = renderToStaticMarkup(React.createElement(MentionIcon, { size: 11 }));
  assert.match(small, /^<svg width="11" height="11" /);
});
