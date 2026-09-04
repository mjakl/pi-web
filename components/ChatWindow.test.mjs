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

test("shows the product name without version details in the empty composer", () => {
  const html = renderToStaticMarkup(React.createElement(ChatWindow, {
    session: null,
    newSessionCwd: "/tmp/project",
    newSessionDraftKey: "draft",
  }));

  assert.match(html, />Pi Web<\/span>/);
  assert.doesNotMatch(html, /(?:web|pi) <span[^>]*>v/);
});

test("keeps the empty transcript and composer in one semantic layout", () => {
  const html = renderToStaticMarkup(React.createElement(ChatWindow, {
    session: null,
    newSessionCwd: "/tmp/project",
    newSessionDraftKey: "draft",
  }));

  assert.match(html, /^<section class="chat-window is-empty" aria-label="messages"/);
  assert.ok(html.indexOf('class="chat-body"') < html.indexOf('class="chat-composer"'));
  assert.equal(html.match(/<textarea/g)?.length, 1);
  assert.match(html, /<footer class="chat-composer">/);
});
