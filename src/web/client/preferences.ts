// The settings that belong to this browser rather than to Pi's configuration.
// Every accessor treats storage as optional: a private window still gets a
// working settings page.

import { WARN_TOKENS_COOKIE } from "@core/context-usage";

export const SOUND_KEY = "web-pi:sound";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Without storage the choice lasts for this page only.
  }
}

/** Unset means on, as in pi-web: the tone is the useful default. */
export function soundEnabled(): boolean {
  return read(SOUND_KEY) !== "false";
}

/**
 * pi-web draws a preference toggle as `button[role=switch]`, not a checkbox,
 * so its state is an attribute rather than `checked`.
 */
export function switchOn(element: Element): boolean {
  return element.getAttribute("aria-checked") === "true";
}

export function setSwitch(element: Element, on: boolean): void {
  element.setAttribute("aria-checked", String(on));
}

export function setUpPreferences(): void {
  const sound = document.querySelector<HTMLButtonElement>("#sound-toggle");
  if (sound) {
    setSwitch(sound, soundEnabled());
    sound.addEventListener("click", () => {
      const on = !switchOn(sound);
      setSwitch(sound, on);
      write(SOUND_KEY, on ? "true" : "false");
    });
  }
  // The context-warning threshold is the one browser preference the server
  // reads: it colours a badge the server renders, so it lives in a cookie
  // rather than in localStorage, and the input arrives already filled in.
  const warnTokens =
    document.querySelector<HTMLInputElement>("#dumb-zone-tokens");
  if (warnTokens) {
    const previous = warnTokens.value;
    warnTokens.addEventListener("change", () => {
      const value = Number(warnTokens.value);
      if (!Number.isSafeInteger(value) || value <= 0) {
        warnTokens.value = previous;
        return;
      }
      document.cookie = `${WARN_TOKENS_COOKIE}=${String(value)}; path=/; max-age=31536000; samesite=lax`;
    });
  }
}

const LAST_CWD_KEY = "web-pi:last-cwd";

/**
 * The folder the picker last committed. The server keeps its own cookie for
 * the selected workspace; this is what pre-fills the browse box, so a reader
 * who browsed somewhere unusual finds the path already typed and one click
 * (Go, or Enter) away. Seeding only the input keeps the listing below it
 * honest: it still shows the folder the server actually opened.
 */
export function setUpFolderMemory(): void {
  document.body.addEventListener("htmx:afterSwap", (event) => {
    const target = event.target;
    if (!(target instanceof Element) || target.id !== "dialogs") return;
    const input = target.querySelector<HTMLInputElement>("#browse-path");
    const remembered = read(LAST_CWD_KEY);
    if (input && remembered !== null && remembered !== input.value) {
      input.value = remembered;
    }
  });
  document.body.addEventListener("htmx:configRequest", (event) => {
    const detail = (
      event as CustomEvent<{
        path?: string;
        parameters?: Record<string, unknown>;
      }>
    ).detail;
    if (detail.path !== "/workspaces/validate") return;
    const cwd = detail.parameters?.["cwd"];
    if (typeof cwd === "string" && cwd !== "") write(LAST_CWD_KEY, cwd);
  });
}
