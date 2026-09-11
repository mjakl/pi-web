// The three settings the server cannot hold, because they belong to this
// browser and not to Pi's configuration. Every accessor treats storage as
// optional: a private window still gets a working settings page.

export const SOUND_KEY = "web-pi:sound";
export const DUMB_ZONE_KEY = "web-pi:dumb-zone-tokens";

const DEFAULT_DUMB_ZONE = 100_000;

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

/** Only a positive whole number is a threshold; anything else is the default. */
export function dumbZoneTokens(): number {
  const value = Number(read(DUMB_ZONE_KEY));
  return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_DUMB_ZONE;
}

export function setUpPreferences(): void {
  const sound = document.querySelector<HTMLInputElement>("#sound-toggle");
  if (sound) {
    sound.checked = soundEnabled();
    sound.addEventListener("change", () => {
      write(SOUND_KEY, sound.checked ? "true" : "false");
    });
  }
  const dumbZone =
    document.querySelector<HTMLInputElement>("#dumb-zone-tokens");
  if (dumbZone) {
    dumbZone.value = String(dumbZoneTokens());
    dumbZone.addEventListener("change", () => {
      const value = Number(dumbZone.value);
      if (!Number.isSafeInteger(value) || value <= 0) {
        dumbZone.value = String(dumbZoneTokens());
        return;
      }
      write(DUMB_ZONE_KEY, String(value));
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
