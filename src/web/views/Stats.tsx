import { formatContextUsage } from "@core/context-usage";
import type { ContextUsage } from "@core/context-usage";
import type { SessionStats } from "@core/session-entries";
import type { SessionSummary } from "@core/sessions";
import { CheckIcon, CopyIcon } from "./icons.tsx";

// The session info panel, one of the three surfaces the top bar opens. pi-web
// draws it as a three-column mono grid inside a menu surface
// (components/AppShell.tsx L2134-L2624); the inline styles here are its own.

function duration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds >= 3600) {
    return `${String(Math.floor(seconds / 3600))}h ${String(Math.floor((seconds % 3600) / 60))}m`;
  }
  if (seconds >= 60) {
    return `${String(Math.floor(seconds / 60))}m ${String(seconds % 60)}s`;
  }
  return `${String(seconds)}s`;
}

const SECTION_TITLE =
  "font-size:11px; font-weight:700; color:var(--text); margin-bottom:6px";
const LABEL = "color:var(--text-dim); white-space:nowrap";
const VALUE =
  "color:var(--text-muted); min-width:0; overflow-wrap:anywhere;" +
  " word-break:break-word; white-space:normal";

/**
 * A copyable value. The button holds both icons and the client swaps them for
 * 1400ms after a copy, as pi-web's `copiedSessionField` state does.
 */
function Copy({ label, value }: { label: string; value: string }) {
  return (
    <button
      type="button"
      style="align-self:start; display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; margin-top:-2px; color:var(--text-dim); background:transparent; border:1px solid var(--border); border-radius:4px; cursor:pointer; flex:0 0 auto; transition:color 0.12s, border-color 0.12s, background 0.12s"
      data-session-copy={value}
      title={label}
      aria-label={label}
    >
      <span data-copy-idle>
        <CopyIcon size={12} width={2} />
      </span>
      <span data-copy-done hidden>
        <CheckIcon size={12} width={2} />
      </span>
    </button>
  );
}

/** Label, value and an optional copy button, as one grid row. */
function InfoRow({
  label,
  value,
  copy,
}: {
  label: string;
  value: string;
  /** A path or an id is worth copying; a duration is not. */
  copy?: string;
}) {
  return (
    <div style="display:contents">
      <div style={LABEL}>{label}</div>
      <div style={VALUE}>{value}</div>
      <div>
        {copy === undefined ? null : <Copy label={copy} value={value} />}
      </div>
    </div>
  );
}

function InfoSection({
  title,
  children,
}: {
  title: string;
  children: unknown;
}) {
  return (
    <div style="min-width:0">
      <div style={SECTION_TITLE}>{title}</div>
      <div style="display:grid; grid-template-columns:auto minmax(0, 1fr) auto; column-gap:12px; row-gap:8px; align-items:start">
        {children}
      </div>
    </div>
  );
}

/** The counting columns: no copy buttons, and the token column is compact. */
function CountSection({
  title,
  rows,
  compact,
}: {
  title: string;
  rows: [string, string][];
  /** The tokens column: values right-aligned against a max-content label. */
  compact?: boolean;
}) {
  return (
    <div style="min-width:0">
      <div style={SECTION_TITLE}>{title}</div>
      <div
        style={
          compact === true
            ? "display:grid; grid-template-columns:max-content minmax(0, 1fr); column-gap:14px; row-gap:4px; justify-content:start"
            : "display:grid; grid-template-columns:auto minmax(0, 1fr); column-gap:12px; row-gap:4px"
        }
      >
        {rows.map(([label, value]) => (
          <div style="display:contents">
            <div style={LABEL}>{label}</div>
            <div
              style={
                compact === true
                  ? "color:var(--text-muted); min-width:0; overflow-wrap:normal; text-align:right; white-space:normal"
                  : VALUE
              }
            >
              {value}
            </div>
          </div>
        ))}
      </div>
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
  const context = formatContextUsage(usage);
  const percent =
    usage.percent === null
      ? ""
      : `${usage.percent.toLocaleString("en", { maximumFractionDigits: 1 })}%`;
  const tokenRows: [string, string][] = [
    ["Input", count(tokens.input)],
    ["Output", count(tokens.output)],
    ...(tokens.cacheRead > 0
      ? ([["Cache Read", count(tokens.cacheRead)]] as [string, string][])
      : []),
    ...(tokens.cacheWrite > 0
      ? ([["Cache Write", count(tokens.cacheWrite)]] as [string, string][])
      : []),
    ["Total", count(tokens.total)],
    ...(usage.contextWindow === null || context === ""
      ? []
      : ([
          [
            "Context window",
            `${usage.tokens === null ? "?" : count(usage.tokens)} / ${count(usage.contextWindow)} tokens`,
          ],
          ["Context usage", percent],
        ] as [string, string][])),
    ...(stats.cacheHitRate === null
      ? []
      : ([
          ["Avg cache hit rate", `${(stats.cacheHitRate * 100).toFixed(1)}%`],
        ] as [string, string][])),
  ];
  return (
    <div class="session-info-popover menu-surface" style="padding:12px 16px">
      <div style="display:grid; grid-template-columns:minmax(360px, 1.7fr) minmax(140px, 0.55fr) minmax(190px, 0.75fr); gap:24px; font-size:12px; line-height:1.5; font-family:var(--font-mono)">
        <div style="display:flex; flex-direction:column; gap:20px">
          <InfoSection title="Session Info">
            {summary.name ? (
              <InfoRow label="Name" value={summary.name} />
            ) : null}
            <InfoRow
              label="Session File"
              value={summary.filePath ?? "In-memory"}
              copy="Copy file path"
            />
            <InfoRow label="ID" value={summary.id} copy="Copy session ID" />
            {stats.activeMs > 0 ? (
              <InfoRow label="Active Time" value={duration(stats.activeMs)} />
            ) : null}
          </InfoSection>
          <InfoSection title="Project Info">
            <InfoRow
              label="Project Dir"
              value={summary.projectRoot ?? summary.cwd}
              copy="Copy project directory"
            />
            {summary.branch ? (
              <InfoRow
                label="Git Branch"
                value={summary.branch}
                copy="Copy git branch"
              />
            ) : null}
            {summary.isWorktree === true ? (
              <InfoRow
                label="Worktree"
                value={summary.cwd}
                copy="Copy worktree path"
              />
            ) : null}
          </InfoSection>
        </div>
        <CountSection
          title="Messages"
          rows={[
            ["User", count(stats.userMessages)],
            ["Assistant", count(stats.assistantMessages)],
            ["Tool Calls", count(stats.toolCalls)],
            ["Tool Results", count(stats.toolResults)],
            ["Total", count(stats.totalMessages)],
          ]}
        />
        <CountSection title="Tokens" rows={tokenRows} compact />
      </div>
    </div>
  );
}
