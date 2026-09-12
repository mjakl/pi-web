import { renderMarkdown } from "@web/markdown";
import {
  CheckIcon,
  CopyIcon,
  EditFromHereIcon,
  ForkIcon,
  StarIcon,
} from "@web/views/icons";
import { raw } from "hono/html";

// pi-web's MessageView, SubagentToolCall, TurnWrittenFiles and the process
// disclosure of ChatWindow, rendered on the server. Every class name and
// inline style here is pi-web's own (components/MessageView.tsx, §4.3-§4.4 of
// the UI map), so src/web/styles/globals.css applies unchanged. Where pi-web
// expands a card from React state web-pi uses <details>, and the open-state
// rules that replaces live in styles/areas/transcript.css.
//
// What every item kind reuses: the actions a transcript may offer, Markdown,
// the copy button, times, images, and the history actions of pi-web's
// HistoryActionFrame.

/** What the transcript may do to the session it belongs to. */
export type ItemActions = {
  sessionId: string;
  /** Resolves relative file links in Markdown. */
  cwd: string;
  starred: Set<string>;
  /** Set while another branch is being viewed: nothing may be changed. */
  readOnly?: boolean;
  /** Entry ids whose message shows a time. */
  timestamps?: Set<string>;
  /** Inside the running turn: no actions, no diagram preview. */
  live?: boolean;
  /**
   * A turn is in flight. pi-web keeps the history row rendered and disables
   * only what the turn owns: branching waits, rewind is gone
   * (ChatWindow.tsx `branchDisabledReason` and `onRewind`).
   */
  busy?: boolean;
  /** The last line each running tool reported, by tool-call id. */
  progress?: Record<string, string>;
  /** Estimated tokens and speed of the message streaming right now. */
  streaming?: { tokens: number; tokensPerSecond: number | null };
};

