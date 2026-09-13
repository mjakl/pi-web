import type { ToolCallView } from "@core/transcript";
import type { ItemActions } from "./shared.tsx";

export function toolResultUrl(call: ToolCallView, actions?: ItemActions) {
  return actions && call.result
    ? `/sessions/${actions.sessionId}/entries/${call.result.entryId}/tool-result/${encodeURIComponent(call.id)}`
    : undefined;
}

/** Also load when a running card completes while already open. Preserve the
 * placeholder during morphs so an in-flight request keeps its source node. */
export function DeferredToolBody({
  url,
  failed = false,
}: {
  url: string;
  failed?: boolean;
}) {
  return (
    <div
      class="tool-result"
      hx-morph-skip
      hx-get={url}
      hx-trigger="load[this.closest('details').open], toggle[this.closest('details').open] from:<closest details/>"
      hx-sync="this:drop"
      hx-swap="outerHTML"
    >
      <pre
        style={`margin:0; padding:8px 10px; color:var(--text-dim); font-size:12px; line-height:1.5; background:var(--bg-subtle); border-top:1px solid ${failed ? "rgba(248,113,113,0.25)" : "rgba(34,197,94,0.2)"}`}
      >
        Loading output…
      </pre>
    </div>
  );
}
