import {
  type DiffCell,
  type DiffFile,
  parseUnifiedPatch,
  patchLines,
} from "@core/patch";
import type { ToolCallView } from "@core/transcript";
import { isEditToolName, toolFilePath } from "@core/turns";
import { CardChevronIcon } from "@web/views/icons";
import { Images, type ItemActions } from "./shared.tsx";
import { Subagent } from "./subagent.tsx";

// pi-web's tool card and its body: arguments, output, and the split diff
// of an edit, cut to a budget with a button that fetches the whole.

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
    <div class="tool-result" hx-morph-skip={result ? true : undefined}>
      {/* A completed result is immutable. Keep fetched full output and its DOM
          resources when the enclosing live message morphs. */}
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

export function ToolCard({
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
      id={`tool-${encodeURIComponent(call.id)}`}
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
