// The one place that turns "tokens in context" and "context window" into what
// the UI shows. Every badge, bar, and warning renders from this value, so a
// number can never disagree with itself across the page.

export type ContextUsage = {
  tokens: number | null;
  contextWindow: number | null;
  /** 0..100, or null while tokens or window are unknown. */
  percent: number | null;
  level: "unknown" | "ok" | "warn" | "critical";
  /** True when tokens were estimated rather than reported by the provider. */
  estimated: boolean;
};

export const CONTEXT_WARN_PERCENT = 60;
export const CONTEXT_CRITICAL_PERCENT = 80;

/**
 * The reader's own warning threshold in tokens, pi-web's "dumb zone": above
 * this many tokens in context a model gets noticeably worse, whatever the
 * window says. Kept in a cookie so the server renders the badge already
 * coloured, with the same default pi-web uses.
 */
export const DEFAULT_WARN_TOKENS = 100_000;

/** The cookie the browser writes it to, read by every page that shows usage. */
export const WARN_TOKENS_COOKIE = "web-pi-warn-tokens";

/** Only a positive whole number is a threshold; anything else is the default. */
export function parseWarnTokens(value: string | undefined): number {
  const tokens = Number(value);
  return Number.isSafeInteger(tokens) && tokens > 0
    ? tokens
    : DEFAULT_WARN_TOKENS;
}

export function contextUsage(input: {
  tokens: number | null | undefined;
  contextWindow: number | null | undefined;
  estimated?: boolean;
  /** The reader's token threshold; `DEFAULT_WARN_TOKENS` when unset. */
  warnTokens?: number | undefined;
}): ContextUsage {
  const tokens = input.tokens ?? null;
  const contextWindow =
    input.contextWindow && input.contextWindow > 0 ? input.contextWindow : null;
  const percent =
    tokens === null || contextWindow === null
      ? null
      : Math.min(100, (tokens / contextWindow) * 100);
  const warnTokens = input.warnTokens ?? DEFAULT_WARN_TOKENS;
  const level =
    percent !== null && percent >= CONTEXT_CRITICAL_PERCENT
      ? "critical"
      : (percent !== null && percent >= CONTEXT_WARN_PERCENT) ||
          (tokens !== null && tokens >= warnTokens)
        ? "warn"
        : percent === null
          ? "unknown"
          : "ok";
  return {
    tokens,
    contextWindow,
    percent,
    level,
    estimated: input.estimated ?? false,
  };
}

/**
 * pi-web's `formatCompactCount`: one decimal from a million, whole thousands
 * below that. Kept separate from `formatTokens` because the top bar reads
 * "1.9M" where the stats panel reads the exact number.
 */
export function formatCompactCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${String(Math.round(value / 1_000))}k`;
  return value.toLocaleString("en");
}

/**
 * The top bar's context readout: "242k / 272k (88.8%)", with a leading "~" on
 * an estimate. Empty when there is no window to measure against.
 */
export function formatContextUsage(usage: ContextUsage): string {
  if (usage.contextWindow === null) return "";
  const mark = (value: string) => (usage.estimated ? `~${value}` : value);
  const used =
    usage.tokens === null ? "?" : mark(formatCompactCount(usage.tokens));
  const percent =
    usage.percent === null
      ? "?"
      : mark(
          `${usage.percent.toLocaleString("en", { maximumFractionDigits: 1 })}%`,
        );
  return `${used} / ${formatCompactCount(usage.contextWindow)} (${percent})`;
}

/**
 * The top bar's hover text: exact numbers where the readout is compact.
 * pi-web spells it "Context: 241,829 / 272,000 tokens (88.9%)".
 */
export function formatContextTooltip(usage: ContextUsage): string {
  if (usage.contextWindow === null) return "";
  const mark = (value: string) => (usage.estimated ? `~${value}` : value);
  const used =
    usage.tokens === null ? "?" : mark(usage.tokens.toLocaleString("en"));
  const percent =
    usage.percent === null
      ? "?"
      : mark(
          `${usage.percent.toLocaleString("en", { maximumFractionDigits: 1 })}%`,
        );
  return `Context: ${used} / ${usage.contextWindow.toLocaleString("en")} tokens (${percent})`;
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 10_000) return `${String(Math.round(tokens / 1000))}k`;
  if (tokens >= 1_000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
}
