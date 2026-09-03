import { getBrowserStorage, type StorageLike } from "./browser-storage";
import type { ContextUsage } from "./pi-types";

export const DEFAULT_DUMB_ZONE_TOKENS = 100_000;
const STORAGE_KEY = "pi-web:dumb-zone-tokens";

export type ContextWarningLevel = "none" | "yellow" | "red";

export function getContextWarningLevel(
  usage: ContextUsage | null,
  dumbZoneTokens: number,
): ContextWarningLevel {
  if (usage?.percent !== null && usage?.percent !== undefined && usage.percent >= 75) return "red";
  if (usage?.tokens !== null && usage?.tokens !== undefined && usage.tokens >= dumbZoneTokens) return "yellow";
  return "none";
}

export function getDumbZoneTokens(
  storage: StorageLike | null = getBrowserStorage(),
): number {
  if (!storage) return DEFAULT_DUMB_ZONE_TOKENS;
  try {
    const value = Number(storage.getItem(STORAGE_KEY));
    return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_DUMB_ZONE_TOKENS;
  } catch {
    return DEFAULT_DUMB_ZONE_TOKENS;
  }
}

export function setDumbZoneTokens(
  tokens: number,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage || !Number.isSafeInteger(tokens) || tokens <= 0) return;
  try {
    storage.setItem(STORAGE_KEY, String(tokens));
  } catch {
    // Browser storage is best-effort.
  }
}
