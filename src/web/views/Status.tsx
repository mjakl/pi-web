import { formatTokens } from "@core/context-usage";
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

/** Everything that changes while a session runs: model, state, context. */
export function Status({ view }: { view: SessionView }) {
  const { status, summary } = view;
  const current = status?.model;
  return (
    <div class="flex flex-wrap items-center gap-2 text-sm">
      {status ? (
        <form
          hx-post={`/sessions/${summary.id}/model`}
          hx-trigger="change"
          hx-swap="none"
          class="flex items-center gap-1"
        >
          <select name="model" class="select select-xs" aria-label="Model">
            {view.models.map((model) => (
              <option
                value={`${model.provider}/${model.id}`}
                selected={
                  current?.provider === model.provider &&
                  current.id === model.id
                }
              >
                {model.name}
              </option>
            ))}
          </select>
          {current?.reasoning ? (
            <select
              name="thinking"
              class="select select-xs"
              aria-label="Reasoning"
            >
              {status.thinkingLevels.map((level) => (
                <option value={level} selected={level === status.thinkingLevel}>
                  {level}
                </option>
              ))}
            </select>
          ) : null}
        </form>
      ) : (
        <span class="text-base-content/60">not running</span>
      )}
      <ContextBadge usage={view.usage} />
      {status?.running ? (
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
      {status?.compacting ? (
        <span class="badge badge-sm badge-warning">compacting</span>
      ) : null}
      {status && status.queued > 0 ? (
        <span class="badge badge-ghost badge-sm">
          {String(status.queued)} queued
        </span>
      ) : null}
      {status
        ? Object.entries(status.statuses).map(([key, text]) => (
            <span class="badge badge-ghost badge-sm" title={key}>
              {text}
            </span>
          ))
        : null}
      {status?.notices.map((notice) => (
        <span
          class={`badge badge-sm ${notice.level === "error" ? "badge-error" : notice.level === "warning" ? "badge-warning" : "badge-info"}`}
        >
          {notice.message}
        </span>
      ))}
    </div>
  );
}
