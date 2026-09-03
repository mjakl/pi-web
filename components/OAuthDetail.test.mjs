import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { OAuthDetail } = await jiti.import("./OAuthDetail.tsx");

function render(provider) {
  return renderToStaticMarkup(React.createElement(OAuthDetail, { provider, onRefresh() {} }));
}

const provider = { id: "anthropic", name: "Anthropic", usesCallbackServer: true, loggedIn: false };

test("a signed-out provider offers login and explains what connecting does", () => {
  const html = render(provider);
  assert.match(html, />not connected</);
  assert.match(html, /Connect your Anthropic account\./);
  assert.match(html, /<button[^>]*>Login<\/button>/);
  assert.doesNotMatch(html, /Disconnect/);
});

test("a connected provider offers re-login and disconnect", () => {
  const html = render({ ...provider, loggedIn: true });
  assert.match(html, />Connected</);
  assert.match(html, /Already connected\. You can re-login or disconnect\./);
  assert.match(html, /<button[^>]*>Re-login<\/button>/);
  assert.match(html, /<button[^>]*>Disconnect<\/button>/);
});