/** pi-web's `formatTimestamp`: 24h, and the date once it is not today. */
export function formatTimestamp(value: string, now = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const time = date.toLocaleTimeString("en", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const today =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (today) return time;
  const day = date.toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
  return `${day} ${time}`;
}

/** pi-web's `formatDuration`, used by the subagent card. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) {
    return `${hours.toLocaleString("en")}h ${String(minutes)}m ${String(rest)}s`;
  }
  if (minutes > 0) return `${String(minutes)}m ${String(rest)}s`;
  return `${String(rest)}s`;
}

type MarkdownVariant =
  | "markdown-user-message"
  | "markdown-assistant-message"
  | "markdown-custom-message"
  | "markdown-compaction-message";

export function Markdown({
  source,
  actions,
  variant,
}: {
  source: string;
  actions?: ItemActions;
  variant?: MarkdownVariant;
}) {
  return (
    <div class={variant ? `markdown-body ${variant}` : "markdown-body"}>
      {raw(
        renderMarkdown(source, {
          ...(actions
            ? { cwd: actions.cwd, sessionId: actions.sessionId }
            : {}),
          ...(actions?.live ? { live: true } : {}),
        }),
      )}
    </div>
  );
}

/**
 * pi-web's copy button: 11px icon plus label, `--text-dim` until hover.
 * The text it copies rides in a hidden sibling, because a message can be
 * larger than an attribute should be.
 */
export function CopyButton({
  text,
  class: className = "message-copy",
  style = "display:flex; align-items:center; gap:4px; padding:3px 8px;" +
    " height:22px; background:none; border:none; border-radius:5px;" +
    " cursor:pointer; font-size:11px; font-weight:400; white-space:nowrap;" +
    " transition:opacity 0.12s, color 0.12s",
  bare,
}: {
  text: string;
  class?: string;
  style?: string;
  /** The extension card's footer copies with a word, not an icon (§4.6). */
  bare?: boolean;
}) {
  if (text === "") return <></>;
  return (
    <>
      <span hidden data-copy-source>
        {text}
      </span>
      <button
        type="button"
        class={className}
        style={style}
        data-copy
        title="Copy message"
      >
        {bare === true ? (
          "Copy"
        ) : (
          <>
            <span
              data-copy-idle
              style="display:flex; align-items:center; gap:4px"
            >
              <CopyIcon size={11} width={1.8} />
              Copy
            </span>
            <span
              data-copy-done
              style="display:none; align-items:center; gap:4px"
            >
              <CheckIcon size={11} width={1.8} />
              Copied
            </span>
          </>
        )}
      </button>
    </>
  );
}

export function Time({ value, style }: { value: string; style: string }) {
  const text = formatTimestamp(value);
  if (text === "") return <></>;
  return <span style={style}>{text}</span>;
}

function imageUrl(
  actions: ItemActions,
  entryId: string,
  index: number,
): string {
  return `/sessions/${actions.sessionId}/entries/${entryId}/image/${String(index)}`;
}

const THUMB_IMAGE =
  "max-width:240px; max-height:240px; border-radius:6px;" +
  " object-fit:contain; display:block";
const FULL_IMAGE =
  "display:block; max-width:min(100%, 720px); max-height:520px;" +
  " border-radius:6px; object-fit:contain; border:1px solid var(--border)";

export function Images({
  entryId,
  indices,
  actions,
  size,
  border = "1px solid rgba(59,130,246,0.15)",
  gap = 6,
  marginBottom = 0,
}: {
  entryId: string;
  indices: number[];
  actions?: ItemActions;
  size: "thumb" | "full";
  border?: string;
  gap?: number;
  marginBottom?: number;
}) {
  if (!actions || indices.length === 0) return <></>;
  return (
    <div
      style={`display:flex; gap:${String(gap)}px; flex-wrap:wrap; margin-bottom:${String(marginBottom)}px`}
    >
      {indices.map((index) => (
        // pi-web opens a transcript image in a modal over the app, never in a
        // tab of its own (components/ImagePreview.tsx).
        <button
          type="button"
          data-image-preview={imageUrl(actions, entryId, index)}
          aria-haspopup="dialog"
          aria-expanded="false"
          title="Preview image"
          aria-label="Preview image"
          style="display:block; padding:0; border:none; background:none; color:inherit; cursor:zoom-in"
        >
          <img
            style={
              size === "thumb" ? `${THUMB_IMAGE}; border:${border}` : FULL_IMAGE
            }
            alt=""
            loading="lazy"
            src={imageUrl(actions, entryId, index)}
          />
        </button>
      ))}
    </div>
  );
}

/** pi-web's two history actions: continue here, or copy the history away. */
export function HistoryActionButtons({
  entryId,
  actions,
}: {
  entryId: string;
  actions: ItemActions;
}) {
  const post = (path: string) => `/sessions/${actions.sessionId}/${path}`;
  const swap = {
    "hx-vals": JSON.stringify({ entryId }),
    "hx-target": "body",
    "hx-swap": "innerHTML",
    "hx-indicator": "#branch-sync",
  };
  const branchTitle =
    actions.busy === true
      ? "Wait for the current operation to finish before branching"
      : "New branch — continue from this point within the current session";
  return (
    <>
      <span title={branchTitle}>
        <button
          type="button"
          class="history-action"
          aria-label="New branch"
          title={branchTitle}
          hx-post={post("navigate")}
          {...swap}
          {...(actions.busy === true ? { disabled: true } : {})}
        >
          <EditFromHereIcon />
          New branch
        </button>
      </span>
      <button
        type="button"
        class="history-action"
        title="New session — copy history to this point into a separate session"
        hx-post={post("fork")}
        {...swap}
      >
        <ForkIcon />
        New session
      </button>
    </>
  );
}

/** pi-web's `HistoryActionFrame`: the actions appear on hovering the host. */
export function HistoryActionFrame({
  entryId,
  actions,
  children,
  copyText,
}: {
  entryId: string;
  actions?: ItemActions;
  children?: unknown;
  copyText?: string;
}) {
  if (!actions || actions.readOnly || actions.live) return <>{children}</>;
  return (
    <div class="history-action-host">
      {children}
      <div class="history-actions">
        {copyText === undefined ? null : <CopyButton text={copyText} />}
        <HistoryActionButtons entryId={entryId} actions={actions} />
      </div>
    </div>
  );
}

export function StarButton({
  entryId,
  actions,
}: {
  entryId: string;
  actions: ItemActions;
}) {
  const starred = actions.starred.has(entryId);
  const label = starred ? "Unstar answer" : "Star answer";
  return (
    <button
      type="button"
      class="answer-star-toggle"
      aria-pressed={starred ? "true" : "false"}
      aria-label={label}
      title={label}
      hx-post={`/sessions/${actions.sessionId}/star`}
      hx-vals={JSON.stringify({ entryId, starred: !starred })}
      hx-target="this"
      hx-swap="outerHTML"
    >
      <StarIcon filled={starred} />
    </button>
  );
}
