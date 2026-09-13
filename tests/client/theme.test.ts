import { describe, expect, it, vi } from "vitest";
import { click, device, htmxEvent, mount } from "./helpers.ts";

// pi-web's theme, down to the storage key: `pi-theme` holds light/dark/auto,
// `dark` on <html> is what the stylesheets key on, and "auto" follows the
// system scheme.

async function load() {
  return import("@web/client/theme");
}

function darkScheme(matches: boolean): void {
  device({ prefersColorScheme: matches ? "dark" : "light" });
}

const OPTIONS = `<div role="radiogroup">
  <button type="button" data-theme-option="light" aria-checked="false">Light</button>
  <button type="button" data-theme-option="dark" aria-checked="false">Dark</button>
  <button type="button" data-theme-option="auto" aria-checked="false">Auto</button>
</div>`;

describe("theme", () => {
  it("reads pi-theme and falls back to auto", async () => {
    const { storedPreference } = await load();
    expect(storedPreference()).toBe("auto");
    localStorage.setItem("pi-theme", "dark");
    expect(storedPreference()).toBe("dark");
    localStorage.setItem("pi-theme", "sepia");
    expect(storedPreference()).toBe("auto");
  });

  it("applies a stored dark preference to <html>", async () => {
    localStorage.setItem("pi-theme", "dark");
    const { setUpTheme } = await load();
    setUpTheme();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("follows the system scheme while set to auto", async () => {
    darkScheme(true);
    const { setUpTheme } = await load();
    setUpTheme();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    darkScheme(false);
    window.dispatchEvent(new Event("focus"));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("stores a picked option and marks it in the radio group", async () => {
    mount(OPTIONS);
    const { setUpTheme } = await load();
    setUpTheme();
    const auto = document.querySelector('[data-theme-option="auto"]');
    expect(auto?.getAttribute("aria-checked")).toBe("true");
    const dark = document.querySelector('[data-theme-option="dark"]');
    if (!dark) throw new Error("no option");
    click(dark);
    expect(localStorage.getItem("pi-theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(dark.getAttribute("aria-checked")).toBe("true");
    expect(auto?.getAttribute("aria-checked")).toBe("false");
  });

  it("paints a radio group that arrives as a fragment", async () => {
    localStorage.setItem("pi-theme", "light");
    const { setUpTheme } = await load();
    setUpTheme();
    mount(OPTIONS);
    htmxEvent(document.body, "htmx:after:settle");
    expect(
      document
        .querySelector('[data-theme-option="light"]')
        ?.getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("uses a view transition for the wipe when the browser has one", async () => {
    const ready = Promise.resolve();
    const start = vi.fn((apply: () => void) => {
      apply();
      return { ready };
    });
    Object.assign(document, { startViewTransition: start });
    const animate = vi.fn();
    document.documentElement.animate = animate;
    const { setThemePreference } = await load();
    setThemePreference("dark");
    expect(start).toHaveBeenCalledOnce();
    await ready;
    expect(animate).toHaveBeenCalledOnce();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    Object.assign(document, { startViewTransition: undefined });
  });
});
