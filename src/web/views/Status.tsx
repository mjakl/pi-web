import { formatTokens } from "@core/context-usage";
import type { LiveStatus } from "@core/ports";
import type { SessionView } from "@core/workspace";
import { ModelPicker } from "./Composer.tsx";

/** pi-web colours the context readout by threshold, not by badge (§C5). */
const LEVEL_COLOUR = {
  unknown: "var(--text-dim)",
  ok: "var(--text-muted)",
  warn: "rgba(234,179,8,0.95)",
  critical: "var(--danger)",
} as const;

/** The one rendering of context usage. */
export function ContextBadge({ usage }: { usage: SessionView["usage"] }) {
  const { tokens, contextWindow, percent, level, estimated } = usage;
  const text =
    tokens === null
      ? "context unknown"
      : contextWindow === null
        ? `${formatTokens(tokens)} tokens`
        : `${formatTokens(tokens)} / ${formatTokens(contextWindow)} (${String(Math.round(percent ?? 0))}%)`;
  return (
    <span
      style={`color:${LEVEL_COLOUR[level]}`}
      title={
        estimated
          ? "Estimated from the last reported usage"
          : "Reported by the model"
      }
    >
      {estimated ? "~" : ""}
      {text}
    </span>
  );
}

function QueuePanel({
  sessionId,
  queue,
}: {
  sessionId: string;
  queue: LiveStatus["queue"];
}) {
  if (queue.length === 0) return <></>;
  return (
    <div>
      <div>
        <span>Queued · {String(queue.length)}</span>
        <span />
        <button
          title="Take the queued messages back into the composer"
          hx-post={`/sessions/${sessionId}/queue/recall`}
          hx-target="#composer-text"
          hx-swap="outerHTML"
        >
          Recall
        </button>
        <button hx-post={`/sessions/${sessionId}/queue/clear`} hx-swap="none">
          Clear
        </button>
      </div>
      {queue.map((message) => (
        <div>
          <span
            style={`flex-shrink:0; font-size:10px; font-family:var(--font-mono); padding:1px 7px; border-radius:999px; border:1px solid ${message.behavior === "steer" ? "color-mix(in srgb, var(--accent) 45%, transparent)" : "var(--border)"}; color:var(${message.behavior === "steer" ? "--accent" : "--text-dim"})`}
          >
            {message.behavior === "steer" ? "steer" : "follow-up"}
          </span>
          <span title={message.text}>{message.text}</span>
        </div>
      ))}
    </div>
  );
}

function CompactButton({
  sessionId,
  status,
  level,
}: {
  sessionId: string;
  status: LiveStatus;
  level: SessionView["usage"]["level"];
}) {
  const warning = level === "warn" || level === "critical";
  return status.compacting ? (
    <button
      class="context-compact-button"
      data-compacting="true"
      aria-label="Stop compacting"
      hx-post={`/sessions/${sessionId}/compact/abort`}
      hx-swap="none"
    >
      ◼ compacting
    </button>
  ) : (
    <button
      class="context-compact-button"
      {...(warning ? { "data-warning": "true" } : {})}
      title="Summarise the conversation so far to free context"
      hx-post={`/sessions/${sessionId}/compact`}
      hx-swap="none"
      disabled={status.running}
    >
      Compact
    </button>
  );
}

/** Everything that changes while a session runs: model, state, context. */
export function Status({ view }: { view: SessionView }) {
  const { status, summary } = view;
  const current = status?.model ?? null;
  return (
    <div
      {...(status?.running ? { "data-running": "true" } : {})}
      {...(status?.bashRunning ? { "data-bash-running": "true" } : {})}
    >
      {status ? (
        <form
          hx-post={`/sessions/${summary.id}/model`}
          hx-trigger="change"
          hx-swap="none"
        >
          <ModelPicker
            models={view.models}
            current={current}
            levels={status.thinkingLevels}
            level={status.thinkingLevel}
          />
        </form>
      ) : (
        <span>not running</span>
      )}
      <ContextBadge usage={view.usage} />
      {status?.title ? (
        // An extension named this session's page; the client copies it into
        // the browser tab, where `setTitle` puts it in a terminal.
        <span
          id="extension-title"

          data-title={status.title}
        >
          {status.title}
        </span>
      ) : null}
      {status ? (
        <CompactButton
          sessionId={summary.id}
          status={status}
          level={view.usage.level}
        />
      ) : null}
      {status?.running || status?.bashRunning ? (
        <>
          <span aria-label="Working"></span>
          <button hx-post={`/sessions/${summary.id}/abort`} hx-swap="none">
            Stop
          </button>
        </>
      ) : null}
      {view.modelWarnings.length > 0 ? (
        <div role="alert">{view.modelWarnings.join("\n")}</div>
      ) : null}
      {status?.retry ? (
        <div role="status">
          Retrying ({String(status.retry.attempt)}/
          {String(status.retry.maxAttempts)})…
          <span>{status.retry.message}</span>
        </div>
      ) : null}
      {status?.compactionError ? (
        <div role="alert">{status.compactionError}</div>
      ) : null}
      {status?.compaction ? (
        <div>
          {status.compaction.reason === "manual"
            ? "Compacted"
            : status.compaction.reason}{" "}
          {formatTokens(status.compaction.tokensBefore)} →{" "}
          {status.compaction.tokensAfter === null
            ? "?"
            : formatTokens(status.compaction.tokensAfter)}{" "}
          tokens
        </div>
      ) : null}
      {status ? (
        <QueuePanel sessionId={summary.id} queue={status.queue} />
      ) : null}
    </div>
  );
}
