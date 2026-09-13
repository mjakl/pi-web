import { DEFAULT_WEB_SETTINGS } from "@core/web-settings";
import { SettingsBody } from "@web/views/Settings";
import { describe, expect, it, vi } from "vitest";
import {
  byId,
  click,
  field,
  flush,
  htmxEvent,
  json,
  mockFetch,
  mount,
  text,
} from "./helpers.ts";

async function load() {
  mount(SettingsBody({ section: "general", cwd: "/repo" }));
  const preferences = await import("@web/client/preferences");
  preferences.setUpPreferences();
  return preferences;
}

describe("shared preferences", () => {
  it("ignores legacy values and saves sound on the server before applying it", async () => {
    localStorage.setItem("web-pi:sound", "false");
    const fetch = mockFetch(() =>
      json({ ...DEFAULT_WEB_SETTINGS, sound: false }),
    );
    const { soundEnabled } = await load();
    expect(soundEnabled()).toBe(true);
    click(byId("sound-toggle"));
    expect(soundEnabled()).toBe(true);
    await flush();
    expect(soundEnabled()).toBe(false);
    expect(fetch).toHaveBeenCalledWith(
      "/settings/web",
      expect.objectContaining({ body: '{"sound":false}' }),
    );
  });

  it("saves theme and updates the selection without browser storage", async () => {
    mockFetch(() => json({ ...DEFAULT_WEB_SETTINGS, theme: "dark" }));
    await load();
    const dark = document.querySelector<HTMLElement>(
      '[data-theme-option="dark"]',
    );
    if (!dark) throw new Error("No dark option");
    click(dark);
    await flush();
    expect(dark.getAttribute("aria-checked")).toBe("true");
    expect(document.documentElement.dataset["theme"]).toBe("dark");
    expect(localStorage.getItem("web-pi-theme")).toBeNull();
  });

  it("rejects invalid thresholds and persists a positive safe integer", async () => {
    const fetch = mockFetch(() =>
      json({ ...DEFAULT_WEB_SETTINGS, warnTokens: 120001 }),
    );
    await load();
    const input = field("#dumb-zone-tokens");
    input.value = "-5";
    input.dispatchEvent(new Event("change"));
    expect(input.value).toBe("100000");
    expect(fetch).not.toHaveBeenCalled();
    input.value = "120001";
    input.dispatchEvent(new Event("change"));
    await flush();
    expect(fetch).toHaveBeenCalledWith(
      "/settings/web",
      expect.objectContaining({ body: '{"warnTokens":120001}' }),
    );
    expect(input.value).toBe("120001");
  });

  it("retains confirmed state and reports failed writes", async () => {
    mockFetch(() => text("failed", 500));
    const { soundEnabled } = await load();
    click(byId("sound-toggle"));
    await flush();
    expect(soundEnabled()).toBe(true);
    expect(byId("web-settings-status").textContent).toContain("Could not save");
    expect((byId("sound-toggle") as HTMLButtonElement).disabled).toBe(false);
  });

  it("loads another browser's shared settings when this page regains focus", async () => {
    mockFetch(() => json({ warnTokens: 12345, sound: false, theme: "dark" }));
    const { soundEnabled } = await load();
    window.dispatchEvent(new Event("focus"));
    await flush();
    expect(soundEnabled()).toBe(false);
    expect(field("#dumb-zone-tokens").value).toBe("12345");
  });

  it("keeps replacement controls disabled until a pending save finishes", async () => {
    const saved = Promise.withResolvers<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => saved.promise),
    );
    const { soundEnabled } = await load();
    click(byId("sound-toggle"));
    mount(SettingsBody({ section: "general", cwd: "/repo" }));
    htmxEvent(document.body, "htmx:after:process");
    expect((byId("sound-toggle") as HTMLButtonElement).disabled).toBe(true);
    saved.resolve(json({ ...DEFAULT_WEB_SETTINGS, sound: false }));
    await flush();
    expect(soundEnabled()).toBe(false);
    expect((byId("sound-toggle") as HTMLButtonElement).disabled).toBe(false);
  });

  it("detaches replaced General controls and mounts the replacement once", async () => {
    const fetch = mockFetch(() =>
      json({ ...DEFAULT_WEB_SETTINGS, sound: false }),
    );
    await load();
    const old = byId("sound-toggle");
    mount(SettingsBody({ section: "general", cwd: "/repo" }));
    htmxEvent(document.body, "htmx:after:process");
    htmxEvent(document.body, "htmx:after:process");
    click(old);
    expect(fetch).not.toHaveBeenCalled();
    click(byId("sound-toggle"));
    await flush();
    expect(fetch).toHaveBeenCalledOnce();
  });
});
