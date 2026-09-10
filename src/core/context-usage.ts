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

export function contextUsage(input: {
  tokens: number | null | undefined;
  contextWindow: number | null | undefined;
  estimated?: boolean;
}): ContextUsage {
  const tokens = input.tokens ?? null;
  const contextWindow =
    input.contextWindow && input.contextWindow > 0 ? input.contextWindow : null;
  const percent =
    tokens === null || contextWindow === null
      ? null
      : Math.min(100, (tokens / contextWindow) * 100);
  const level =
    percent === null
      ? "unknown"
      : percent >= CONTEXT_CRITICAL_PERCENT
        ? "critical"
        : percent >= CONTEXT_WARN_PERCENT
          ? "warn"
          : "ok";
  return {
    tokens,
    contextWindow,
    percent,
    level,
    estimated: input.estimated ?? false,
  };
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 10_000) return `${String(Math.round(tokens / 1000))}k`;
  if (tokens >= 1_000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
}
