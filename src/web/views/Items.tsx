import { formatCompactCount } from "@core/context-usage";
import {
  type DiffCell,
  type DiffFile,
  parseUnifiedPatch,
  patchLines,
} from "@core/patch";
import type {
  AssistantBlock,
  AssistantItem,
  BashItem,
  CompactionItem,
  NoteItem,
  SubagentCall,
  SubagentRun,
  SubagentView,
  ToolCallView,
  TranscriptItem,
  UserItem,
} from "@core/transcript";
import type { LiveStatus } from "@core/ports";
import {
  activityLabel,
  groupTurns,
  isEditToolName,
  timestampedEntries,
  toolFilePath,
  type Turn,
} from "@core/turns";
import { renderMarkdown } from "@web/markdown";
import { raw } from "hono/html";
import {
  CardChevronIcon,
  CheckIcon,
  CompactIcon,
  CopyIcon,
  EditFromHereIcon,
  ExpandChevronIcon,
  FileIcon,
  ForkIcon,
  ProcessChevronIcon,
  RewindIcon,
  StarIcon,
  TokenArrowIcon,
} from "./icons.tsx";

// pi-web's MessageView, SubagentToolCall, TurnWrittenFiles and the process
// disclosure of ChatWindow, rendered on the server. Every class name and
// inline style here is pi-web's own (components/MessageView.tsx, §4.3-§4.4 of
// the UI map), so src/web/styles/globals.css applies unchanged. Where pi-web
// expands a card from React state web-pi uses <details>, and the open-state
// rules that replaces live in styles/areas/transcript.css.

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
function formatTimestamp(value: string, now = new Date()): string {
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
function formatDuration(seconds: number): string {
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

function Markdown({
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
function CopyButton({
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

function Time({ value, style }: { value: string; style: string }) {
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

function Images({
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
function HistoryActionButtons({
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
function HistoryActionFrame({
  entryId,
  actions,
  children,
}: {
  entryId: string;
  actions?: ItemActions;
  children?: unknown;
}) {
  if (!actions || actions.readOnly || actions.live) return <>{children}</>;
  return (
    <div class="history-action-host">
      {children}
      <div class="history-actions">
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

function UserMessage({
  item,
  actions,
}: {
  item: UserItem;
  actions?: ItemActions;
}) {
  const editable = actions && !actions.readOnly && !actions.live;
  const images = (
    <Images
      entryId={item.entryId}
      indices={item.images}
      actions={actions}
      size="thumb"
      marginBottom={item.text === "" ? 0 : 8}
    />
  );
  const command = item.command;
  const space = command === undefined ? -1 : command.search(/\s/);
  const name =
    command === undefined
      ? ""
      : space === -1
        ? command
        : command.slice(0, space);
  const args =
    command !== undefined && space !== -1 ? command.slice(space + 1) : "";
  return (
    <div
      class="message-row"
      id={`entry-${item.entryId}`}
      data-role="user"
      style="margin-bottom:16px; display:flex; flex-direction:column; align-items:flex-end"
    >
      <div class="user-message-band">
        <div class="user-message-band-content">
          <div style="min-width:0; max-width:85%; padding:14px 0; display:flex; flex-direction:column; font-size:14px; line-height:1.6; color:var(--text); word-break:break-word">
            <div style="margin-right:4px; padding:0 8px 0 12px">
              {command === undefined ? (
                <>
                  {images}
                  {/* `data-user-text` is what the composer's ArrowUp reads. */}
                  <div data-user-text hidden>
                    {item.text}
                  </div>
                  <Markdown
                    source={item.text}
                    actions={actions}
                    variant="markdown-user-message"
                  />
                </>
              ) : (
                <details
                  class="transcript-details"
                  style="display:flex; flex-direction:column; gap:6px; min-width:0"
                >
                  <summary style="display:flex; align-items:flex-start; gap:8px; flex-wrap:wrap">
                    <span hidden data-user-text>
                      {command}
                    </span>
                    <span style="display:flex; align-items:center; gap:6px; flex-shrink:0; color:var(--accent); font-family:var(--font-mono); font-size:13px; text-align:left">
                      <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">
                        {name}
                      </span>
                      <span
                        class="card-chevron"
                        style="display:flex; flex-shrink:0; opacity:0.75; transition:transform 0.15s"
                      >
                        <ExpandChevronIcon />
                      </span>
                    </span>
                    {args === "" ? null : (
                      <span style="color:var(--text); font-size:14px; line-height:1.6; white-space:pre-wrap; word-break:break-word; min-width:0; flex:1">
                        {args}
                      </span>
                    )}
                  </summary>
                  {images}
                  <Markdown
                    source={item.text}
                    actions={actions}
                    variant="markdown-user-message"
                  />
                </details>
              )}
            </div>
          </div>
        </div>
      </div>
      <div style="display:flex; align-items:center; justify-content:flex-end; gap:6px; margin-top:3px; flex-wrap:wrap">
        <div class="message-actions" style="display:flex; gap:3px">
          <CopyButton text={item.command ?? item.text} />
        </div>
        {editable && actions ? (
          <div
            class="message-actions"
            style="display:flex; gap:3px; flex-wrap:wrap; justify-content:flex-end"
          >
            {actions.busy === true ? null : (
              <button
                type="button"
                class="message-rewind"
                title="Rewind — remove this message and later history, then edit it again"
                hx-post={`/sessions/${actions.sessionId}/rewind`}
                hx-vals={JSON.stringify({ entryId: item.entryId })}
                hx-confirm="Remove this message and all later history?"
                hx-target="body"
                hx-swap="innerHTML"
              >
                <RewindIcon />
                Rewind
              </button>
            )}
            <HistoryActionButtons entryId={item.entryId} actions={actions} />
          </div>
        ) : null}
        <Time
          value={item.timestamp}
          style="font-size:10px; color:var(--text-dim)"
        />
      </div>
    </div>
  );
}

function ThinkingBlock({
  item,
  block,
  actions,
}: {
  item: AssistantItem;
  block: Extract<AssistantBlock, { kind: "thinking" }>;
  actions?: ItemActions;
}) {
  const fetchUrl =
    block.deferred && actions
      ? `/sessions/${actions.sessionId}/entries/${item.entryId}/thinking/${String(block.index)}`
      : undefined;
  return (
    <details
      class="transcript-details"
      style="border:1px solid var(--border); border-radius:6px; overflow:hidden; font-size:13px"
    >
      <summary style="display:flex; align-items:center; gap:6px; width:100%; padding:6px 10px; background:var(--bg-panel); color:var(--text-muted); cursor:pointer; font-size:12px; text-align:left">
        <span>Thinking</span>
        {block.seconds === undefined ? null : (
          <span style="margin-left:auto; font-size:11px; color:var(--text-dim); font-variant-numeric:tabular-nums">
            {String(block.seconds)}s
          </span>
        )}
        <span
          class="card-chevron"
          style={`display:flex; flex-shrink:0; transition:transform 0.15s${block.seconds === undefined ? "; margin-left:auto" : ""}`}
        >
          <CardChevronIcon />
        </span>
      </summary>
      <div style="padding:8px 10px; color:var(--text-muted); font-size:12px; line-height:1.6; background:var(--bg-panel); border-top:1px solid var(--border)">
        {fetchUrl === undefined ? (
          <Markdown
            source={block.text}
            actions={actions}
            variant="markdown-assistant-message"
          />
        ) : (
          <div
            hx-get={fetchUrl}
            hx-trigger="toggle once from:closest details"
            hx-swap="outerHTML"
          >
            Loading thinking...
          </div>
        )}
      </div>
    </details>
  );
}

const DIFF_CELL_BACKGROUND = {
  added: "rgba(34,197,94,0.12)",
  removed: "rgba(248,113,113,0.13)",
  context: "transparent",
  empty: "var(--bg-subtle)",
} as const;

function DiffCellView({ cell, left }: { cell: DiffCell; left: boolean }) {
  const border = left ? "; border-right:1px solid var(--border)" : "";
  const marker =
    cell.type === "added" ? "+" : cell.type === "removed" ? "-" : " ";
  return (
    <div
      style={`display:flex; min-width:0; background:${DIFF_CELL_BACKGROUND[cell.type]}${border}`}
    >
      <span style="width:42px; padding:0 6px; text-align:right; color:var(--text-dim); user-select:none; background:var(--bg-panel); border-right:1px solid var(--border); flex-shrink:0">
        {cell.lineNo === null ? "" : String(cell.lineNo)}
      </span>
      <span
        style={`width:18px; padding:0 5px; user-select:none; flex-shrink:0; font-weight:${
          cell.type === "context" || cell.type === "empty" ? "400" : "700"
        }; color:var(${
          cell.type === "added"
            ? "--success"
            : cell.type === "removed"
              ? "--danger"
              : "--text-dim"
        })`}
      >
        {marker}
      </span>
      <span
        style={`flex:1; min-width:0; padding:0 10px 0 0; white-space:pre-wrap; overflow-wrap:anywhere; color:var(${
          cell.type === "empty" ? "--text-dim" : "--text"
        })`}
      >
        {cell.type === "empty" && cell.text === "" ? " " : cell.text}
      </span>
    </div>
  );
}

/** pi-web's `SplitPatchView`: two gutters, one row per changed line. */
function SplitDiff({ files }: { files: DiffFile[] }) {
  return (
    <div style="max-height:560px; overflow-y:auto; overflow-x:hidden; background:var(--bg)">
      {files.map((file, index) => (
        <div
          style={`min-width:0; font-family:var(--font-mono); font-size:12px; line-height:1.55${
            index === 0 ? "" : "; border-top:1px solid var(--border)"
          }`}
        >
          {files.length > 1 ? (
            <div style="display:grid; grid-template-columns:minmax(0, 1fr) minmax(0, 1fr); position:sticky; top:0; z-index:1; background:var(--bg-panel); border-bottom:1px solid var(--border)">
              <div
                title={file.oldPath ?? "Before"}
                style="padding:5px 10px; color:var(--text-dim); border-right:1px solid var(--border); overflow:hidden; text-overflow:ellipsis; white-space:nowrap"
              >
                {file.oldPath ?? "Before"}
              </div>
              <div
                title={file.newPath ?? "After"}
                style="padding:5px 10px; color:var(--text-dim); overflow:hidden; text-overflow:ellipsis; white-space:nowrap"
              >
                {file.newPath ?? "After"}
              </div>
            </div>
          ) : null}
          <div style="display:grid; grid-template-columns:minmax(0, 1fr) minmax(0, 1fr)">
            {file.rows.map((row) =>
              row.type === "hunk" ? null : (
                <div style="display:contents">
                  <DiffCellView cell={row.left} left />
                  <DiffCellView cell={row.right} left={false} />
                </div>
              ),
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

const PATCH_LINE_STYLE = {
  added: "border-left-color:var(--success); background:rgba(34,197,94,0.12)",
  removed: "border-left-color:var(--danger); background:rgba(248,113,113,0.13)",
  hunk: "border-left-color:var(--accent); background:rgba(96,165,250,0.12)",
  context: "border-left-color:transparent",
} as const;

/** Fallback when the patch does not parse: the text, lightly classified. */
function PatchText({ patch }: { patch: string }) {
  return (
    <div style="max-height:520px; overflow-y:auto; overflow-x:hidden; font-family:var(--font-mono); font-size:12px; line-height:1.55; min-width:0">
      {patchLines(patch).map((line) => (
        <div
          style={`display:flex; border-left:3px solid; ${PATCH_LINE_STYLE[line.type]}`}
        >
          <span style="width:48px; padding:0 8px; color:var(--text-dim); background:var(--bg-panel); border-right:1px solid var(--border); text-align:right; user-select:none; flex-shrink:0">
            {String(line.lineNo)}
          </span>
          <span style="padding:0 10px; white-space:pre-wrap; overflow-wrap:anywhere; color:var(--text)">
            {line.text}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Past this a tool result is cut, with a button that fetches the whole. */
const MAX_RESULT_CHARS = 16 * 1024;
const MAX_DIFF_ROWS = 200;

function ShowAll({ url }: { url: string }) {
  return (
    <div style="padding:4px 10px; font-size:11px; margin-top:-1px">
      <button
        type="button"
        style="background:none; border:none; color:var(--accent); cursor:pointer; font-size:11px; padding:0; text-decoration:underline"
        hx-get={url}
        hx-target="closest .tool-result"
        hx-swap="outerHTML"
      >
        view full output
      </button>
    </div>
  );
}

/** Keeps whole files, up to the row budget: half a file reads as a bug. */
function trimDiff(
  files: DiffFile[],
  budget: number,
): { files: DiffFile[]; cut: number } {
  const kept: DiffFile[] = [];
  let rows = 0;
  let cut = 0;
  for (const file of files) {
    const lines = file.rows.filter((row) => row.type === "line").length;
    if (rows > 0 && rows + lines > budget) {
      cut += lines;
      continue;
    }
    if (rows + lines > budget) {
      const partial: typeof file.rows = [];
      let taken = 0;
      for (const row of file.rows) {
        if (row.type === "line" && taken >= budget) break;
        if (row.type === "line") taken += 1;
        partial.push(row);
      }
      kept.push({ ...file, rows: partial });
      cut += lines - taken;
      rows = budget;
      continue;
    }
    kept.push(file);
    rows += lines;
  }
  return { files: kept, cut };
}

/** The diff rows of a patch, capped; `cut` counts what did not fit. */
function trimmedDiff(
  patch: string,
  budget: number,
): { node: unknown; cut: number } {
  const files = parseUnifiedPatch(patch);
  if (files === null) return { node: <PatchText patch={patch} />, cut: 0 };
  const trimmed = trimDiff(files, budget);
  return { node: <SplitDiff files={trimmed.files} />, cut: trimmed.cut };
}

const STATUS_GLYPH = {
  completed: "✓",
  failed: "!",
  cancelled: "—",
  unknown: "—",
  running: "◌",
} as const;

const STATUS_LABEL = {
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  unknown: "No result",
  running: "Running",
} as const;

function SubagentStatusView({ status }: { status: keyof typeof STATUS_GLYPH }) {
  return (
    <span class={`subagent-status subagent-status-${status}`}>
      <span aria-hidden="true">{STATUS_GLYPH[status]}</span>
      {STATUS_LABEL[status]}
    </span>
  );
}

function SubagentDisclosure({
  label,
  class: className,
  children,
}: {
  label: unknown;
  class: string;
  children?: unknown;
}) {
  return (
    <details class={className}>
      <summary>
        <span class="subagent-summary-label">{label}</span>
        <span class="subagent-chevron" style="display:flex">
          <CardChevronIcon colour="currentColor" />
        </span>
      </summary>
      {children}
    </details>
  );
}

function SubagentBody({
  call,
  run,
  actions,
  progress,
}: {
  call: SubagentCall;
  run?: SubagentRun;
  actions?: ItemActions;
  progress?: string;
}) {
  const model = run?.model ?? call.model;
  const cwd = run?.cwd ?? call.cwd ?? actions?.cwd;
  const folder =
    cwd === undefined
      ? undefined
      : (cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd);
  return (
    <div class="subagent-body">
      <div class="subagent-meta">
        {model === undefined ? null : <span title={model}>{model}</span>}
        {folder === undefined || cwd === undefined ? null : (
          <span title={cwd}>{folder}</span>
        )}
      </div>
      {run === undefined ? (
        progress === undefined ? null : (
          <div class="subagent-result">
            <p>{progress}</p>
          </div>
        )
      ) : (
        <div class="subagent-result">
          <div class="subagent-section-label">Result</div>
          {run.output === "" ? null : (
            <Markdown source={run.output} actions={actions} />
          )}
          {run.error === undefined ? null : (
            <p class="subagent-error">{run.error}</p>
          )}
          {run.output === "" && run.error === undefined ? (
            <p>
              {run.handledWithoutAgent
                ? "Prompt handled without an agent response."
                : "No output."}
            </p>
          ) : null}
          {run.captureTruncated ? (
            <p class="subagent-notice">
              Only the end of the output was captured.
            </p>
          ) : null}
        </div>
      )}
      <SubagentDisclosure class="subagent-disclosure" label="Prompt">
        <pre class="subagent-plain">{call.prompt}</pre>
      </SubagentDisclosure>
      <SubagentDisclosure class="subagent-disclosure" label="Run details">
        <dl class="subagent-settings">
          <dt>Agent</dt>
          <dd>{call.agent}</dd>
          {model === undefined ? null : (
            <>
              <dt>Model</dt>
              <dd>{model}</dd>
            </>
          )}
          {cwd === undefined ? null : (
            <>
              <dt>Working directory</dt>
              <dd>{cwd}</dd>
            </>
          )}
          {call.initialContext === undefined ? null : (
            <>
              <dt>Requested initial context</dt>
              <dd>{call.initialContext}</dd>
            </>
          )}
          {call.session === undefined ? null : (
            <>
              <dt>Session</dt>
              <dd>{call.session}</dd>
            </>
          )}
        </dl>
      </SubagentDisclosure>
    </div>
  );
}

function Subagent({
  view,
  call,
  actions,
}: {
  view: SubagentView;
  call: ToolCallView;
  actions?: ItemActions;
}) {
  const { calls, runs } = view;
  const running = call.result === undefined;
  // What the tool last reported, while it is still reporting.
  const progress = actions?.progress?.[call.id];
  const single = calls.length === 1 ? calls[0] : undefined;
  const status: keyof typeof STATUS_GLYPH = running
    ? "running"
    : view.failed
      ? "failed"
      : (runs ?? []).some((run) => run.status === "cancelled")
        ? "cancelled"
        : (runs ?? []).some((run) => run.status === "unknown")
          ? "unknown"
          : call.result
            ? "completed"
            : "unknown";
  const counts =
    runs && calls.length > 1
      ? (["completed", "failed", "cancelled", "unknown"] as const)
          .flatMap((state) => {
            const count = runs.filter((run) => run.status === state).length;
            if (count === 0) return [];
            const label = state === "unknown" ? "without result" : state;
            return [`${count.toLocaleString("en")} ${label}`];
          })
          .join(" · ")
      : "";
  const raw = call.result?.text ?? "";
  return (
    <SubagentDisclosure
      class="subagent-card"
      label={
        <span class="subagent-header">
          <span class="subagent-name">
            Subagent ·{" "}
            {single
              ? single.agent
              : `${calls.length.toLocaleString("en")} agents`}
          </span>
          {counts === "" ? (
            <SubagentStatusView status={status} />
          ) : (
            <span class="subagent-counts">{counts}</span>
          )}
          {call.result?.seconds === undefined ? null : (
            <span class="subagent-duration">
              {formatDuration(call.result.seconds)}
            </span>
          )}
          {running && progress !== undefined ? (
            <span class="subagent-progress">{progress}</span>
          ) : null}
        </span>
      }
    >
      {runs === null && call.result ? (
        <div class="subagent-body subagent-result">
          <div class="subagent-section-label">Result</div>
          <Markdown
            source={raw === "" ? "No output." : raw}
            actions={actions}
          />
        </div>
      ) : null}
      {single ? (
        <SubagentBody
          call={single}
          {...(runs?.[0] ? { run: runs[0] } : {})}
          actions={actions}
          {...(progress === undefined ? {} : { progress })}
        />
      ) : (
        calls.map((item, index) => (
          <details class="subagent-agent">
            <summary>
              <span class="subagent-summary-label">
                <span class="subagent-header">
                  <span class="subagent-name">{item.agent}</span>
                  <SubagentStatusView
                    status={runs?.[index]?.status ?? "unknown"}
                  />
                </span>
              </span>
              <span class="subagent-chevron" style="display:flex">
                <CardChevronIcon colour="currentColor" />
              </span>
            </summary>
            <SubagentBody
              call={item}
              {...(runs?.[index] ? { run: runs[index] } : {})}
              actions={actions}
            />
          </details>
        ))
      )}
      <div class="subagent-raw">
        <SubagentDisclosure class="subagent-disclosure" label="Raw input">
          <pre class="subagent-plain">
            {JSON.stringify(call.arguments, null, 2)}
          </pre>
        </SubagentDisclosure>
        {call.result ? (
          <SubagentDisclosure class="subagent-disclosure" label="Raw output">
            <pre class="subagent-plain">{raw}</pre>
          </SubagentDisclosure>
        ) : null}
      </div>
    </SubagentDisclosure>
  );
}

/**
 * A tool call's arguments and its result. A real session holds hundreds of
 * kilobytes of these, so a settled card ships a placeholder that fetches this
 * when the reader opens it, and what arrives is still cut to a budget with a
 * button for the rest.
 */
export function ToolBody({
  call,
  actions,
  full,
}: {
  call: ToolCallView;
  actions?: ItemActions;
  full?: boolean;
}) {
  const result = call.result;
  const budgeted = actions !== undefined && full !== true;
  const more =
    result && budgeted
      ? `/sessions/${actions.sessionId}/entries/${result.entryId}/tool-result/${encodeURIComponent(call.id)}?full=1`
      : undefined;
  const failed = result?.isError === true;
  const showInput =
    call.partialArguments !== undefined || !isEditToolName(call.name);
  const input = showInput
    ? (call.partialArguments ?? JSON.stringify(call.arguments, null, 2))
    : "";
  const inputCut = budgeted && input.length > MAX_RESULT_CHARS;
  const text = result?.text ?? "";
  const empty = text.trim() === "" || text.trim() === "(no output)";
  const textCut =
    result !== undefined &&
    result.patch === undefined &&
    budgeted &&
    text.length > MAX_RESULT_CHARS;
  const diff =
    result?.patch === undefined
      ? null
      : trimmedDiff(result.patch, budgeted ? MAX_DIFF_ROWS : Infinity);
  return (
    <div class="tool-result">
      {showInput ? (
        <pre
          style={`margin:0; padding:8px 10px; color:var(--text-muted); font-size:12px; line-height:1.5; overflow:auto; background:var(--bg-subtle); border-top:1px solid ${
            failed ? "rgba(248,113,113,0.25)" : "rgba(34,197,94,0.2)"
          }; white-space:pre-wrap; word-break:break-all`}
        >
          {inputCut ? input.slice(0, MAX_RESULT_CHARS) : input}
        </pre>
      ) : null}
      {result === undefined ? null : diff !== null ? (
        <div style="border-top:1px solid rgba(34,197,94,0.15); background:var(--bg)">
          {diff.node}
        </div>
      ) : (
        <div
          style={`border-top:1px solid ${
            failed ? "rgba(248,113,113,0.3)" : "rgba(34,197,94,0.15)"
          }; background:${failed ? "rgba(248,113,113,0.04)" : "var(--bg-subtle)"}`}
        >
          {result.images.length === 0 ? null : (
            <div style="display:flex; gap:8px; flex-wrap:wrap; padding:10px; background:var(--bg)">
              <Images
                entryId={result.entryId}
                indices={result.images}
                actions={actions}
                size="full"
                gap={8}
              />
            </div>
          )}
          {empty && result.images.length > 0 ? null : (
            <pre
              style={`margin:0; padding:8px 10px; color:var(${
                failed ? "--danger" : empty ? "--text-dim" : "--text-muted"
              }); font-size:12px; line-height:1.5; overflow:auto; max-height:400px; background:var(--bg); white-space:pre-wrap; word-break:break-all; font-style:${
                empty ? "italic" : "normal"
              }; opacity:${empty ? "0.6" : "1"}`}
            >
              {empty
                ? "(no output)"
                : textCut
                  ? text.slice(0, MAX_RESULT_CHARS)
                  : text}
            </pre>
          )}
        </div>
      )}
      {more !== undefined && (inputCut || textCut || (diff?.cut ?? 0) > 0) ? (
        <ShowAll url={more} />
      ) : null}
    </div>
  );
}

function ToolCard({
  call,
  actions,
}: {
  call: ToolCallView;
  actions?: ItemActions;
}) {
  if (call.subagent) {
    return <Subagent view={call.subagent} call={call} actions={actions} />;
  }
  const failed = call.result?.isError === true;
  const filePath = toolFilePath(call, actions?.cwd ?? "");
  // A settled card is collapsed, so its body only has to exist once someone
  // opens it. That is what keeps a long session's page from reaching a
  // megabyte of tool output nobody reads.
  const deferred =
    actions && !actions.live && call.result
      ? `/sessions/${actions.sessionId}/entries/${call.result.entryId}/tool-result/${encodeURIComponent(call.id)}`
      : undefined;
  return (
    <details
      class="transcript-details tool-card"
      data-tool={call.name}
      style={`border-radius:7px; overflow:hidden; font-size:12px; border:1px solid ${
        failed ? "rgba(248,113,113,0.45)" : "rgba(34,197,94,0.25)"
      }; background:${failed ? "rgba(248,113,113,0.05)" : "rgba(34,197,94,0.04)"}`}
    >
      <summary style="display:flex; align-items:center; gap:7px; min-width:0; padding:6px 10px; color:var(--text-muted); cursor:pointer; font-size:12px; text-align:left">
        <span
          style={`color:var(${failed ? "--danger" : "--success"}); font-family:var(--font-mono); font-weight:600; font-size:11px; flex-shrink:0`}
        >
          {call.name}
        </span>
        {/* pi-web's preview is plain text: a click anywhere on the header
            opens the card, so a link inside it would fire both. The files a
            turn wrote are the chips under the answer instead. */}
        <span
          {...(filePath === undefined ? {} : { title: filePath })}
          style="color:var(--text-dim); font-family:var(--font-mono); font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; min-width:0"
        >
          {call.partialArguments === undefined
            ? call.preview
            : "Generating parameters..."}
        </span>
        {call.result?.seconds === undefined ? null : (
          <span style="font-size:11px; color:var(--text-dim); flex-shrink:0; font-variant-numeric:tabular-nums">
            {String(call.result.seconds)}s
          </span>
        )}
        <span
          class="card-chevron"
          style="display:flex; flex-shrink:0; transition:transform 0.15s"
        >
          <CardChevronIcon />
        </span>
      </summary>
      {deferred === undefined ? (
        <ToolBody call={call} actions={actions} />
      ) : (
        <div
          class="tool-result"
          hx-get={deferred}
          hx-trigger="toggle once from:closest details"
          hx-swap="outerHTML"
        >
          <pre
            style={`margin:0; padding:8px 10px; color:var(--text-dim); font-size:12px; line-height:1.5; background:var(--bg-subtle); border-top:1px solid ${
              failed ? "rgba(248,113,113,0.25)" : "rgba(34,197,94,0.2)"
            }`}
          >
            Loading output…
          </pre>
        </div>
      )}
    </details>
  );
}

function Blocks({
  item,
  actions,
}: {
  item: AssistantItem;
  actions?: ItemActions;
}) {
  return (
    <div style="display:flex; flex-direction:column; gap:8px">
      {item.blocks.map((block) => {
        switch (block.kind) {
          case "text":
            return (
              <Markdown
                source={block.text}
                actions={actions}
                variant="markdown-assistant-message"
              />
            );
          case "thinking":
            return (
              <ThinkingBlock item={item} block={block} actions={actions} />
            );
          case "image":
            return (
              <Images
                entryId={item.entryId}
                indices={[block.index]}
                actions={actions}
                size="full"
              />
            );
          default:
            return (
              <HistoryActionFrame
                entryId={block.call.result?.entryId ?? item.entryId}
                actions={actions}
              >
                <ToolCard call={block.call} actions={actions} />
              </HistoryActionFrame>
            );
        }
      })}
    </div>
  );
}

function usageLine(item: AssistantItem): string {
  const { usage } = item;
  if (!usage) return "";
  const number = (value: number) => value.toLocaleString("en");
  return [
    usage.input > 0 ? `${number(usage.input)} in` : "",
    usage.output > 0 ? `${number(usage.output)} out` : "",
    usage.cacheRead > 0 ? `${number(usage.cacheRead)} cache R` : "",
    usage.cacheWrite > 0 ? `${number(usage.cacheWrite)} cache W` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function answerText(item: AssistantItem): string {
  return item.blocks
    .filter((block) => block.kind === "text")
    .map((block) => block.text)
    .join("\n");
}

function AssistantMessage({
  item,
  actions,
  starrable,
  written,
}: {
  item: AssistantItem;
  actions?: ItemActions;
  starrable?: boolean;
  /** Files this turn wrote: pi-web lists them above the answer's footer. */
  written?: string[];
}) {
  if (
    item.blocks.length === 0 &&
    item.errorMessage === undefined &&
    item.stopReason !== "aborted"
  ) {
    return <></>;
  }
  const editable = actions && !actions.readOnly && !actions.live;
  const usage = usageLine(item);
  // The header row is a grid: pi-web gives the streaming estimate and the
  // speed fixed 9ch/10ch columns so the model name cannot push them around.
  const streaming = item.entryId === "partial" ? actions?.streaming : undefined;
  const star =
    editable === true &&
    actions !== undefined &&
    (starrable === true || actions.starred.has(item.entryId));
  const columns = streaming
    ? "minmax(0, 1fr) 9ch 10ch"
    : star
      ? "auto minmax(0, 1fr)"
      : "minmax(0, 1fr)";
  return (
    <div
      class="message-row"
      {...(item.processHalf ? {} : { id: `entry-${item.entryId}` })}
      data-role="assistant"
      style="margin-bottom:16px"
    >
      <div
        style={`font-size:11px; color:var(--text-dim); margin-bottom:4px; display:grid; grid-template-columns:${columns}; align-items:center; column-gap:6px`}
      >
        {star && actions ? (
          <StarButton entryId={item.entryId} actions={actions} />
        ) : null}
        <span
          title={item.model}
          style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap"
        >
          {item.model}
        </span>
        {streaming ? (
          <>
            <span
              title="Estimated token count while streaming"
              style="display:flex; align-items:center; justify-content:flex-end; gap:2px; color:var(--text); font-variant-numeric:tabular-nums; white-space:nowrap"
            >
              {streaming.tokens > 0 ? (
                <>
                  <TokenArrowIcon size={10} direction="out" />
                  {String(streaming.tokens)}
                </>
              ) : null}
            </span>
            <span style="text-align:right; color:var(--text-dim); font-size:11px; font-weight:400; font-variant-numeric:tabular-nums; white-space:nowrap">
              {streaming.tokensPerSecond === null
                ? ""
                : `${streaming.tokensPerSecond.toFixed(1)} t/s`}
            </span>
          </>
        ) : null}
      </div>
      <Blocks item={item} actions={actions} />
      {item.errorMessage === undefined && item.stopReason !== "error" ? null : (
        <div
          role="alert"
          style={`margin-top:${item.blocks.length > 0 ? "8px" : "0"}; padding:7px 10px; border:1px solid rgba(239,68,68,0.3); border-radius:6px; background:rgba(239,68,68,0.07); color:var(--danger); font-family:var(--font-mono); font-size:12px; line-height:1.5; white-space:pre-wrap; overflow-wrap:anywhere`}
        >
          Error: {item.errorMessage ?? "Unknown provider error"}
        </div>
      )}
      {item.stopReason !== "aborted" ? null : (
        <div style="margin-top:8px; font-size:11px; color:var(--text-dim)">
          Stopped
        </div>
      )}
      <WrittenFiles files={written ?? []} actions={actions} />
      <div style="display:flex; align-items:center; gap:8px; margin-top:4px">
        {usage === "" || streaming ? null : (
          <div style="font-size:11px; color:var(--text-dim)">{usage}</div>
        )}
        {streaming ? null : (
          <CopyButton
            text={answerText(item)}
            class="message-actions message-copy"
          />
        )}
        {streaming ||
        item.processHalf === true ||
        actions?.timestamps?.has(item.entryId) !== true ? null : (
          <Time
            value={item.timestamp}
            style="font-size:10px; color:var(--text-dim); margin-left:auto"
          />
        )}
      </div>
    </div>
  );
}

function FileList({ title, files }: { title: string; files: string[] }) {
  if (files.length === 0) return <></>;
  return (
    <div class="compaction-file-section">
      <div class="compaction-file-title">{title}</div>
      <ul class="compaction-file-list">
        {files.map((file) => (
          <li title={file}>{file}</li>
        ))}
      </ul>
    </div>
  );
}

function Compaction({
  item,
  actions,
}: {
  item: CompactionItem;
  actions?: ItemActions;
}) {
  const files = item.readFiles.length + item.modifiedFiles.length;
  const before = formatCompactCount(item.tokensBefore);
  // What it cost and what it left behind. The "after" is Pi's own context
  // build re-run at this entry, so it is an estimate and says so.
  const tokens =
    item.tokensAfter === undefined
      ? `${before} tokens before`
      : `${before} → ~${formatCompactCount(item.tokensAfter)} tokens`;
  const time = formatTimestamp(item.timestamp);
  const parts = [
    item.readFiles.length > 0 ? `${String(item.readFiles.length)} read` : "",
    item.modifiedFiles.length > 0
      ? `${String(item.modifiedFiles.length)} modified`
      : "",
  ].filter(Boolean);
  return (
    <details
      class="compaction-marker transcript-details"
      id={`entry-${item.entryId}`}
    >
      <summary
        class="compaction-header"
        aria-label={`Conversation compacted: ${tokens}`}
        title="Expand compaction summary"
      >
        <span class="compaction-rule" aria-hidden="true" />
        <span class="compaction-header-core">
          <CompactIcon />
          <span
            class="compaction-token-count"
            {...(item.tokensAfter === undefined
              ? {}
              : {
                  title:
                    "Context usage after compaction is estimated, including retained messages.",
                })}
          >
            {tokens}
          </span>
          {time === "" ? null : <span aria-hidden="true">·</span>}
          {time === "" ? null : <span class="compaction-time">{time}</span>}
        </span>
        <span class="compaction-rule" aria-hidden="true" />
      </summary>
      <div class="compaction-body">
        <div style="margin-bottom:10px; color:var(--text); font-size:14px; line-height:1.5">
          The conversation history before this point was compacted into the
          following summary:
        </div>
        {item.summary === "" ? (
          <span style="color:var(--text-dim); font-size:12px">
            (no summary)
          </span>
        ) : (
          <Markdown
            source={item.summary}
            actions={actions}
            variant="markdown-compaction-message"
          />
        )}
        {files > 0 ? (
          <details class="compaction-file-details">
            <summary>File context: {parts.join(", ")}</summary>
            <FileList title="Modified files" files={item.modifiedFiles} />
            <FileList title="Read files" files={item.readFiles} />
          </details>
        ) : null}
      </div>
    </details>
  );
}

/** The footer row of an extension card, with or without a details panel. */
const NOTE_FOOTER =
  "display:flex; align-items:center; gap:8px; padding:4px 9px;" +
  " border-top:1px solid var(--border); background:var(--bg-subtle)";

function NoteCopy({ text }: { text: string }) {
  return (
    <CopyButton
      text={text}
      bare
      style="padding:3px 7px; border:none; background:none; cursor:pointer; font-size:11px"
    />
  );
}

function Note({ item, actions }: { item: NoteItem; actions?: ItemActions }) {
  const time = formatTimestamp(item.timestamp);
  return (
    <div style="margin-bottom:16px" id={`entry-${item.entryId}`}>
      <details
        class="transcript-details note-card"
        style="border:1px solid var(--border); border-radius:8px; overflow:hidden; background:var(--bg)"
      >
        <summary
          title="Expand"
          style="display:flex; align-items:center; gap:8px; width:100%; min-width:0; padding:7px 10px; background:var(--bg-panel); color:var(--text-muted); font-size:12px; cursor:pointer; text-align:left"
        >
          <span style="min-width:0; overflow-wrap:anywhere; color:var(--text-muted); font-family:var(--font-mono); font-size:11px; font-weight:650">
            {item.customType || "extension"}
          </span>
          <span
            class="note-preview"
            style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text-dim); font-size:11px"
          >
            {item.preview === "" ? "Show extension message" : item.preview}
          </span>
          {time === "" ? null : (
            <span style="flex-shrink:0; color:var(--text-dim); font-size:10px">
              {time}
            </span>
          )}
          <span
            class="card-chevron"
            style="display:flex; flex-shrink:0; transition:transform 0.15s"
          >
            <CardChevronIcon />
          </span>
        </summary>
        <div style="padding:6px 9px">
          <Images
            entryId={item.entryId}
            indices={item.images}
            actions={actions}
            size="thumb"
            border="1px solid var(--border)"
            marginBottom={item.text === "" ? 0 : 8}
          />
          {item.text === "" ? (
            <span style="color:var(--text-dim); font-size:12px">
              (no message)
            </span>
          ) : (
            <Markdown
              source={item.text}
              actions={actions}
              variant="markdown-custom-message"
            />
          )}
        </div>
        {item.details === undefined ? (
          <div style={NOTE_FOOTER}>
            <NoteCopy text={item.text} />
          </div>
        ) : (
          /* pi-web keeps the copy button and the details toggle on one row
             (MessageView.tsx L2245-L2289). The row is the disclosure here,
             so the copy button inside it must not open the panel. */
          <details class="transcript-details note-details">
            <summary style={`${NOTE_FOOTER}; cursor:pointer`}>
              <NoteCopy text={item.text === "" ? item.details : item.text} />
              <span style="margin-left:auto; padding:3px 7px; color:var(--text-dim); font-size:11px">
                <span class="note-details-closed">Show details</span>
                <span class="note-details-open">Hide details</span>
              </span>
            </summary>
            <pre style="margin:0; padding:9px 10px; border-top:1px solid var(--border); background:var(--bg); color:var(--text-muted); font-size:12px; line-height:1.5; white-space:pre-wrap; word-break:break-word; max-height:360px; overflow:auto; font-family:var(--font-mono)">
              {item.details}
            </pre>
          </details>
        )}
      </details>
    </div>
  );
}

/** A `!` run: pi-web renders it through the tool card, header and all. */
function Bash({ item, actions }: { item: BashItem; actions?: ItemActions }) {
  const failed =
    item.cancelled || (item.exitCode !== null && item.exitCode !== 0);
  const name = item.excluded ? "bash (local)" : "bash";
  const outputUrl =
    item.truncated && item.outputPath !== undefined && actions
      ? `/sessions/${actions.sessionId}/bash-output?path=${encodeURIComponent(item.outputPath)}`
      : undefined;
  return (
    <div style="margin:6px 0" id={`entry-${item.entryId}`}>
      {/* Collapsed like every other tool call, as pi-web leaves it. */}
      <details
        class="transcript-details tool-card"
        style={`border-radius:7px; overflow:hidden; font-size:12px; border:1px solid ${
          failed ? "rgba(248,113,113,0.45)" : "rgba(34,197,94,0.25)"
        }; background:${failed ? "rgba(248,113,113,0.05)" : "rgba(34,197,94,0.04)"}`}
      >
        <summary style="display:flex; align-items:center; gap:7px; min-width:0; padding:6px 10px; color:var(--text-muted); cursor:pointer; font-size:12px; text-align:left">
          <span
            style={`color:var(${failed ? "--danger" : "--success"}); font-family:var(--font-mono); font-weight:600; font-size:11px; flex-shrink:0`}
          >
            {name}
          </span>
          <span style="color:var(--text-dim); font-family:var(--font-mono); font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; min-width:0">
            {item.command}
          </span>
          <span
            class="card-chevron"
            style="display:flex; flex-shrink:0; transition:transform 0.15s"
          >
            <CardChevronIcon />
          </span>
        </summary>
        {item.pending && item.output === "" ? null : (
          <div
            style={`border-top:1px solid ${
              failed ? "rgba(248,113,113,0.3)" : "rgba(34,197,94,0.15)"
            }; background:${failed ? "rgba(248,113,113,0.04)" : "var(--bg-subtle)"}`}
          >
            <pre
              style={`margin:0; padding:8px 10px; color:var(${failed ? "--danger" : "--text-muted"}); font-size:12px; line-height:1.5; overflow:auto; max-height:400px; background:var(--bg); white-space:pre-wrap; word-break:break-all`}
            >
              {item.output}
            </pre>
          </div>
        )}
      </details>
      {outputUrl === undefined ? null : (
        <div style="padding:4px 10px; font-size:11px; margin-top:-1px">
          <a
            target="_blank"
            rel="noreferrer"
            href={outputUrl}
            style="color:var(--accent); font-size:11px; text-decoration:underline"
          >
            view full output
          </a>
          <a
            href={`${outputUrl}&download=1`}
            style="margin-left:10px; color:var(--accent); font-size:11px; text-decoration:underline"
          >
            download full output
          </a>
        </div>
      )}
    </div>
  );
}

export function Item({
  item,
  actions,
  starrable,
  written,
}: {
  item: TranscriptItem;
  actions?: ItemActions;
  starrable?: boolean;
  written?: string[];
}) {
  switch (item.kind) {
    case "user":
      return <UserMessage item={item} actions={actions} />;
    case "assistant":
      return (
        <HistoryActionFrame entryId={item.entryId} actions={actions}>
          <AssistantMessage
            item={item}
            actions={actions}
            starrable={starrable ?? false}
            {...(written === undefined ? {} : { written })}
          />
        </HistoryActionFrame>
      );
    case "compaction":
      return (
        <HistoryActionFrame entryId={item.entryId} actions={actions}>
          <Compaction item={item} actions={actions} />
        </HistoryActionFrame>
      );
    case "branch_summary":
      return (
        <div id={`entry-${item.entryId}`} style="margin-bottom:16px">
          <div style="margin-bottom:10px; color:var(--text-muted); font-size:12px">
            The conversation briefly explored another branch and returned with
            this summary:
          </div>
          <Markdown
            source={item.summary}
            actions={actions}
            variant="markdown-assistant-message"
          />
        </div>
      );
    // pi-web frames every entry a branch can start from: an extension's own
    // message and a shell run as much as an answer (MessageView.tsx L240-L292).
    case "note":
      return (
        <HistoryActionFrame entryId={item.entryId} actions={actions}>
          <Note item={item} actions={actions} />
        </HistoryActionFrame>
      );
    default:
      return (
        <HistoryActionFrame entryId={item.entryId} actions={actions}>
          <Bash item={item} actions={actions} />
        </HistoryActionFrame>
      );
  }
}

/** The files a turn wrote, under its answer. Clicking one opens the viewer. */
function WrittenFiles({
  files,
  actions,
}: {
  files: string[];
  actions?: ItemActions;
}) {
  if (files.length === 0 || actions?.live) return <></>;
  return (
    <div
      aria-label="Files changed"
      style="display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin-top:6px"
    >
      {files.map((path) => {
        const name = path.split("/").pop() ?? path;
        return (
          <button
            type="button"
            class="written-file"
            data-file-path={path}
            title={path}
            aria-label={`Open ${name}`}
            style="display:inline-flex; align-items:center; gap:4px; padding:2px 8px; font-size:12px; font-family:var(--font-mono); color:var(--text); background:var(--bg-subtle); border:1px solid var(--border); border-radius:6px; cursor:pointer"
          >
            <FileIcon name={name} size={12} />
            <span>{name}</span>
          </button>
        );
      })}
    </div>
  );
}

function TurnView({ turn, actions }: { turn: Turn; actions?: ItemActions }) {
  const count = (value: number, noun: string) =>
    `${String(value)} ${noun}${value === 1 ? "" : "s"}`;
  const label = [
    "Process details",
    count(turn.processMessages, "message"),
    turn.processToolCalls > 0 ? count(turn.processToolCalls, "tool call") : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <section class="turn">
      {turn.boundary ? <Item item={turn.boundary} actions={actions} /> : null}
      {turn.process.length > 0 ? (
        <details
          class="transcript-details process-details"
          open={turn.expanded}
          style="margin-bottom:14px"
        >
          <summary
            title="Expand process details"
            style="display:flex; align-items:center; gap:8px; width:auto; min-height:24px; padding:2px 0; color:var(--text-muted); cursor:pointer; font-size:12px; text-align:left"
          >
            <span
              class="process-chevron"
              style="display:flex; flex-shrink:0; transition:transform 0.15s"
            >
              <ProcessChevronIcon />
            </span>
            <span style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">
              {label}
            </span>
          </summary>
          <div style="margin-top:8px">
            {turn.process.map((item) => (
              <Item item={item} actions={actions} />
            ))}
          </div>
        </details>
      ) : null}
      {turn.answer ? (
        <Item
          item={turn.answer}
          actions={actions}
          starrable
          written={turn.written}
        />
      ) : (
        <WrittenFiles files={turn.written} actions={actions} />
      )}
      {turn.trailing.map((item) => (
        <Item
          item={item}
          actions={actions}
          starrable={item.entryId === turn.loneAnswerId}
        />
      ))}
    </section>
  );
}

/**
 * The one transcript rendering: a page load, a prepended earlier page, a
 * settled turn appended to the log, and the running turn all come through
 * here. The running turn renders flat, because grouping a moving target
 * hides what just happened.
 */
export function Items({
  items,
  actions,
}: {
  items: TranscriptItem[];
  actions?: ItemActions;
}) {
  const withTimes: ItemActions | undefined = actions
    ? { ...actions, timestamps: timestampedEntries(items) }
    : undefined;
  if (actions?.live) {
    return (
      <>
        {items.map((item) => (
          <Item item={item} actions={actions} />
        ))}
      </>
    );
  }
  return (
    <>
      {groupTurns(items, actions?.cwd ?? "").map((turn) => (
        <TurnView turn={turn} actions={withTimes} />
      ))}
    </>
  );
}

/**
 * The sentinel above the oldest message on the page. Scrolling it into view
 * swaps it for the previous page, which carries the next sentinel.
 */
export function LoadEarlier({
  sessionId,
  before,
  leaf,
}: {
  sessionId: string;
  before: string;
  leaf?: string;
}) {
  const query = new URLSearchParams({ before });
  if (leaf !== undefined) query.set("leaf", leaf);
  return (
    <div
      class="chat-load-earlier load-earlier"
      hx-get={`/sessions/${sessionId}/earlier?${query.toString()}`}
      hx-trigger="intersect once"
      hx-target="this"
      hx-swap="outerHTML"
    >
      Scroll up to load earlier messages
    </div>
  );
}

/** A page of older messages, with the sentinel for the page before it. */
export function EarlierPage({
  items,
  actions,
  hasMore,
  oldestId,
  leaf,
}: {
  items: TranscriptItem[];
  actions: ItemActions;
  hasMore: boolean;
  oldestId?: string;
  leaf?: string;
}) {
  return (
    <>
      {hasMore && oldestId !== undefined ? (
        <LoadEarlier
          sessionId={actions.sessionId}
          before={oldestId}
          {...(leaf === undefined ? {} : { leaf })}
        />
      ) : null}
      <Items items={items} actions={actions} />
    </>
  );
}

/**
 * The running turn: its messages flat, plus the line that says what the
 * session is doing while nothing has streamed yet.
 */
export function TurnFragment({
  items,
  actions,
  status,
}: {
  items: TranscriptItem[];
  actions: ItemActions;
  status: LiveStatus | null;
}) {
  const label = status ? activityLabel(status) : null;
  // Only a turn that is actually working renders flat: grouping a moving
  // target hides what just happened. A finished turn groups like any other.
  const live = status?.running === true || status?.bashRunning === true;
  const progress = Object.fromEntries(
    (status?.tools ?? [])
      .filter((tool) => tool.progress !== undefined)
      .map((tool) => [tool.id, tool.progress ?? ""]),
  );
  return (
    <>
      <Items
        items={items}
        actions={{
          ...actions,
          ...(live ? { live } : {}),
          ...(Object.keys(progress).length > 0 ? { progress } : {}),
          ...(status?.streaming ? { streaming: status.streaming } : {}),
        }}
      />
      {label === null ? null : (
        <div class="chat-activity">
          <span class="chat-activity-label">{label}</span>
        </div>
      )}
    </>
  );
}
