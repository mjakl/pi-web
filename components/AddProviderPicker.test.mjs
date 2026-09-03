import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { AddProviderPicker } = await jiti.import("./AddProviderPicker.tsx");

const noop = () => {};

function render(props) {
  return renderToStaticMarkup(React.createElement(AddProviderPicker, {
    oauthProviders: [],
    apiKeyProviders: [],
    onSelectOAuth: noop,
    onSelectApiKey: noop,
    onAddCustom: noop,
    onClose: noop,
    ...props,
  }));
}

test("lists only providers that are not yet connected, grouped after the custom option", () => {
  const html = render({
    oauthProviders: [
      { id: "alpha", name: "Alpha Cloud", usesCallbackServer: true, loggedIn: false },
      { id: "beta", name: "Beta Cloud", usesCallbackServer: false, loggedIn: true },
    ],
    apiKeyProviders: [
      { id: "gamma", displayName: "Gamma Models", configured: false, modelCount: 4 },
      { id: "delta", displayName: "Delta Models", configured: true, modelCount: 1 },
    ],
  });
  assert.match(html, />OpenAI \/ Anthropic compatible</);
  assert.match(html, />Custom endpoint format</);
  assert.match(html, />Subscriptions</);
  assert.match(html, />Alpha Cloud</);
  assert.doesNotMatch(html, /Beta Cloud/);
  assert.match(html, />Gamma Models</);
  assert.match(html, />4 models</);
  assert.doesNotMatch(html, /Delta Models/);
  assert.ok(html.indexOf("Custom endpoint format") < html.indexOf("Alpha Cloud"));
  assert.ok(html.indexOf("Alpha Cloud") < html.indexOf("Gamma Models"));
});

test("shows the custom option alone when every provider is already connected", () => {
  const html = render({
    oauthProviders: [{ id: "beta", name: "Beta Cloud", usesCallbackServer: false, loggedIn: true }],
    apiKeyProviders: [{ id: "delta", displayName: "Delta Models", configured: true, modelCount: 1 }],
  });
  assert.match(html, />OpenAI \/ Anthropic compatible</);
  assert.doesNotMatch(html, /Subscriptions/);
  assert.doesNotMatch(html, /No providers match/);
});
