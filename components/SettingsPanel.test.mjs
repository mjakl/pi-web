import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { SettingsPanel } = await jiti.import("./SettingsPanel.tsx");

function renderGeneral(overrides = {}) {
  return renderToStaticMarkup(
    React.createElement(SettingsPanel, {
      cwd: "/tmp/project",
      sessionId: "session-1",
      initialSection: "general",
      soundEnabled: true,
      onSoundToggle() {},
      dumbZoneTokens: 100_000,
      onDumbZoneTokensChange() {},
      onClose() {},
      onSessionReloaded() {},
      ...overrides,
    }),
  );
}

test("renders theme and completion sound in General settings", () => {
  const html = renderGeneral();

  assert.equal((html.match(/role="radio"/g) ?? []).length, 3);
  assert.doesNotMatch(html, /Tool selection|Chat only|Read only/);
  assert.match(html, /Completion sound/);
  assert.match(
    html,
    /role="switch" aria-checked="true" aria-label="Disable completion sound"/,
  );
});

test("General settings has no shell preference or settings request", async (t) => {
  const window = new Window();
  Object.assign(globalThis, {
    window,
    document: window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    requests.push(url);
    return Response.json({ isWindows: true, powerShellEnabled: true });
  });
  const { createRoot } = await jiti.import("react-dom/client");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  t.after(async () => {
    await React.act(() => root.unmount());
    await window.happyDOM.close();
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  await React.act(() =>
    root.render(
      React.createElement(SettingsPanel, {
        cwd: "/tmp/project",
        sessionId: "session-1",
        initialSection: "general",
        soundEnabled: true,
        onSoundToggle() {},
        dumbZoneTokens: 100_000,
        onDumbZoneTokensChange() {},
        onClose() {},
        onSessionReloaded() {},
      }),
    ),
  );
  assert.deepEqual(requests, []);
  assert.doesNotMatch(container.textContent, /PowerShell|Shell tool/);
  assert.match(container.textContent, /Completion sound/);
});

test("renders the dumb-zone token threshold in General settings", () => {
  const html = renderGeneral({ dumbZoneTokens: 120_000 });

  assert.match(html, /Dumb zone/);
  assert.match(html, /type="number"[^>]*value="120000"/);
});
