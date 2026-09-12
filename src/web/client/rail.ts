import type { Htmx } from "htmx.org";
// The conversation rail's browser half: which mark the reader is next to,
// the hover preview, click-or-drag to scroll, and the branch expansion.
// Positions and marks come from the server; this only measures the transcript.

/** Where a jumped-to entry lands, as a fraction of the visible height. */
const TARGET = 0.3;
/** How long the clicked mark stays lit after a jump. */
const LOCK_MS = 1600;
/** pi-web shows the preview 180ms after the pointer reaches a mark. */
const HOVER_MS = 180;
/** pi-web's MINIMAP_WIDTH: past it the pointer is in the branch graph. */
const RAIL_WIDTH = 36;

function htmx(): Htmx | undefined {
  return (globalThis as { htmx?: Htmx }).htmx;
}

/** The marks on the branch being read, in transcript order. */
function rows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("#rail .minimap-row")];
}

/**
 * The mark closest to a position. `at` says where a mark sits on the axis in
 * question — the transcript's scroll height while tracking, the pointer's own
 * Y while dragging — and returns null for a mark that does not take part.
 */
function nearestRow(
  target: number,
  at: (row: HTMLElement) => number | null,
): HTMLElement | undefined {
  let best: HTMLElement | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const row of rows()) {
    const position = at(row);
    if (position === null) continue;
    const distance = Math.abs(position - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = row;
    }
  }
  return best;
}

function entryOf(row: HTMLElement): HTMLElement | null {
  const id = row.dataset["minimapEntryId"];
  return id === undefined ? null : document.getElementById(`entry-${id}`);
}

/** Distance from the top of the scroller, whatever the offset parents are. */
function topOf(view: HTMLElement, element: HTMLElement): number {
  return (
    element.getBoundingClientRect().top -
    view.getBoundingClientRect().top +
    view.scrollTop
  );
}

