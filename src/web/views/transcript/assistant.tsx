import type { AssistantBlock, AssistantItem } from "@core/transcript";
import { CardChevronIcon, FileIcon, TokenArrowIcon } from "@web/views/icons";
import {
  CopyButton,
  HistoryActionFrame,
  Images,
  type ItemActions,
  Markdown,
  StarButton,
  Time,
} from "./shared.tsx";
import { ToolCard } from "./tools.tsx";

// pi-web's assistant message: the model header with the streaming
// estimate, the blocks (text, thinking, images, tool cards), errors, the
// files the turn wrote, and the usage line.

function ThinkingBlock({
  item,
  block,
  actions,
}: {
  item: AssistantItem;
  block: Extract<AssistantBlock, { kind: "thinking" }>;
  actions?: ItemActions;
}) {
  if (!block.deferred && block.text.trim() === "") {
    return item.entryId === "partial" && actions?.streaming ? (
      <div class="chat-activity">
        <span class="chat-activity-label">Thinking</span>
      </div>
    ) : null;
  }
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
            return <ToolCard call={block.call} actions={actions} />;
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

export function AssistantMessage({
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
  const userFacing = item.blocks.some(
    (block) =>
      block.kind === "image" ||
      (block.kind === "text" && block.text.trim() !== ""),
  );
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
    <HistoryActionFrame
      entryId={item.entryId}
      actions={userFacing ? actions : undefined}
      copyText={streaming ? undefined : answerText(item)}
    >
      <div
        class="message-row"
        {...(item.processHalf
          ? {}
          : {
              // Pi assigns the persisted entry ID at message_end. Until then the
              // message's own timestamp distinguishes successive partial messages.
              id:
                item.entryId === "partial"
                  ? `entry-partial-${String(Date.parse(item.timestamp))}`
                  : `entry-${item.entryId}`,
            })}
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
        {item.errorMessage === undefined &&
        item.stopReason !== "error" ? null : (
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
          {streaming || editable ? null : (
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
    </HistoryActionFrame>
  );
}

/** The files a turn wrote, under its answer. Clicking one opens the viewer. */
export function WrittenFiles({
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
