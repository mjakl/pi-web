// The conversation rail's browser half: which mark the reader is next to,
// the hover preview, and click-or-drag to scroll. Positions and marks come
// from the server; this only measures the transcript.

/** Where a jumped-to entry lands, as a fraction of the visible height. */
const TARGET = 0.3;
/** How long the clicked mark stays lit after a jump. */
const LOCK_MS = 1600;
const HOVER_MS = 180;

type Htmx = {
  ajax(verb: string, path: string, context: unknown): Promise<void>;
};

function htmx(): Htmx | undefined {
  return (globalThis as { htmx?: Htmx }).htmx;
}

function marks(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("#rail .rail-mark")];
}

/**
 * The mark closest to a position. `at` says where a mark sits on the axis in
 * question — the transcript's scroll height while tracking, the pointer's own
 * Y while dragging — and returns null for a mark that does not take part.
 */
function nearestMark(
  target: number,
  at: (mark: HTMLElement) => number | null,
): HTMLElement | undefined {
  let best: HTMLElement | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const mark of marks()) {
    const position = at(mark);
    if (position === null) continue;
    const distance = Math.abs(position - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = mark;
    }
  }
  return best;
}

function entryOf(mark: HTMLElement): HTMLElement | null {
  const id = mark.dataset["entryId"];
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

  let lockedUntil = 0;
  let current: HTMLElement | undefined;

  const light = (mark: HTMLElement | undefined) => {
    if (mark === current) return;
    current?.classList.remove("is-current");
    mark?.classList.add("is-current");
    current = mark;
  };

  /** The mark whose message sits nearest the reading line. */
  const track = () => {
    if (Date.now() < lockedUntil) return;
    light(
      nearestMark(view.scrollTop + view.clientHeight * TARGET, (mark) => {
        const entry = entryOf(mark);
        return entry === null ? null : topOf(view, entry);
      }),
    );
  };

  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      track();
    });
  };
  view.addEventListener("scroll", schedule, { passive: true });
  document.body.addEventListener("htmx:afterSwap", schedule);

  const smooth = () =>
    matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

  /**
   * Jump to a mark. An entry the page has not loaded yet is fetched through
   * the "load earlier" sentinel first, which is what `through=` exists for.
   */
  const jump = (mark: HTMLElement, behavior: ScrollBehavior) => {
    lockedUntil = Date.now() + LOCK_MS;
    light(mark);
    const entry = entryOf(mark);
    if (entry) {
      view.scrollTo({
        top: topOf(view, entry) - view.clientHeight * TARGET,
        behavior,
      });
      return;
    }
    const sentinel = view.querySelector<HTMLElement>(".load-earlier");
    const url = sentinel?.getAttribute("hx-get");
    const id = mark.dataset["entryId"];
    if (!sentinel || url === undefined || url === null || id === undefined) {
      return;
    }
    const through = `${url}&through=${encodeURIComponent(id)}`;
    void htmx()
      ?.ajax("GET", through, { target: sentinel, swap: "outerHTML" })
      .then(() => {
        const loaded = entryOf(mark);
        if (loaded) {
          view.scrollTo({
            top: topOf(view, loaded) - view.clientHeight * TARGET,
            behavior: "auto",
          });
          lockedUntil = Date.now() + LOCK_MS;
        }
      });
  };

  // Pressing anywhere in the column jumps to the nearest mark and starts a
  // drag; a mark on another branch is left to htmx, which posts /navigate.
  let dragging = false;
  const follow = (clientY: number, behavior: ScrollBehavior) => {
    const best = nearestMark(clientY, (mark) => {
      if (mark.dataset["branch"] !== undefined) return null;
      const box = mark.getBoundingClientRect();
      return box.top + box.height / 2;
    });
    if (best) jump(best, behavior);
  };
  rail.addEventListener("pointerdown", (event) => {
    const target = event.target as HTMLElement;
    if (event.button !== 0 || target.closest("[data-branch]")) return;
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

  setUpPreview(rail);
  schedule();
}

/** The hover popover: 100 characters of the prompt, after a short delay. */
function setUpPreview(rail: HTMLElement): void {
  const popover = document.createElement("div");
  popover.className = "rail-preview";
  popover.hidden = true;
  popover.setAttribute("role", "tooltip");
  document.body.append(popover);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const hide = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    popover.hidden = true;
  };
  const show = (mark: HTMLElement) => {
    const text = mark.dataset["preview"];
    if (text === undefined || text === "") return;
    popover.textContent = text;
    popover.hidden = false;
    const box = mark.getBoundingClientRect();
    const own = popover.getBoundingClientRect();
    popover.style.left = `${String(Math.max(8, box.left - own.width - 10))}px`;
    popover.style.top = `${String(
      Math.min(
        Math.max(8, box.top + box.height / 2 - own.height / 2),
        innerHeight - own.height - 8,
      ),
    )}px`;
  };
  const over = (event: Event) => {
    const mark = (event.target as HTMLElement).closest<HTMLElement>(
      ".rail-mark",
    );
    hide();
    if (!mark) return;
    timer = setTimeout(() => {
      show(mark);
    }, HOVER_MS);
  };
  rail.addEventListener("pointerover", over);
  rail.addEventListener("focusin", over);
  rail.addEventListener("pointerleave", hide);
  rail.addEventListener("focusout", hide);
  addEventListener("scroll", hide, { passive: true, capture: true });
}
