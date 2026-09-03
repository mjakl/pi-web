import { isToolPreset, type ToolPreset } from "./tool-presets";
import { getBrowserStorage, type StorageLike } from "./browser-storage";

const STORAGE_KEY = "pi-tool-preset";

export function getPreferredToolPreset(
  storage: StorageLike | null = getBrowserStorage(),
): ToolPreset {
  if (!storage) return "default";
  try {
    const value = storage.getItem(STORAGE_KEY);
    return isToolPreset(value) ? value : "default";
  } catch {
    return "default";
  }
}

export function setPreferredToolPreset(
  preset: ToolPreset,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, preset);
  } catch {
    // Browser storage is best-effort.
  }
}
