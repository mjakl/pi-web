import { formatTokens } from "@core/context-usage";
import type { SessionStats } from "@core/session-entries";
import type { SessionSummary } from "@core/sessions";
import type { ContextUsage } from "@core/context-usage";
import { ContextBadge } from "./Status.tsx";

function duration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds >= 3600) {
    return `${String(Math.floor(seconds / 3600))}h ${String(Math.floor((seconds % 3600) / 60))}m`;
  }
  if (seconds >= 60) {
    return `${String(Math.floor(seconds / 60))}m ${String(seconds % 60)}s`;
  }
  return `${String(seconds)}s`;
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div class="flex justify-between gap-4">
      <span class="text-base-content/60">{label}</span>
      <span class="text-right">{value}</span>
    </div>
  );
}

/** The session info panel: what this conversation has cost so far. */
export function StatsPanel({
  summary,
  stats,
  usage,
}: {
  summary: SessionSummary;
  stats: SessionStats;
  usage: ContextUsage;
}) {
  const count = (value: number) => value.toLocaleString("en");
  const { tokens } = stats;
  return (
    <div class="flex flex-col gap-1">
      <Line label="Session" value={summary.id} />
      <Line label="Folder" value={summary.cwd} />
      {stats.activeMs > 0 ? (
        <Line label="Active time" value={duration(stats.activeMs)} />
      ) : null}
      {summary.worktreeBranch ? (
        <Line label="Branch" value={summary.worktreeBranch} />
      ) : null}
      <div class="divider my-1" />
      <Line label="User messages" value={count(stats.userMessages)} />
      <Line label="Answers" value={count(stats.assistantMessages)} />
      <Line label="Tool calls" value={count(stats.toolCalls)} />
      <Line label="Tool results" value={count(stats.toolResults)} />
      <Line label="Total messages" value={count(stats.totalMessages)} />
      <div class="divider my-1" />
      <Line label="Input" value={formatTokens(tokens.input)} />
      <Line label="Output" value={formatTokens(tokens.output)} />
      {tokens.cacheRead > 0 ? (
        <Line label="Cache read" value={formatTokens(tokens.cacheRead)} />
      ) : null}
      {tokens.cacheWrite > 0 ? (
        <Line label="Cache write" value={formatTokens(tokens.cacheWrite)} />
      ) : null}
      <Line label="Total tokens" value={formatTokens(tokens.total)} />
      {stats.cacheHitRate === null ? null : (
        <Line
          label="Avg cache hit rate"
          value={`${(stats.cacheHitRate * 100).toFixed(1)}%`}
        />
      )}
      <div class="mt-1 flex justify-between gap-4">
        <span class="text-base-content/60">Context</span>
        <ContextBadge usage={usage} />
      </div>
    </div>
  );
}
