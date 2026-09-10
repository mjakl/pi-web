import { formatTokens } from "@core/context-usage";
import type { LiveStatus, ModelOption } from "@core/ports";
import type { SessionView } from "@core/workspace";

const LEVEL_CLASS = {
  unknown: "badge-ghost",
  ok: "badge-ghost",
  warn: "badge-warning",
  critical: "badge-error",
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
      class={`badge ${LEVEL_CLASS[level]} badge-sm`}
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

/** Providers keep their first-appearance order; headers only when there are two. */
function ModelSelect({
  models,
  current,
}: {
  models: ModelOption[];
  current: ModelOption | null;
}) {
  const providers = [...new Set(models.map((model) => model.provider))];
  const option = (model: ModelOption) => (
    <option
      value={`${model.provider}/${model.id}`}
      selected={current?.provider === model.provider && current.id === model.id}
    >
      {model.name}
    </option>
  );
  return (
    <select
      name="model"
      class="select max-w-48 select-xs"
      aria-label="Model"
      title={`${String(models.length)} models. Type to search.`}
    >
      {providers.length > 1
        ? providers.map((provider) => (
            <optgroup label={provider}>
              {models
                .filter((model) => model.provider === provider)
                .map(option)}
            </optgroup>
          ))
        : models.map(option)}
    </select>
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
    <div class="flex w-full flex-col gap-1 rounded-box bg-base-200 p-2 text-xs">
      <div class="flex items-center gap-2">
        <span class="font-semibold">Queued · {String(queue.length)}</span>
        <span class="flex-1" />
        <button
          class="btn btn-ghost btn-xs"
          title="Take the queued messages back into the composer"
          hx-post={`/sessions/${sessionId}/queue/recall`}
          hx-target="#composer-text"
          hx-swap="outerHTML"
        >
          Recall
        </button>
        <button
          class="btn btn-ghost btn-xs"
          hx-post={`/sessions/${sessionId}/queue/clear`}
          hx-swap="none"
        >
          Clear
        </button>
      </div>
      {queue.map((message) => (
        <div class="flex items-center gap-2">
          <span
            class={`badge badge-xs ${message.behavior === "steer" ? "badge-accent" : "badge-ghost"}`}
          >
            {message.behavior === "steer" ? "steer" : "follow-up"}
          </span>
          <span class="truncate" title={message.text}>
            {message.text}
          </span>
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
      class="btn btn-outline btn-xs"
      aria-label="Stop compacting"
      hx-post={`/sessions/${sessionId}/compact/abort`}
      hx-swap="none"
    >
      ◼ compacting
    </button>
  ) : (
    <button
      class={`btn btn-xs ${warning ? "btn-warning" : "btn-ghost"}`}
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
      class="flex flex-wrap items-center gap-2 text-sm"
      {...(status?.running ? { "data-running": "true" } : {})}
      {...(status?.bashRunning ? { "data-bash-running": "true" } : {})}
    >
      {status ? (
        <form
          hx-post={`/sessions/${summary.id}/model`}
          hx-trigger="change"
          hx-swap="none"
          class="flex items-center gap-1"
        >
          <ModelSelect models={view.models} current={current} />
          {current?.reasoning ? (
            <select
              name="thinking"
              class="select select-xs"
              aria-label="Reasoning"
            >
              {status.thinkingLevels.map((choice) => (
                <option
                  value={choice.level}
                  selected={choice.level === status.thinkingLevel}
                >
                  {choice.label}
                </option>
              ))}
            </select>
          ) : null}
        </form>
      ) : (
        <span class="text-base-content/60">not running</span>
      )}
      <ContextBadge usage={view.usage} />
      {status ? (
        <CompactButton
          sessionId={summary.id}
          status={status}
          level={view.usage.level}
        />
      ) : null}
      {status?.running || status?.bashRunning ? (
        <>
          <span
            class="loading loading-xs loading-dots"
            aria-label="Working"
          ></span>
          <button
            class="btn btn-outline btn-xs"
            hx-post={`/sessions/${summary.id}/abort`}
            hx-swap="none"
          >
            Stop
          </button>
        </>
      ) : null}
      {status
        ? Object.entries(status.statuses).map(([key, text]) => (
            <span class="badge badge-ghost badge-sm" title={key}>
              {text}
            </span>
          ))
        : null}
      {view.modelWarnings.length > 0 ? (
        <div class="alert w-full py-1 text-xs alert-warning" role="alert">
          {view.modelWarnings.join("\n")}
        </div>
      ) : null}
      {status?.compaction ? (
        <div class="alert w-full py-1 text-xs alert-success">
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
