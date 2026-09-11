import { ansiToHtml, statusLine, stripAnsi } from "@core/ansi";
import type { ExtensionWidget, LiveStatus } from "@core/ports";
import { raw } from "hono/html";

// The extension shelf below the composer: one status line and a chip per
// widget, with at most one panel open. Extensions write for a terminal, so
// every string here goes through the ANSI converter, which escapes as it goes.

/** A widget with two or three lines is small enough to show unasked. */
const DEFAULT_EXPANDED_LINES = 3;

function Chip({
  widget,
  updated,
}: {
  widget: ExtensionWidget;
  updated: boolean;
}) {
  return (
    <>
      <span aria-hidden="true">
        {widget.placement === "aboveEditor" ? "▲" : "▼"}
      </span>
      <span>{widget.key}</span>
      {updated ? <span class="widget-pulse" aria-hidden="true" /> : null}
    </>
  );
}

export function ShelfBody({
  status,
  updated,
}: {
  status: LiveStatus | null;
  updated?: readonly string[];
}) {
  if (!status) return <></>;
  const line = statusLine(status.statuses);
  const { widgets } = status;
  if (line === "" && widgets.length === 0) return <></>;
  const changed = new Set(updated ?? []);
  const expanded = widgets.find(
    (widget) =>
      widget.lines.length >= 2 && widget.lines.length <= DEFAULT_EXPANDED_LINES,
  )?.key;
  return (
    <div>
      {line === "" ? null : (
        <p
          class="extension-status"
          role="status"
          title={stripAnsi(line)}
          aria-label={stripAnsi(line)}
        >
          {raw(ansiToHtml(line))}
        </p>
      )}
      {widgets.length === 0 ? null : (
        <div class="shelf-chips">
          {widgets.map((widget) =>
            widget.lines.length === 0 ? (
              <div>
                <Chip widget={widget} updated={changed.has(widget.key)} />
              </div>
            ) : (
              <details
                name="extension-widget"
                class="widget"
                open={widget.key === expanded}
              >
                <summary>
                  <Chip widget={widget} updated={changed.has(widget.key)} />
                </summary>
                <div class="widget-panel">
                  <div>{widget.key}</div>
                  <pre>{raw(ansiToHtml(widget.lines.join("\n")))}</pre>
                </div>
              </details>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/** What the shelf currently shows, so the stream only re-sends real changes. */
export function shelfSignature(status: LiveStatus | null): string {
  if (!status) return "";
  return JSON.stringify([status.statuses, status.widgets]);
}

/** Widget keys whose lines differ from the previous render. */
export function changedWidgets(
  previous: Map<string, string>,
  status: LiveStatus | null,
): string[] {
  const changed: string[] = [];
  for (const widget of status?.widgets ?? []) {
    const lines = widget.lines.join("\n");
    if (previous.has(widget.key) && previous.get(widget.key) !== lines) {
      changed.push(widget.key);
    }
    previous.set(widget.key, lines);
  }
  const keys = new Set((status?.widgets ?? []).map((widget) => widget.key));
  for (const key of [...previous.keys()]) {
    if (!keys.has(key)) previous.delete(key);
  }
  return changed;
}

export function Shelf({ status }: { status: LiveStatus | null }) {
  return (
    <div id="shelf" sse-swap="shelf" hx-swap="innerHTML">
      <ShelfBody status={status} />
    </div>
  );
}
