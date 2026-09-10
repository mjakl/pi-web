import { formatTokens } from "@core/context-usage";
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
};

function Markdown({
  source,
  actions,
}: {
  source: string;
  actions?: ItemActions;
}) {
  return (
    <div class="prose max-w-none break-words">
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

/** Copies the text the button hides next to itself. */
function Copy({ text, label = "Copy" }: { text: string; label?: string }) {
  if (text === "") return <></>;
  return (
    <span class="inline-flex">
      <span hidden data-copy-source>
        {text}
      </span>
      <button type="button" class="btn btn-ghost btn-xs" data-copy>
        {label}
      </button>
    </span>
  );
}

function Time({ value }: { value: string }) {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return <></>;
  return (
    <time class="text-[10px] text-base-content/50" datetime={value}>
      {at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
    </time>
  );
}

function imageUrl(
  actions: ItemActions,
  entryId: string,
  index: number,
): string {
  return `/sessions/${actions.sessionId}/entries/${entryId}/image/${String(index)}`;
}

function Images({
  entryId,
  indices,
  actions,
  size,
}: {
  entryId: string;
  indices: number[];
  actions?: ItemActions;
  size: "thumb" | "full";
}) {
  if (!actions || indices.length === 0) return <></>;
  return (
    <div class="my-2 flex flex-wrap gap-2">
      {indices.map((index) => (
        <a href={imageUrl(actions, entryId, index)} target="_blank">
          <img
            class={
              size === "thumb"
                ? "max-h-60 max-w-60 rounded border border-base-300 object-contain"
                : "max-h-[520px] max-w-full rounded border border-base-300 object-contain"
            }
            alt={`Image ${String(index + 1)}`}
            loading="lazy"
            src={imageUrl(actions, entryId, index)}
          />
        </a>
      ))}
    </div>
  );
}

/** Branch and fork: the same two actions on every kind of message. */
function HistoryActions({
  entryId,
  actions,
  children,
}: {
  entryId: string;
  actions: ItemActions;
  children?: unknown;
}) {
  if (actions.readOnly || actions.live) return <>{children}</>;
  const post = (path: string) => `/sessions/${actions.sessionId}/${path}`;
  const swap = {
    "hx-vals": JSON.stringify({ entryId }),
    "hx-target": "body",
    "hx-swap": "innerHTML",
    "hx-indicator": "#branch-sync",
  };
  return (
    <div class="flex flex-wrap items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
      {children}
      <button
        type="button"
        class="btn btn-ghost btn-xs"
        title="Continue from this point within this session"
        hx-post={post("navigate")}
        {...swap}
      >
        New branch
      </button>
      <button
        type="button"
        class="btn btn-ghost btn-xs"
        title="Copy the history up to this point into a separate session"
        hx-post={post("fork")}
        {...swap}
      >
        New session
      </button>
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
  return (
    <button
      type="button"
      class={`btn btn-ghost btn-xs ${starred ? "text-warning" : ""}`}
      aria-pressed={starred ? "true" : "false"}
      aria-label={starred ? "Unstar answer" : "Star answer"}
      hx-post={`/sessions/${actions.sessionId}/star`}
      hx-vals={JSON.stringify({ entryId, starred: !starred })}
      hx-target="this"
      hx-swap="outerHTML"
    >
      {starred ? "★" : "☆"}
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
  return (
    <article
      id={`entry-${item.entryId}`}
      data-role="user"
      class="group -mx-4 my-4 bg-primary/5 px-4 py-3"
    >
      <div class="ml-auto flex max-w-[85%] flex-col items-end gap-1">
        <Images
          entryId={item.entryId}
          indices={item.images}
          actions={actions}
          size="thumb"
        />
        {item.command === undefined ? (
          <div class="w-full rounded-box bg-base-200 px-3 py-2 whitespace-pre-wrap">
            {item.text}
          </div>
        ) : (
          <details class="w-full rounded-box bg-base-200 px-3 py-2">
            <summary class="cursor-pointer font-mono text-sm">
              {item.command}
            </summary>
            <Markdown source={item.text} actions={actions} />
          </details>
        )}
        <div class="flex items-center gap-1">
          <Copy text={item.command ?? item.text} />
          {editable && actions ? (
            <>
              <button
                type="button"
                class="btn btn-ghost text-error btn-xs"
                title="Remove this message and everything after it, then edit it again"
                hx-post={`/sessions/${actions.sessionId}/rewind`}
                hx-vals={JSON.stringify({ entryId: item.entryId })}
                hx-confirm="Remove this message and all later history?"
                hx-target="body"
                hx-swap="innerHTML"
              >
                Rewind
              </button>
              <HistoryActions entryId={item.entryId} actions={actions} />
            </>
          ) : null}
          {actions?.timestamps?.has(item.entryId) ? (
            <Time value={item.timestamp} />
          ) : null}
        </div>
      </div>
    </article>
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
    <details class="my-2 rounded-box border border-base-300 text-sm">
      <summary class="cursor-pointer px-3 py-1 text-base-content/70">
        Thinking
        {block.seconds === undefined ? null : (
          <span class="ml-2 text-xs text-base-content/50">
            {String(block.seconds)}s
          </span>
        )}
      </summary>
      <div class="px-3 pb-2 text-base-content/70">
        {fetchUrl === undefined ? (
          <Markdown source={block.text} actions={actions} />
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

function DiffCellText({ cell }: { cell: DiffCell }) {
  return (
    <>
      <span class="w-10 shrink-0 pr-1 text-right text-base-content/40 select-none">
        {cell.lineNo === null ? "" : String(cell.lineNo)}
      </span>
      <span class="w-4 shrink-0 select-none">
        {cell.type === "added" ? "+" : cell.type === "removed" ? "-" : " "}
      </span>
      <span class="break-all whitespace-pre-wrap">{cell.text}</span>
    </>
  );
}

const CELL_CLASS = {
  added: "bg-success/15",
  removed: "bg-error/15",
  context: "",
  empty: "bg-base-200",
} as const;

function SplitDiff({ files }: { files: DiffFile[] }) {
  return (
    <div class="my-2 max-h-[560px] overflow-auto rounded-box border border-base-300 font-mono text-xs">
      {files.map((file) => (
        <div>
          {files.length > 1 ? (
            <div class="sticky top-0 z-10 flex justify-between gap-2 bg-base-200 px-2 py-1 text-base-content/60">
              <span class="truncate">{file.oldPath ?? "Before"}</span>
              <span class="truncate">{file.newPath ?? "After"}</span>
            </div>
          ) : null}
          {file.rows.map((row) =>
            row.type === "hunk" ? null : (
              <div class="grid grid-cols-2">
                <div class={`flex ${CELL_CLASS[row.left.type]}`}>
                  <DiffCellText cell={row.left} />
                </div>
                <div class={`flex ${CELL_CLASS[row.right.type]}`}>
                  <DiffCellText cell={row.right} />
                </div>
              </div>
            ),
          )}
        </div>
      ))}
    </div>
  );
}

const PATCH_LINE_CLASS = {
  added: "border-success bg-success/10",
  removed: "border-error bg-error/10",
  hunk: "border-info bg-info/10",
  context: "border-transparent",
} as const;

/** Fallback when the patch does not parse: the text, lightly classified. */
function PatchText({ patch }: { patch: string }) {
  return (
    <div class="my-2 max-h-[520px] overflow-auto rounded-box border border-base-300 font-mono text-xs">
      {patchLines(patch).map((line) => (
        <div class={`flex border-l-[3px] ${PATCH_LINE_CLASS[line.type]}`}>
          <span class="w-10 shrink-0 pr-1 text-right text-base-content/40 select-none">
            {String(line.lineNo)}
          </span>
          <span class="break-all whitespace-pre-wrap">{line.text}</span>
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
    <button
      type="button"
      class="btn btn-ghost btn-xs"
      hx-get={url}
      hx-target="closest .tool-result"
      hx-swap="outerHTML"
    >
      Show the whole output
    </button>
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
} as const;

function SubagentRunBody({
  run,
  prompt,
  actions,
}: {
  run: SubagentRun;
  prompt: string;
  actions?: ItemActions;
}) {
  return (
    <div class="flex flex-col gap-2">
      <div class="text-xs text-base-content/60">
        {run.model ?? ""}{" "}
        {run.cwd ? <span title={run.cwd}>{run.cwd}</span> : null}
      </div>
      {run.error === undefined ? null : (
        <p class="text-sm text-error">{run.error}</p>
      )}
      {run.output === "" ? (
        <p class="text-sm text-base-content/60 italic">
          {run.handledWithoutAgent
            ? "Prompt handled without an agent response."
            : "No output."}
        </p>
      ) : (
        <Markdown source={run.output} actions={actions} />
      )}
      {run.captureTruncated ? (
        <p class="text-xs text-warning">Output was truncated.</p>
      ) : null}
      <details class="text-sm">
        <summary class="cursor-pointer text-base-content/60">Prompt</summary>
        <pre class="overflow-auto text-xs whitespace-pre-wrap">{prompt}</pre>
      </details>
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
  const counts = new Map<string, number>();
  for (const run of runs ?? []) {
    counts.set(run.status, (counts.get(run.status) ?? 0) + 1);
  }
  const summary =
    calls.length === 1
      ? `Subagent · ${calls[0]?.agent ?? ""}`
      : `Subagent · ${String(calls.length)} agents`;
  return (
    <details
      class={`my-2 rounded-box border text-sm ${
        view.failed ? "border-error/50 bg-error/5" : "border-base-300"
      }`}
    >
      <summary class="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-1">
        <span class="font-mono text-xs">{summary}</span>
        {running ? (
          <span class="text-xs text-base-content/60">◌ running</span>
        ) : (
          <span class="text-xs text-base-content/60">
            {[...counts.entries()]
              .map(([status, count]) => `${String(count)} ${status}`)
              .join(" · ")}
          </span>
        )}
        {call.result?.seconds === undefined ? null : (
          <span class="text-xs text-base-content/50">
            {String(call.result.seconds)}s
          </span>
        )}
      </summary>
      <div class="flex flex-col gap-2 px-3 pb-2">
        {calls.map((item, index) => {
          const run = runs?.[index];
          return (
            <details open={calls.length === 1}>
              <summary class="cursor-pointer">
                <span class="font-mono text-xs">{item.agent}</span>
                <span class="ml-2 text-xs text-base-content/60">
                  {run ? `${STATUS_GLYPH[run.status]} ${run.status}` : "◌"}
                </span>
              </summary>
              {run ? (
                <SubagentRunBody
                  run={run}
                  prompt={item.prompt}
                  actions={actions}
                />
              ) : (
                <pre class="overflow-auto text-xs whitespace-pre-wrap">
                  {item.prompt}
                </pre>
              )}
            </details>
          );
        })}
        {runs === null && call.result ? (
          <div>
            <div class="text-xs text-base-content/60">Result</div>
            <pre class="max-h-96 overflow-auto text-xs whitespace-pre-wrap">
              {call.result.text}
            </pre>
          </div>
        ) : null}
        <details>
          <summary class="cursor-pointer text-xs text-base-content/60">
            Raw input and output
          </summary>
          <pre class="max-h-96 overflow-auto text-xs whitespace-pre-wrap">
            {JSON.stringify(call.arguments, null, 2)}
          </pre>
          {call.result ? (
            <pre class="max-h-96 overflow-auto text-xs whitespace-pre-wrap">
              {call.result.text}
            </pre>
          ) : null}
        </details>
      </div>
    </details>
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
        <pre class="max-h-72 overflow-auto text-xs whitespace-pre-wrap">
          {inputCut ? input.slice(0, MAX_RESULT_CHARS) : input}
        </pre>
      ) : null}
      {result === undefined ? null : diff !== null ? (
        diff.node
      ) : (
        <>
          <Images
            entryId={result.entryId}
            indices={result.images}
            actions={actions}
            size="full"
          />
          {empty ? (
            result.images.length > 0 ? null : (
              <p class="text-xs text-base-content/50 italic">(no output)</p>
            )
          ) : (
            <pre
              class={`max-h-[400px] overflow-auto text-xs break-all whitespace-pre-wrap ${
                result.isError ? "text-error" : ""
              }`}
            >
              {textCut ? text.slice(0, MAX_RESULT_CHARS) : text}
            </pre>
          )}
        </>
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
      class={`my-2 rounded-box border text-sm ${
        failed ? "border-error/50 bg-error/5" : "border-success/40 bg-success/5"
      }`}
      data-tool={call.name}
    >
      <summary class="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-1">
        <span
          class={`font-mono text-xs ${failed ? "text-error" : "text-success"}`}
        >
          {call.name}
        </span>
        <span class="min-w-0 flex-1 truncate text-xs text-base-content/60">
          {call.partialArguments !== undefined ? (
            "Generating parameters..."
          ) : filePath === undefined ? (
            call.preview
          ) : (
            <button
              type="button"
              class="tool-path"
              data-file-path={filePath}
              title={filePath}
            >
              {call.preview}
            </button>
          )}
        </span>
        {call.result?.seconds === undefined ? null : (
          <span class="text-xs text-base-content/50">
            {String(call.result.seconds)}s
          </span>
        )}
      </summary>
      <div class="px-3 pb-2">
        {deferred === undefined ? (
          <ToolBody call={call} actions={actions} />
        ) : (
          <div
            class="tool-result"
            hx-get={deferred}
            hx-trigger="toggle once from:closest details"
            hx-swap="outerHTML"
          >
            <p class="text-xs text-base-content/50">Loading output…</p>
          </div>
        )}
      </div>
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
    <div class="flex flex-col gap-2">
      {item.blocks.map((block) => {
        switch (block.kind) {
          case "text":
            return <Markdown source={block.text} actions={actions} />;
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
            return <ToolCard call={block.call} actions={actions} />;
        }
      })}
    </div>
  );
}

function usageLine(item: AssistantItem): string {
  const { usage } = item;
  if (!usage) return "";
  const number = (value: number) => value.toLocaleString("en-US");
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
}: {
  item: AssistantItem;
  actions?: ItemActions;
  starrable?: boolean;
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
  return (
    <article
      id={`entry-${item.entryId}`}
      data-role="assistant"
      class="group my-3"
    >
      <div class="flex items-center gap-2 text-xs text-base-content/50">
        {editable &&
        actions &&
        (starrable || actions.starred.has(item.entryId)) ? (
          <StarButton entryId={item.entryId} actions={actions} />
        ) : null}
        <span class="font-mono">{item.model}</span>
      </div>
      <Blocks item={item} actions={actions} />
      {item.errorMessage === undefined && item.stopReason !== "error" ? null : (
        <div class="my-2 alert text-sm alert-error" role="alert">
          Error: {item.errorMessage ?? "Unknown provider error"}
        </div>
      )}
      {item.stopReason === "aborted" ? (
        <div class="text-xs text-base-content/60">Stopped</div>
      ) : null}
      <div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-base-content/50">
        {usage === "" ? null : <span>{usage}</span>}
        <Copy text={answerText(item)} />
        {actions && !actions.live ? (
          <HistoryActions entryId={item.entryId} actions={actions} />
        ) : null}
        <span class="flex-1" />
        {actions?.timestamps?.has(item.entryId) ? (
          <Time value={item.timestamp} />
        ) : null}
      </div>
    </article>
  );
}

function FileList({ title, files }: { title: string; files: string[] }) {
  if (files.length === 0) return <></>;
  return (
    <div>
      <div class="text-xs font-semibold">{title}</div>
      <ul class="list-inside list-disc font-mono text-xs">
        {files.map((file) => (
          <li class="truncate" title={file}>
            {file}
          </li>
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
  return (
    <details
      id={`entry-${item.entryId}`}
      class="group my-4 rounded-box border border-dashed border-warning/50 px-4 py-2 text-sm"
    >
      <summary
        class="cursor-pointer text-base-content/70"
        aria-label={`Conversation compacted: ${formatTokens(item.tokensBefore)} tokens before`}
      >
        Conversation compacted · {formatTokens(item.tokensBefore)} tokens before
      </summary>
      <p class="my-2 text-xs text-base-content/60">
        Everything before this point was replaced by the summary below.
      </p>
      {item.summary === "" ? (
        <p class="text-xs italic">No summary</p>
      ) : (
        <Markdown source={item.summary} actions={actions} />
      )}
      {files > 0 ? (
        <details class="mt-2">
          <summary class="cursor-pointer text-xs text-base-content/60">
            File context ({String(item.readFiles.length)} read,{" "}
            {String(item.modifiedFiles.length)} modified)
          </summary>
          <div class="flex flex-col gap-2 pt-1">
            <FileList title="Read" files={item.readFiles} />
            <FileList title="Modified" files={item.modifiedFiles} />
          </div>
        </details>
      ) : null}
    </details>
  );
}

function Note({ item, actions }: { item: NoteItem; actions?: ItemActions }) {
  return (
    <details
      id={`entry-${item.entryId}`}
      class="group my-3 rounded-box border border-base-300 px-4 py-2 text-sm"
    >
      <summary class="flex cursor-pointer flex-wrap items-center gap-2">
        <span class="font-mono text-xs">{item.customType || "extension"}</span>
        <span class="min-w-0 flex-1 truncate text-xs text-base-content/60">
          {item.preview === "" ? "Show extension message" : item.preview}
        </span>
      </summary>
      <Images
        entryId={item.entryId}
        indices={item.images}
        actions={actions}
        size="thumb"
      />
      {item.text === "" ? (
        <p class="text-xs italic">No message</p>
      ) : (
        <Markdown source={item.text} actions={actions} />
      )}
      <div class="mt-1 flex items-center gap-1">
        <Copy text={item.text === "" ? (item.details ?? "") : item.text} />
        {actions ? (
          <HistoryActions entryId={item.entryId} actions={actions} />
        ) : null}
      </div>
      {item.details === undefined ? null : (
        <details class="mt-1">
          <summary class="cursor-pointer text-xs text-base-content/60">
            Show details
          </summary>
          <pre class="max-h-[360px] overflow-auto text-xs whitespace-pre-wrap">
            {item.details}
          </pre>
        </details>
      )}
    </details>
  );
}

function Bash({ item, actions }: { item: BashItem; actions?: ItemActions }) {
  const failed =
    item.cancelled || (item.exitCode !== null && item.exitCode !== 0);
  const name = item.excluded ? "bash (local)" : "bash";
  return (
    <details
      id={`entry-${item.entryId}`}
      open
      class={`group my-2 rounded-box border text-sm ${
        failed ? "border-error/50 bg-error/5" : "border-success/40 bg-success/5"
      }`}
    >
      <summary class="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-1">
        <span
          class={`font-mono text-xs ${failed ? "text-error" : "text-success"}`}
        >
          {name}
        </span>
        <span class="min-w-0 flex-1 truncate font-mono text-xs text-base-content/60">
          {item.command}
        </span>
        {item.pending ? (
          <span class="loading loading-xs loading-dots" aria-label="Running" />
        ) : null}
      </summary>
      <div class="px-3 pb-2">
        {item.pending && item.output === "" ? null : (
          <pre class="max-h-[400px] overflow-auto text-xs break-all whitespace-pre-wrap">
            {item.output}
          </pre>
        )}
        <div class="flex items-center gap-2">
          {item.truncated && item.outputPath !== undefined && actions ? (
            <a
              class="link text-xs"
              target="_blank"
              rel="noreferrer"
              href={`/sessions/${actions.sessionId}/bash-output?path=${encodeURIComponent(item.outputPath)}`}
            >
              View full output
            </a>
          ) : null}
          <Copy text={item.output} />
          {actions && !item.pending ? (
            <HistoryActions entryId={item.entryId} actions={actions} />
          ) : null}
        </div>
      </div>
    </details>
  );
}

export function Item({
  item,
  actions,
  starrable,
}: {
  item: TranscriptItem;
  actions?: ItemActions;
  starrable?: boolean;
}) {
  switch (item.kind) {
    case "user":
      return <UserMessage item={item} actions={actions} />;
    case "assistant":
      return (
        <AssistantMessage
          item={item}
          actions={actions}
          starrable={starrable ?? false}
        />
      );
    case "compaction":
      return <Compaction item={item} actions={actions} />;
    case "branch_summary":
      return (
        <div
          id={`entry-${item.entryId}`}
          class="my-4 rounded-box border border-dashed border-info/50 px-4 py-2 text-sm"
        >
          <p class="text-xs italic">
            The conversation briefly explored another branch and returned with
            this summary:
          </p>
          <Markdown source={item.summary} actions={actions} />
        </div>
      );
    case "note":
      return <Note item={item} actions={actions} />;
    default:
      return <Bash item={item} actions={actions} />;
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
    <div class="my-2 flex flex-wrap gap-1" aria-label="Files changed">
      {files.map((path) => (
        <button
          type="button"
          class="btn btn-ghost font-mono btn-xs"
          data-file-path={path}
          title={path}
        >
          {path.split("/").pop() ?? path}
        </button>
      ))}
    </div>
  );
}

function TurnView({ turn, actions }: { turn: Turn; actions?: ItemActions }) {
  const count = (value: number, noun: string) =>
    `${String(value)} ${noun}${value === 1 ? "" : "s"}`;
  const label = [
    count(turn.processMessages, "message"),
    turn.processToolCalls > 0 ? count(turn.processToolCalls, "tool call") : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <section class="turn">
      {turn.boundary ? <Item item={turn.boundary} actions={actions} /> : null}
      {turn.process.length > 0 ? (
        <details class="my-2" open={turn.expanded}>
          <summary class="cursor-pointer text-xs text-base-content/60">
            Process details · {label}
          </summary>
          <div class="border-l border-base-300 pl-3">
            {turn.process.map((item) => (
              <Item item={item} actions={actions} />
            ))}
          </div>
        </details>
      ) : null}
      {turn.answer ? (
        <Item item={turn.answer} actions={actions} starrable />
      ) : null}
      <WrittenFiles files={turn.written} actions={actions} />
      {turn.trailing.map((item) => (
        <Item item={item} actions={actions} />
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
      class="load-earlier my-2 text-center text-xs text-base-content/50"
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
  return (
    <>
      <Items
        items={items}
        actions={{ ...actions, ...(live ? { live } : {}) }}
      />
      {label === null ? null : (
        <p class="my-2 animate-pulse font-mono text-xs text-base-content/60">
          {label}
        </p>
      )}
    </>
  );
}
