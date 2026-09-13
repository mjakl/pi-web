import { formatCompactCount } from "@core/context-usage";
import type { BashItem, CompactionItem, NoteItem } from "@core/transcript";
import { CardChevronIcon, CompactIcon } from "@web/views/icons";
import {
  CopyButton,
  formatTimestamp,
  Images,
  type ItemActions,
  Markdown,
} from "./shared.tsx";

// The cards between questions and answers: a compaction marker, an
// extension's custom message, and a `!` shell run.

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

export function Compaction({
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

export function Note({
  item,
  actions,
}: {
  item: NoteItem;
  actions?: ItemActions;
}) {
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
export function Bash({
  item,
  actions,
}: {
  item: BashItem;
  actions?: ItemActions;
}) {
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
