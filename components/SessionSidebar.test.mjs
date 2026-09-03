import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { SessionIndicator } = await jiti.import("./SessionSidebar.tsx");

function renderIndicator(kind) {
  return renderToStaticMarkup(React.createElement(SessionIndicator, { kind }));
}

test("each session indicator keeps its own label, colour, and glyph", () => {
  const running = renderIndicator("running");
  assert.match(running, /^<span title="Agent running…" aria-label="Agent running…" style="width:14px;height:14px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;color:var\(--accent\)">/);
  assert.match(running, /<animateTransform attributeName="transform" type="rotate"/);

  const active = renderIndicator("active");
  assert.match(active, /title="Session active" aria-label="Session active" style="[^"]*color:#16a34a"/);
  assert.match(active, /<circle cx="7" cy="7" r="3" fill="currentColor">/);

  const stopped = renderIndicator("stopped");
  assert.match(stopped, /title="Session stopped" aria-label="Session stopped" style="[^"]*color:var\(--text-dim\)"/);
  assert.match(stopped, /<rect x="4" y="4" width="6" height="6" rx="1"/);

  const unread = renderIndicator("unread");
  assert.match(unread, /title="New activity" aria-label="New session activity" style="[^"]*color:#0891b2"/);
  assert.match(unread, /<animate attributeName="r" values="3;6;3"/);
});
