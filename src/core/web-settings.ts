import { DEFAULT_WARN_TOKENS } from "@core/context-usage";

export type WebSettings = {
  warnTokens: number;
  theme: "light" | "dark" | "auto";
  sound: boolean;
};

export const DEFAULT_WEB_SETTINGS: WebSettings = {
  warnTokens: DEFAULT_WARN_TOKENS,
  theme: "auto",
  sound: true,
};

/** Reject the whole edit rather than quietly saving only some fields. */
export function webSettingsPatch(value: unknown): Partial<WebSettings> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected web settings");
  }
  const patch: Partial<WebSettings> = {};
  for (const [key, setting] of Object.entries(value) as [string, unknown][]) {
    if (
      key === "warnTokens" &&
      typeof setting === "number" &&
      Number.isSafeInteger(setting) &&
      setting > 0
    ) {
      patch.warnTokens = setting;
    } else if (
      key === "theme" &&
      (setting === "light" || setting === "dark" || setting === "auto")
    ) {
      patch.theme = setting;
    } else if (key === "sound" && typeof setting === "boolean") {
      patch.sound = setting;
    } else {
      throw new Error(`Invalid web setting: ${key}`);
    }
  }
  return patch;
}

export type WebSettingsStore = {
  get(): WebSettings;
  update(patch: Partial<WebSettings>): WebSettings;
};
