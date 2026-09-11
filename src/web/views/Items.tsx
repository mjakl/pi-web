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
  /** The last line each running tool reported, by tool-call id. */
  progress?: Record<string, string>;
};

function Markdown({
  source,
  actions,
}: {
  source: string;
  actions?: ItemActions;
}) {
  return (
    <div class="markdown-body">
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
    <span>
      <span hidden data-copy-source>
        {text}
      </span>
      <button type="button" data-copy>
        {label}
      </button>
    </span>
  );
}

function Time({ value }: { value: string }) {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return <></>;
  return (
    <time datetime={value}>
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
    <div>
      {indices.map((index) => (
        <a href={imageUrl(actions, entryId, index)} target="_blank">
          <img
            style={
              size === "thumb"
                ? "max-height:240px; max-width:240px; border-radius:6px; border:1px solid var(--border); object-fit:contain"
                : "max-height:520px; max-width:100%; border-radius:6px; border:1px solid var(--border); object-fit:contain"
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
    <div>
      {children}
      <button
        type="button"

        title="Continue from this point within this session"
        hx-post={post("navigate")}
        {...swap}
      >
        New branch
      </button>
      <button
        type="button"

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
    <article id={`entry-${item.entryId}`} data-role="user">
      <div>
        <Images
          entryId={item.entryId}
          indices={item.images}
          actions={actions}
          size="thumb"
        />
        {item.command === undefined ? (
          // `data-user-text` is what the composer's ArrowUp history reads.
          <div data-user-text>{item.text}</div>
        ) : (
          <details>
            <summary data-user-text>{item.command}</summary>
            <Markdown source={item.text} actions={actions} />
          </details>
        )}
        <div>
          <Copy text={item.command ?? item.text} />
          {editable && actions ? (
            <>
              <button
                type="button"

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
    <details>
      <summary>
        Thinking
        {block.seconds === undefined ? null : (
          <span>{String(block.seconds)}s</span>
        )}
      </summary>
      <div>
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
      <span>{cell.lineNo === null ? "" : String(cell.lineNo)}</span>
      <span>
        {cell.type === "added" ? "+" : cell.type === "removed" ? "-" : " "}
      </span>
      <span>{cell.text}</span>
    </>
  );
}

/** pi-web's split-diff tints (§4.4.5), which are literal rgba, not tokens. */
/**
 * pi-web tints a tool call, a subagent run and a shell run by its outcome
 * (§4.4.4): green while it went well, red when it did not. The values are
 * literal rgba in pi-web too, not tokens.
 */
function cardStyle(failed: boolean): string {
  const line = failed ? "rgba(248,113,113,0.45)" : "rgba(34,197,94,0.25)";
  const fill = failed ? "rgba(248,113,113,0.05)" : "rgba(34,197,94,0.04)";
  return `border-radius:7px; overflow:hidden; font-size:12px; border:1px solid ${line}; background:${fill}`;
}

const CELL_BACKGROUND = {
  added: "rgba(0,200,80,0.12)",
  removed: "rgba(240,60,60,0.14)",
  context: "transparent",
  empty: "var(--bg-panel)",
} as const;

function SplitDiff({ files }: { files: DiffFile[] }) {
  return (
    <div>
      {files.map((file) => (
        <div>
          {files.length > 1 ? (
            <div>
              <span>{file.oldPath ?? "Before"}</span>
              <span>{file.newPath ?? "After"}</span>
            </div>
          ) : null}
          {file.rows.map((row) =>
            row.type === "hunk" ? null : (
              <div style="display:grid; grid-template-columns:1fr 1fr">
                <div style={`background:${CELL_BACKGROUND[row.left.type]}`}>
                  <DiffCellText cell={row.left} />
                </div>
                <div style={`background:${CELL_BACKGROUND[row.right.type]}`}>
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

const PATCH_LINE_STYLE = {
  added: "border-left-color:var(--success); background:rgba(0,200,80,0.12)",
  removed: "border-left-color:var(--danger); background:rgba(240,60,60,0.14)",
  hunk: "border-left-color:var(--accent); background:rgba(96,165,250,0.12)",
  context: "border-left-color:transparent",
} as const;

/** Fallback when the patch does not parse: the text, lightly classified. */
function PatchText({ patch }: { patch: string }) {
  return (
    <div>
      {patchLines(patch).map((line) => (
        <div style={`border-left:3px solid; ${PATCH_LINE_STYLE[line.type]}`}>
          <span>{String(line.lineNo)}</span>
          <span>{line.text}</span>
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

/** What a subagent run was given and where it ran. */
function RunDetails({ call, run }: { call: SubagentCall; run?: SubagentRun }) {
  const rows: [string, string][] = [
    ["Agent", call.agent],
    ["Model", run?.model ?? call.model ?? ""],
    ["Folder", run?.cwd ?? call.cwd ?? ""],
    ["Initial context", call.initialContext ?? ""],
    ["Session", call.session ?? ""],
  ].filter((row): row is [string, string] => (row[1] ?? "") !== "");
  if (rows.length === 0) return <></>;
  return (
    <dl>
      {rows.map(([label, value]) => (
        <>
          <dt>{label}</dt>
          <dd title={value}>{value}</dd>
        </>
      ))}
    </dl>
  );
}

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
    <div>
      {run.error === undefined ? null : <p>{run.error}</p>}
      {run.output === "" ? (
        <p>
          {run.handledWithoutAgent
            ? "Prompt handled without an agent response."
            : "No output."}
        </p>
      ) : (
        <Markdown source={run.output} actions={actions} />
      )}
      {run.captureTruncated ? <p>Output was truncated.</p> : null}
      <details>
        <summary>Prompt</summary>
        <pre>{prompt}</pre>
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
  // What the tool last reported, while it is still reporting.
  const progress = actions?.progress?.[call.id];
  const counts = new Map<string, number>();
  for (const run of runs ?? []) {
    counts.set(run.status, (counts.get(run.status) ?? 0) + 1);
  }
  const summary =
    calls.length === 1
      ? `Subagent · ${calls[0]?.agent ?? ""}`
      : `Subagent · ${String(calls.length)} agents`;
  return (
    <details style={cardStyle(view.failed)}>
      <summary>
        <span>{summary}</span>
        {running ? (
          <span>◌ running{progress === undefined ? "" : ` · ${progress}`}</span>
        ) : (
          <span>
            {[...counts.entries()]
              .map(([status, count]) => `${String(count)} ${status}`)
              .join(" · ")}
          </span>
        )}
        {call.result?.seconds === undefined ? null : (
          <span>{String(call.result.seconds)}s</span>
        )}
      </summary>
      <div>
        {calls.map((item, index) => {
          const run = runs?.[index];
          return (
            <details open={calls.length === 1}>
              <summary>
                <span>{item.agent}</span>
                <span>
                  {run ? `${STATUS_GLYPH[run.status]} ${run.status}` : "◌"}
                </span>
              </summary>
              <RunDetails call={item} {...(run ? { run } : {})} />
              {progress === undefined ? null : <p>{progress}</p>}
              {run ? (
                <SubagentRunBody
                  run={run}
                  prompt={item.prompt}
                  actions={actions}
                />
              ) : (
                <pre>{item.prompt}</pre>
              )}
            </details>
          );
        })}
        {runs === null && call.result ? (
          <div>
            <div>Result</div>
            <pre>{call.result.text}</pre>
          </div>
        ) : null}
        <details>
          <summary>Raw input and output</summary>
          <pre>{JSON.stringify(call.arguments, null, 2)}</pre>
          {call.result ? <pre>{call.result.text}</pre> : null}
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
    <div>
      {showInput ? (
        <pre>{inputCut ? input.slice(0, MAX_RESULT_CHARS) : input}</pre>
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
              <p>(no output)</p>
            )
          ) : (
            <pre
              style={`padding:8px 10px; white-space:pre-wrap; word-break:break-all; max-height:400px; overflow:auto; color:var(${result.isError ? "--danger" : "--text-muted"})`}
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
    <details style={cardStyle(failed)} data-tool={call.name}>
      <summary>
        <span>{call.name}</span>
        <span>
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
          <span>{String(call.result.seconds)}s</span>
        )}
      </summary>
      <div>
        {deferred === undefined ? (
          <ToolBody call={call} actions={actions} />
        ) : (
          <div
            hx-get={deferred}
            hx-trigger="toggle once from:closest details"
            hx-swap="outerHTML"
          >
            <p>Loading output…</p>
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
    <div>
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
    <article id={`entry-${item.entryId}`} data-role="assistant">
      <div>
        {editable &&
        actions &&
        (starrable || actions.starred.has(item.entryId)) ? (
          <StarButton entryId={item.entryId} actions={actions} />
        ) : null}
        <span>{item.model}</span>
      </div>
      <Blocks item={item} actions={actions} />
      {item.errorMessage === undefined && item.stopReason !== "error" ? null : (
        <div role="alert">
          Error: {item.errorMessage ?? "Unknown provider error"}
        </div>
      )}
      {item.stopReason === "aborted" ? <div>Stopped</div> : null}
      <div>
        {usage === "" ? null : <span>{usage}</span>}
        <Copy text={answerText(item)} />
        {actions && !actions.live ? (
          <HistoryActions entryId={item.entryId} actions={actions} />
        ) : null}
        <span />
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
      <div>{title}</div>
      <ul>
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
  // What it cost and what it left behind. The "after" is Pi's own context
  // build re-run at this entry, so it is an estimate and says so.
  const numbers =
    item.tokensAfter === undefined
      ? `${formatTokens(item.tokensBefore)} tokens before`
      : `${formatTokens(item.tokensBefore)} → ~${formatTokens(item.tokensAfter)} tokens`;
  return (
    <details id={`entry-${item.entryId}`}>
      <summary aria-label={`Conversation compacted: ${numbers}`}>
        Conversation compacted ·{" "}
        <span
          title={
            item.tokensAfter === undefined
              ? "Reported by the model"
              : "The size after compaction is estimated"
          }
        >
          {numbers}
        </span>
      </summary>
      <p>Everything before this point was replaced by the summary below.</p>
      {item.summary === "" ? (
        <p>No summary</p>
      ) : (
        <Markdown source={item.summary} actions={actions} />
      )}
      {files > 0 ? (
        <details>
          <summary>
            File context ({String(item.readFiles.length)} read,{" "}
            {String(item.modifiedFiles.length)} modified)
          </summary>
          <div>
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
    <details id={`entry-${item.entryId}`}>
      <summary>
        <span>{item.customType || "extension"}</span>
        <span>
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
        <p>No message</p>
      ) : (
        <Markdown source={item.text} actions={actions} />
      )}
      <div>
        <Copy text={item.text === "" ? (item.details ?? "") : item.text} />
        {actions ? (
          <HistoryActions entryId={item.entryId} actions={actions} />
        ) : null}
      </div>
      {item.details === undefined ? null : (
        <details>
          <summary>Show details</summary>
          <pre>{item.details}</pre>
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
    <details id={`entry-${item.entryId}`} open style={cardStyle(failed)}>
      <summary>
        <span>{name}</span>
        <span>{item.command}</span>
        {item.pending ? <span aria-label="Running" /> : null}
      </summary>
      <div>
        {item.pending && item.output === "" ? null : <pre>{item.output}</pre>}
        <div>
          {item.truncated && item.outputPath !== undefined && actions ? (
            <>
              <a
                target="_blank"
                rel="noreferrer"
                href={`/sessions/${actions.sessionId}/bash-output?path=${encodeURIComponent(item.outputPath)}`}
              >
                View full output
              </a>
              <a
                href={`/sessions/${actions.sessionId}/bash-output?path=${encodeURIComponent(item.outputPath)}&download=1`}
              >
                Download
              </a>
            </>
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
        <div id={`entry-${item.entryId}`}>
          <p>
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
    <div aria-label="Files changed">
      {files.map((path) => (
        <button
          type="button"

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
        <details open={turn.expanded}>
          <summary>Process details · {label}</summary>
          <div>
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
      class="load-earlier"
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
        }}
      />
      {label === null ? null : <p>{label}</p>}
    </>
  );
}
