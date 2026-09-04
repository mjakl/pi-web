import { enMessages } from "./messages/en";

/** Values inserted into English UI messages at runtime. */
export type TranslationParams = Record<string, string | number>;

/** Replaces simple interpolation placeholders in an English UI message. */
export function interpolateMessage(message: string, params: TranslationParams = {}): string {
  return message.replace(/\{([\w.-]+)\}/g, (token, name: string) => {
    const value = params[name];
    return value === undefined ? token : String(value);
  });
}

/** Resolves and interpolates an English UI message, or returns its key. */
export function translateMessage(key: string, params: TranslationParams = {}): string {
  const message = enMessages[key];
  if (message === undefined) {
    if (process.env.NODE_ENV !== "production") console.warn(`[i18n] Missing translation: ${key}`);
    return key;
  }
  return interpolateMessage(message, params);
}

/**
 * Compact count for tight UI: 1.2M, 12k, 999. Kept hand-rolled rather than
 * Intl compact notation, which renders an uppercase "K".
 */
export function formatCompactCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return value.toLocaleString("en");
}

/** Formats a message timestamp in English with a 24-hour clock. */
export function formatTimestamp(timestamp: number, now = new Date()): string {
  const date = new Date(timestamp);
  const isToday = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  const time = date.toLocaleTimeString("en", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  if (isToday) return time;
  const formattedDate = date.toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
  return `${formattedDate} ${time}`;
}

/** Formats a relative timestamp in English. */
export function formatRelativeTime(date: Date | string, now = new Date()): string {
  const target = date instanceof Date ? date : new Date(date);
  const diffMs = target.getTime() - now.getTime();
  const absMs = Math.abs(diffMs);
  const [unit, divisor] = absMs < 60_000
    ? ["second", 1_000]
    : absMs < 3_600_000
      ? ["minute", 60_000]
      : absMs < 86_400_000
        ? ["hour", 3_600_000]
        : ["day", 86_400_000];
  const value = Math.round(diffMs / divisor);
  return new Intl.RelativeTimeFormat("en", { numeric: "always" }).format(value, unit as Intl.RelativeTimeFormatUnit);
}

/** Compact elapsed time for tool calls, expressed in whole seconds. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  if (hours) return `${hours.toLocaleString("en")}h ${minutes}m ${remainder}s`;
  if (minutes) return `${minutes}m ${remainder}s`;
  return `${remainder}s`;
}
