import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { SettingsPanel } = await jiti.import("./SettingsPanel.tsx");

function renderGeneral(overrides = {}) {
  return renderToStaticMarkup(React.createElement(SettingsPanel, {
    cwd: "/tmp/project",
    sessionId: "session-1",
    initialSection: "general",
    toolPresetControl: {
      preset: "read-only",
      disabled: false,
      onChange() {},
    },
    soundEnabled: true,
    onSoundToggle() {},
    onClose() {},
    onSessionReloaded() {},
    ...overrides,
  }));
}

test("renders all tool presets and completion sound in General settings", () => {
  const html = renderGeneral();

  assert.match(html, /aria-label="Change tool preset"/);
  assert.equal((html.match(/role="radio"/g) ?? []).length, 7);
  assert.match(html, /role="radio" aria-checked="true"[^>]*><span[^>]*>Read only<\/span>/);
  assert.match(html, /Completion sound/);
  assert.match(html, /role="switch" aria-checked="true" aria-label="Disable completion sound"/);
});

test("disables session tool changes while the session is busy", () => {
  const html = renderGeneral({
    toolPresetControl: {
      preset: "default",
      disabled: true,
      onChange() {},
    },
  });

  const toolGroup = html.slice(
    html.indexOf('aria-label="Change tool preset"'),
    html.indexOf("Completion sound"),
  );
  assert.equal((toolGroup.match(/disabled=""/g) ?? []).length, 4);
});
