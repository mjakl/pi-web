import { WARN_TOKENS_COOKIE } from "@core/context-usage";
import { describe, expect, it } from "vitest";
import { blockStorage, byId, click, field, mount } from "./helpers.ts";

// The settings that belong to this browser: the completion tone in
// localStorage, and the context-warning threshold in a cookie the server reads.

async function load(html: string) {
  mount(html);
  const preferences = await import("@web/client/preferences");
  preferences.setUpPreferences();
  return preferences;
}

describe("the sound switch", () => {
  it("is on until turned off, and remembers", async () => {
    const { soundEnabled } = await load(
      '<button type="button" id="sound-toggle" role="switch" aria-checked="false"></button>',
    );
    expect(soundEnabled()).toBe(true);
    expect(byId("sound-toggle").getAttribute("aria-checked")).toBe("true");
    click(byId("sound-toggle"));
    expect(byId("sound-toggle").getAttribute("aria-checked")).toBe("false");
    expect(localStorage.getItem("web-pi:sound")).toBe("false");
    expect(soundEnabled()).toBe(false);
    click(byId("sound-toggle"));
    expect(localStorage.getItem("web-pi:sound")).toBe("true");
  });

  it("still works for this page without storage", async () => {
    blockStorage();
    const { soundEnabled, switchOn } = await load(
      '<button type="button" id="sound-toggle" role="switch" aria-checked="false"></button>',
    );
    expect(soundEnabled()).toBe(true);
    click(byId("sound-toggle"));
    expect(switchOn(byId("sound-toggle"))).toBe(false);
  });
});

describe("the context warning threshold", () => {
  it("writes a valid number to the cookie and puts back an invalid one", async () => {
    await load('<input id="dumb-zone-tokens" value="150000">');
    const input = field("#dumb-zone-tokens");
    input.value = "abc";
    input.dispatchEvent(new Event("change"));
    expect(input.value).toBe("150000");
    input.value = "-5";
    input.dispatchEvent(new Event("change"));
    expect(input.value).toBe("150000");
    input.value = "120000";
    input.dispatchEvent(new Event("change"));
    expect(document.cookie).toContain(`${WARN_TOKENS_COOKIE}=120000`);
  });
});