export function setUpRail(): void {
  const view = document.getElementById("log");
  // The column stays put; the rail inside it is re-rendered from the server
  // whenever a turn settles, so every listener lives on the column.
  const rail = document.getElementById("rail-column");
  if (!view || !rail) return;
  const chatWindow = rail.closest<HTMLElement>(".chat-window");

  let lockedUntil = 0;
  let current: HTMLElement | undefined;
  let near: HTMLElement | undefined;

  const light = (row: HTMLElement | undefined) => {
    if (row === current) return;
    current?.classList.remove("is-active");
    row?.classList.add("is-active");
    current = row;
  };

  /** The mark whose message sits nearest the reading line. */
  const track = () => {
    if (Date.now() < lockedUntil) return;
    light(
      nearestRow(view.scrollTop + view.clientHeight * TARGET, (row) => {
        const entry = entryOf(row);
        return entry === null ? null : topOf(view, entry);
      }),
    );
  };

  /**
   * pi-web widens the rail to the branch graph while it is hovered or
   * focused, and the chat window reads the width back for its grid column.
   * The width is inline there too, so it has to be inline here.
   */
  const expand = (open: boolean) => {
    const layer = document.getElementById("rail");
    if (!layer || layer.dataset["branched"] !== "true") return;
    const width = layer.dataset["graphWidth"] ?? "36";
    rail.classList.add("has-branches");
    rail.tabIndex = 0;
    rail.classList.toggle("is-expanded", open);
    chatWindow?.style.setProperty(
      "--expanded-conversation-rail-width",
      `${width}px`,
    );
    rail.style.width = open ? `${width}px` : "36px";
    rail.style.maxWidth = open ? "100%" : "";
    rail.style.overflow = open ? "auto" : "visible";
    if (!open) rail.scrollLeft = 0;
  };

  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      track();
      expand(rail.classList.contains("is-expanded"));
    });
  };
  view.addEventListener("scroll", schedule, { passive: true });
  document.body.addEventListener("htmx:after:settle", schedule);
  // Opening a disclosure in the transcript moves the messages without a
  // scroll or a swap, so the reading line ends up beside a different mark.
  // pi-web watches the same two boxes (ChatMinimap.tsx, ResizeObserver).
  const resize = new ResizeObserver(schedule);
  resize.observe(view);
  if (view.firstElementChild) resize.observe(view.firstElementChild);

  const smooth = () =>
    matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

  /**
   * Jump to a mark. An entry the page has not loaded yet is fetched through
   * the "load earlier" sentinel first, which is what `through=` exists for.
   */
  const jump = (row: HTMLElement, behavior: ScrollBehavior) => {
    lockedUntil = Date.now() + LOCK_MS;
    light(row);
    const entry = entryOf(row);
    if (entry) {
      view.scrollTo({
        top: topOf(view, entry) - view.clientHeight * TARGET,
        behavior,
      });
      return;
    }
    const sentinel = view.querySelector<HTMLElement>(".chat-load-earlier");
    const url = sentinel?.getAttribute("hx-get");
    const id = row.dataset["minimapEntryId"];
    if (!sentinel || url === undefined || url === null || id === undefined) {
      return;
    }
    const through = `${url}&through=${encodeURIComponent(id)}`;
    void htmx()
      ?.ajax("GET", through, { target: sentinel, swap: "outerHTML" })
      .then(() => {
        const loaded = entryOf(row);
        if (loaded) {
          view.scrollTo({
            top: topOf(view, loaded) - view.clientHeight * TARGET,
            behavior: "auto",
          });
          lockedUntil = Date.now() + LOCK_MS;
        }
      });
  };

  /**
   * True unless the pointer is over the branch graph beside the 36px strip.
   * An unbranched rail has no graph, so pi-web skips the test there and
   * treats the whole width as the strip.
   */
  const onStrip = (clientX: number) =>
    !rail.classList.contains("has-branches") ||
    clientX - rail.getBoundingClientRect().left + rail.scrollLeft <= RAIL_WIDTH;

  // Pressing anywhere in the strip jumps to the nearest mark and starts a
  // drag; a mark on another branch is left to htmx, which posts /navigate.
  let dragging = false;
  const follow = (clientY: number, behavior: ScrollBehavior) => {
    const best = nearestRow(clientY, (row) => {
      const box = row.getBoundingClientRect();
      return box.top + box.height / 2;
    });
    if (best) jump(best, behavior);
  };
  rail.addEventListener("pointerdown", (event) => {
    const target = event.target as HTMLElement;
    if (event.button !== 0 || target.closest("[data-branch]")) return;
    if (!onStrip(event.clientX)) return;
    dragging = true;
    follow(event.clientY, smooth());
    try {
      rail.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that is no longer active cannot be captured; the press
      // still counts as a jump.
    }
  });
  rail.addEventListener("pointermove", (event) => {
    if (dragging) follow(event.clientY, "auto");
  });
  const release = (event: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    if (rail.hasPointerCapture(event.pointerId)) {
      rail.releasePointerCapture(event.pointerId);
    }
  };
  rail.addEventListener("pointerup", release);
  rail.addEventListener("pointercancel", release);

  rail.addEventListener("pointerenter", () => {
    expand(true);
  });
  rail.addEventListener("focusin", () => {
    expand(true);
  });
  rail.addEventListener("pointerleave", () => {
    expand(false);
  });
  rail.addEventListener("focusout", (event) => {
    if (!rail.contains(event.relatedTarget as Node | null)) expand(false);
  });

  const preview = setUpPreview();
  /** pi-web enlarges the mark nearest the pointer, and previews that one. */
  const hover = (row: HTMLElement | undefined) => {
    if (row === near) return;
    near?.classList.remove("is-near");
    row?.classList.add("is-near");
    near = row;
    preview(row);
  };
  rail.addEventListener("pointermove", (event) => {
    // pi-web previews a branch mark from the mark itself, so the whole
    // expanded rail is a hover target, not just the 36px strip.
    const branch = (event.target as HTMLElement).closest<HTMLElement>(
      ".minimap-branch",
    );
    if (branch) {
      hover(branch);
      return;
    }
    if (!onStrip(event.clientX)) {
      hover(undefined);
      return;
    }
    hover(
      nearestRow(event.clientY, (row) => {
        const box = row.getBoundingClientRect();
        return box.top + box.height / 2;
      }),
    );
  });
  rail.addEventListener("pointerleave", () => {
    hover(undefined);
  });

  expand(false);
  schedule();
}

/**
 * pi-web's MessagePreviewPopover: the prompt's first 100 characters, left of
 * the mark, with the arrow pointing back at it.
 */
function setUpPreview(): (row: HTMLElement | undefined) => void {
  const popover = document.createElement("div");
  popover.className = "message-preview-popover";
  popover.hidden = true;
  popover.setAttribute("role", "tooltip");
  const text = document.createElement("span");
  const arrow = document.createElement("span");
  arrow.className = "message-preview-arrow";
  arrow.setAttribute("aria-hidden", "true");
  popover.append(text, arrow);
  document.body.append(popover);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const place = (anchor: HTMLElement) => {
    const target = anchor.getBoundingClientRect();
    const bounds = popover.getBoundingClientRect();
    const centre = target.top + target.height / 2;
    const top = Math.max(
      8,
      Math.min(centre - bounds.height / 2, innerHeight - bounds.height - 8),
    );
    popover.style.left = `${String(
      Math.max(
        8,
        Math.min(
          target.left - bounds.width - 10,
          innerWidth - bounds.width - 8,
        ),
      ),
    )}px`;
    popover.style.top = `${String(top)}px`;
    arrow.style.top = `${String(Math.max(8, Math.min(centre - top, bounds.height - 8)))}px`;
  };

  addEventListener(
    "scroll",
    () => {
      popover.hidden = true;
    },
    { passive: true, capture: true },
  );

  return (row) => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    popover.hidden = true;
    const mark =
      row?.matches("[data-preview]") === true
        ? row
        : row?.querySelector<HTMLElement>("[data-preview]");
    const message = mark?.dataset["preview"];
    if (!mark || message === undefined || message === "") return;
    timer = setTimeout(() => {
      text.textContent = message;
      popover.hidden = false;
      place(mark);
    }, HOVER_MS);
  };
}
