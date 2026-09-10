import type { RailMark } from "@core/conversation-rail";
import type { SessionView } from "@core/workspace";

// The conversation rail: a fixed column right of the transcript with one mark
// per prompt, star, and compaction. Positions are percentages of the rail's
// own height, so the server needs no measurement of the browser's viewport;
// src/web/client/rail.ts only tracks the scroll position and the popover.

/** Horizontal distance between two branch lanes, in pixels. */
const LANE = 18;
/** Room kept free at the top, and at the bottom for the jump button. */
const TOP = 12;
const BOTTOM = 30;

/** Where a row sits: the same expression the connector layer is sized with. */
function offset(row: number, rows: number): string {
  const fraction = rows === 0 ? 0 : row / rows;
  return `calc(${String(TOP)}px + (100% - ${String(TOP + BOTTOM)}px) * ${String(fraction)})`;
}

function Mark({
  mark,
  rows,
  sessionId,
}: {
  mark: RailMark;
  rows: number;
  sessionId: string;
}) {
  const label =
    mark.kind === "compaction"
      ? "Conversation compacted"
      : mark.kind === "star"
        ? "Jump to starred answer"
        : (mark.preview ?? "Jump to this message");
  return (
    <button
      type="button"
      class={`rail-mark rail-${mark.kind}${mark.active ? " is-active" : ""}`}
      style={`top:${offset(mark.row, rows)};left:${String(mark.lane * LANE)}px`}
      data-entry-id={mark.id}
      data-leaf-id={mark.targetLeafId}
      {...(mark.active ? {} : { "data-branch": "true" })}
      {...(mark.preview === undefined ? {} : { "data-preview": mark.preview })}
      aria-label={label}
      {...(mark.active
        ? {}
        : {
            "hx-post": `/sessions/${sessionId}/navigate`,
            "hx-vals": JSON.stringify({ entryId: mark.targetLeafId }),
            "hx-target": "body",
            "hx-swap": "innerHTML",
            "hx-indicator": "#branch-sync",
          })}
    />
  );
}

/** Cubic connectors between a mark and its nearest kept ancestor. */
function Links({ marks, rows }: { marks: RailMark[]; rows: number }) {
  const byId = new Map(marks.map((mark) => [mark.id, mark]));
  const lanes = Math.max(...marks.map((mark) => mark.lane), 0);
  const width = lanes * LANE + LANE;
  return (
    <svg
      class="rail-links"
      viewBox={`0 0 ${String(width)} ${String(Math.max(rows, 1))}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {marks.map((mark) => {
        const parent =
          mark.parentId === null ? undefined : byId.get(mark.parentId);
        if (!parent) return null;
        const x1 = parent.lane * LANE + LANE / 2;
        const x2 = mark.lane * LANE + LANE / 2;
        const y1 = parent.row;
        const y2 = mark.row;
        const mid = (y1 + y2) / 2;
        return (
          <path
            class={mark.active && parent.active ? "is-active" : ""}
            d={`M${String(x1)},${String(y1)} C${String(x1)},${String(mid)} ${String(x2)},${String(mid)} ${String(x2)},${String(y2)}`}
            fill="none"
            vector-effect="non-scaling-stroke"
          />
        );
      })}
    </svg>
  );
}

/**
 * Re-rendered from the server whenever a turn settles: the marks come from
 * the session's entries, so nothing about them depends on which page of the
 * transcript the browser currently holds.
 */
export function Rail({ view, oob }: { view: SessionView; oob?: boolean }) {
  const marks = view.rail;
  const rows = Math.max(...marks.map((mark) => mark.row), 0);
  const lanes = Math.max(...marks.map((mark) => mark.lane), 0);
  return (
    <div
      id="rail"
      class="rail"
      style={`--rail-lanes:${String(lanes + 1)}`}
      data-branched={view.branched ? "true" : "false"}
      aria-label="Conversation"
      {...(oob ? { "hx-swap-oob": "true" } : {})}
    >
      {marks.length < 2 ? null : (
        <>
          {view.branched ? <Links marks={marks} rows={rows} /> : null}
          {marks.map((mark) => (
            <Mark mark={mark} rows={rows} sessionId={view.summary.id} />
          ))}
        </>
      )}
    </div>
  );
}
