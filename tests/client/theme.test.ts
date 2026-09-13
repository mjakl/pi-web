import { describe, expect, it } from "vitest";
import { device } from "./helpers.ts";

describe("shared theme", () => {
  it("ignores legacy browser preferences and defaults to auto", async () => {
    localStorage.setItem("web-pi-theme", "dark");
    const { storedPreference, setUpTheme } = await import("@web/client/theme");
    setUpTheme();
    expect(storedPreference()).toBe("auto");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("applies the server-rendered theme before client interactions", async () => {
    document.documentElement.dataset["theme"] = "dark";
    const { setUpTheme } = await import("@web/client/theme");
    setUpTheme();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("resolves auto against each device's OS appearance", async () => {
    device({ prefersColorScheme: "dark" });
    const { setUpTheme } = await import("@web/client/theme");
    setUpTheme();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    device({ prefersColorScheme: "light" });
    window.dispatchEvent(new Event("focus"));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("applies an updated shared preference without a page reload", async () => {
    const { setUpTheme } = await import("@web/client/theme");
    setUpTheme();
    document.documentElement.dataset["theme"] = "dark";
    document.dispatchEvent(new Event("web-pi:settings"));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
