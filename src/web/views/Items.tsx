import { formatTokens } from "@core/context-usage";
import type { ToolCallView, TranscriptItem } from "@core/transcript";
import { renderMarkdown } from "@web/markdown";
import { raw } from "hono/html";

function Markdown({ source }: { source: string }) {
  return <div class="prose max-w-none">{raw(renderMarkdown(source))}</div>;
}

function ToolCall({ call }: { call: ToolCallView }) {
  const args = JSON.stringify(call.arguments, null, 2);
  const result = call.result;
  return (
    <details class="collapse-arrow collapse my-2 bg-base-200 text-sm">
      <summary class="collapse-title min-h-0 py-2 font-mono">
        {call.name}
        {result ? (
          <span
            class={result.isError ? "ml-2 text-error" : "ml-2 text-success"}
          >
            {result.isError ? "failed" : "done"}
          </span>
        ) : (
          <span class="ml-2 text-base-content/60">no result yet</span>
        )}
      </summary>
      <div class="collapse-content">
        <pre class="overflow-x-auto text-xs whitespace-pre-wrap">{args}</pre>
        {result ? (
          <pre class="mt-2 max-h-96 overflow-auto text-xs whitespace-pre-wrap">
            {result.text}
          </pre>
        ) : null}
      </div>
    </details>
  );
}

/** What the transcript may do to the session it belongs to. */
export type ItemActions = {
  sessionId: string;
  starred: Set<string>;
  /** Set while another branch is being viewed: nothing may be changed. */
  readOnly?: boolean;
};

function MessageActions({
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
  };
  return (
    <div class="mt-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
      <button
        class="btn btn-ghost btn-xs"
        title="Continue from this point within this session"
        hx-post={post("navigate")}
        {...swap}
      >
        New branch
      </button>
      <button
        class="btn btn-ghost btn-xs"
        title="Copy the history up to this point into a separate session"
        hx-post={post("fork")}
        {...swap}
      >
        New session
      </button>
      <button
        class="btn btn-ghost text-error btn-xs"
        title="Remove this message and everything after it, then edit it again"
        hx-post={post("rewind")}
        hx-confirm="Remove this message and all later history?"
        {...swap}
      >
        Rewind
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

export function Item({
  item,
  actions,
}: {
  item: TranscriptItem;
  actions?: ItemActions;
}) {
  const editable = actions && !actions.readOnly;
  switch (item.kind) {
    case "user":
      return (
        <article
          id={`entry-${item.entryId}`}
          class="group my-3 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3"
        >
          <div class="whitespace-pre-wrap">{item.text}</div>
          {item.imageCount > 0 ? (
            <div class="mt-1 text-xs text-base-content/60">
              {String(item.imageCount)} image(s)
            </div>
          ) : null}
          {editable && actions ? (
            <MessageActions entryId={item.entryId} actions={actions} />
          ) : null}
        </article>
      );
    case "assistant":
      return (
        <article id={`entry-${item.entryId}`} class="my-3 px-1">
          {item.thinking ? (
            <details class="my-2 text-sm text-base-content/70">
              <summary class="cursor-pointer">Thinking</summary>
              <div class="whitespace-pre-wrap">{item.thinking}</div>
            </details>
          ) : null}
          {item.text ? <Markdown source={item.text} /> : null}
          {item.toolCalls.map((call) => (
            <ToolCall call={call} />
          ))}
          {item.errorMessage ? (
            <div class="my-2 alert text-sm alert-error">
              {item.errorMessage}
            </div>
          ) : null}
          {item.stopReason === "aborted" ? (
            <div class="text-xs text-base-content/60">Stopped</div>
          ) : null}
          <div class="mt-1 flex items-center gap-2 text-xs text-base-content/50">
            {item.usage ? (
              <span>
                {item.model} · {formatTokens(item.usage.total)} tokens in
                context
              </span>
            ) : null}
            {editable && actions && item.entryId !== "partial" ? (
              <StarButton entryId={item.entryId} actions={actions} />
            ) : null}
          </div>
        </article>
      );
    case "compaction":
      return (
        <details
          id={`entry-${item.entryId}`}
          class="my-3 rounded-lg border border-dashed border-warning/50 px-4 py-2 text-sm"
        >
          <summary class="cursor-pointer">
            Context compacted ({formatTokens(item.tokensBefore)} tokens before)
          </summary>
          <Markdown source={item.summary} />
        </details>
      );
    case "branch_summary":
      return (
        <details
          id={`entry-${item.entryId}`}
          class="my-3 rounded-lg border border-dashed border-info/50 px-4 py-2 text-sm"
        >
          <summary class="cursor-pointer">Branch summary</summary>
          <Markdown source={item.summary} />
        </details>
      );
    case "note":
      return (
        <article
          id={`entry-${item.entryId}`}
          class="my-3 rounded-lg bg-base-200 px-4 py-2 font-mono text-xs whitespace-pre-wrap"
        >
          <div class="mb-1 text-base-content/60">{item.customType}</div>
          {item.text}
        </article>
      );
    default:
      return null;
  }
}

export function Items({
  items,
  actions,
}: {
  items: TranscriptItem[];
  actions?: ItemActions;
}) {
  return (
    <>
      {items.map((item) => (
        <Item item={item} actions={actions} />
      ))}
    </>
  );
}
