import { formatCompactCount, formatContextUsage } from "@core/context-usage";
import type { ContextUsage } from "@core/context-usage";
import type { LiveStatus } from "@core/ports";
import type { SessionView } from "@core/workspace";
import { ModelSelector, ModelScopeWarning, modelPick } from "./Composer.tsx";
import {
  CheckIcon,
  ContextGaugeIcon,
  RecallQueueIcon,
  RefreshIcon,
} from "./icons.tsx";

// Everything about a running session that is not the transcript: the banners
// and the queue panel above the composer surface (pi-web keeps them inside
// ChatInput's 820px column, §6.1), plus the two things elsewhere on the page
// that the same render owns — the model selector in the toolbar and the
// context readout in the top bar, both swapped out of band.

/**
 * The context gauge the top bar shows; red, amber or plain by threshold. It
 * lives here because this render owns it: tokens move while a turn runs, and
 * pi-web has no status row left to show them in, so the stream re-renders it
 * in place (`oob`) wherever the shell put it.
 */
export function ContextReadout({
  usage,
  oob,
  empty,
}: {
  usage?: ContextUsage;
  oob?: boolean;
  /**
   * Nothing else in the stats button has a value, so the readout names what
   * the button opens. False keeps the element (the stream swaps it by id)
   * but silent, because the token groups beside it already say something.
   */
  empty?: boolean;
}) {
  const text = usage ? formatContextUsage(usage) : "";
  const swap = oob === true ? { "hx-swap-oob": "true" } : {};
  if (!usage || text === "") {
    return empty === false ? (
      <span id="context-readout" hidden {...swap} />
    ) : (
      <span
        id="context-readout"
        style="overflow:hidden; text-overflow:ellipsis; color:var(--text-dim)"
        {...swap}
      >
        Session info
      </span>
    );
  }
  const colour =
    usage.level === "critical"
      ? "var(--danger)"
      : usage.level === "warn"
        ? "rgba(234,179,8,0.95)"
        : "var(--text-muted)";
  return (
    <span
      id="context-readout"
      class="mobile-session-context"
      style={`display:flex; align-items:center; gap:4px; color:${colour}`}
      data-context-readout
      {...swap}
    >
      <ContextGaugeIcon />
      {text}
    </span>
  );
}

/** One queued message: the kind as a pill, then the text (§6.1). */
function QueuedRow({
  behavior,
  text,
}: {
  behavior: "steer" | "followUp";
  text: string;
}) {
  const steer = behavior === "steer";
  return (
    <div
      title={text}
      style="display:flex; align-items:center; gap:8px; padding:3px 10px; font-size:12px; color:var(--text-muted); min-width:0"
    >
      <span
        style={`flex-shrink:0; font-size:10px; font-family:var(--font-mono); padding:1px 7px; border-radius:999px; border:1px solid ${steer ? "color-mix(in srgb, var(--accent) 45%, transparent)" : "var(--border)"}; color:var(${steer ? "--accent" : "--text-dim"})`}
      >
        {steer ? "steer" : "follow-up"}
      </span>
      <span style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">
        {text}
      </span>
    </div>
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
    <div style="margin-bottom:8px; border:1px solid var(--border); border-radius:6px; background:var(--bg-panel); padding:5px 0">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:2px 8px 4px 10px">
        <span style="font-size:10px; font-family:var(--font-mono); color:var(--text-dim); text-transform:uppercase; letter-spacing:0.4px">
          Queued · {String(queue.length)}
        </span>
        <button
          type="button"
          class="composer-queue-recall"
          title="Remove all queued messages and put them back into the input box for editing"
          style="display:flex; align-items:center; gap:6px; padding:4px 12px; font-size:12px; color:var(--text); background:transparent; border:1px solid var(--border); border-radius:7px; cursor:pointer; transition:background 0.12s, border-color 0.12s; white-space:nowrap"
          hx-post={`/sessions/${sessionId}/queue/recall`}
          // The button sits inside the composer form; without this htmx would
          // post the draft and its attachments with the recall.
          hx-params="none"
          hx-target="#composer-text"
          hx-swap="outerHTML"
        >
          <RecallQueueIcon />
          Recall to input
        </button>
      </div>
      {queue.map((message) => (
        <QueuedRow behavior={message.behavior} text={message.text} />
      ))}
    </div>
  );
}

/** "Compacted 40k -> 12k tokens (28k saved)", as pi-web words it. */
function compactionText(compaction: NonNullable<LiveStatus["compaction"]>) {
  const { reason, tokensBefore, tokensAfter } = compaction;
  const label =
    reason === "manual"
      ? "Compacted"
      : `${reason.charAt(0).toUpperCase()}${reason.slice(1)}`;
  const after = tokensAfter ?? tokensBefore;
  const saved = Math.max(0, tokensBefore - after);
  return `${label} ${formatCompactCount(tokensBefore)} -> ${formatCompactCount(after)} tokens (${formatCompactCount(saved)} saved)`;
}

/**
 * Everything that changes while a session runs. `model` asks for the toolbar's
 * selector out of band, which the stream sends only when the model or the
 * levels actually changed: it is a whole subtree, and a turn re-renders ten
 * times a second.
 */
export function Status({
  view,
  model,
  oob,
}: {
  view: SessionView;
  model?: boolean;
  oob?: boolean;
}) {
  const { status, summary } = view;
  return (
    <>
      <ModelScopeWarning warnings={view.modelWarnings} />
      {status ? (
        <QueuePanel sessionId={summary.id} queue={status.queue} />
      ) : null}
      {status?.retry ? (
        <div style="margin-bottom:8px; padding:5px 10px; background:rgba(234,179,8,0.08); border:1px solid rgba(234,179,8,0.25); border-radius:6px; font-size:12px; color:rgba(180,130,0,0.9); display:flex; align-items:center; gap:6px">
          <RefreshIcon size={11} width={2} />
          Retrying ({String(status.retry.attempt)}/
          {String(status.retry.maxAttempts)})…
          {status.retry.message ? (
            <span style="opacity:0.7; margin-left:4px">
              — {status.retry.message}
            </span>
          ) : null}
        </div>
      ) : null}
      {status?.compaction ? (
        <div style="margin-bottom:8px; padding:5px 10px; background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.24); border-radius:6px; font-size:12px; color:rgba(5,150,105,0.95); display:flex; align-items:center; gap:6px">
          <CheckIcon size={11} width={2} />
          {compactionText(status.compaction)}
        </div>
      ) : null}
      {status?.compactionError ? (
        <div
          role="alert"
          style="margin-bottom:8px; padding:7px 10px; background:rgba(239,68,68,0.07); border:1px solid rgba(239,68,68,0.3); border-radius:6px; color:var(--danger); font-family:var(--font-mono); font-size:12px; line-height:1.5; white-space:pre-wrap; overflow-wrap:anywhere"
        >
          {status.compactionError}
        </div>
      ) : null}
      {/* No visual: the client mirrors the running state onto the composer,
          and copies an extension's title into the browser tab. */}
      <span
        id="session-state"
        hidden
        {...(status?.running ? { "data-running": "true" } : {})}
        {...(status?.bashRunning ? { "data-bash-running": "true" } : {})}
        {...(status?.compacting ? { "data-compacting": "true" } : {})}
      />
      {status?.title ? (
        <span id="extension-title" hidden data-title={status.title} />
      ) : null}
      {oob === true ? <ContextReadout usage={view.usage} oob /> : null}
      {oob === true && model === true ? (
        <ModelSelector pick={modelPick(view)} oob />
      ) : null}
    </>
  );
}
