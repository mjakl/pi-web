// A drag handle that sets one CSS custom property and remembers it. The file
// panel and the sidebar are the same interaction mirrored, so they are the
// same code: pointer drag, double-click to reset, and arrows for a reader who
// is not holding a mouse.

const KEY_STEP = 12;
const SHIFT_STEP = 32;

export type ResizeHandle = {
  handle: HTMLElement;
  /** localStorage key for the remembered width. */
  storageKey: string;
  /** The custom property the width is written to, on `<html>`. */
  property: string;
  min: number;
  /** The largest width that still leaves the rest of the page usable. */
  max(): number;
  /** Where the width starts, and what a double-click goes back to. */
  fallback(): number;
  /** The width the pointer is asking for, from its position. */
  widthAt(clientX: number): number;
};

export function setUpResize(spec: ResizeHandle, signal: AbortSignal): void {
  const clamp = (width: number): number =>
    Math.min(spec.max(), Math.max(spec.min, Math.round(width)));

  const stored = (): number => {
    try {
      const value = Number(localStorage.getItem(spec.storageKey));
      if (Number.isFinite(value) && value > 0) return value;
    } catch {
      // Storage can be blocked; the default width still works.
    }
    return spec.fallback();
  };

  const apply = (width: number, persist: boolean): void => {
    const clamped = clamp(width);
    document.documentElement.style.setProperty(
      spec.property,
      `${String(clamped)}px`,
    );
    if (!persist) return;
    try {
      localStorage.setItem(spec.storageKey, String(clamped));
    } catch {
      // Without storage the width lasts for this page only.
    }
  };

  const current = (): number => {
    const value = getComputedStyle(document.documentElement).getPropertyValue(
      spec.property,
    );
    const width = Number.parseFloat(value);
    return Number.isFinite(width) ? width : stored();
  };

  apply(stored(), false);

  let pointer: number | null = null;
  const cancel = (): void => {
    if (pointer === null) return;
    if (spec.handle.hasPointerCapture(pointer))
      spec.handle.releasePointerCapture(pointer);
    pointer = null;
  };
  signal.addEventListener("abort", cancel, { once: true });
  spec.handle.addEventListener(
    "pointerdown",
    (event) => {
      pointer = event.pointerId;
      spec.handle.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    { signal },
  );
  spec.handle.addEventListener(
    "pointermove",
    (event) => {
      if (pointer !== null) apply(spec.widthAt(event.clientX), false);
    },
    { signal },
  );
  const release = (event: PointerEvent): void => {
    if (pointer === null || pointer !== event.pointerId) return;
    cancel();
    apply(current(), true);
  };
  spec.handle.addEventListener("pointerup", release, { signal });
  spec.handle.addEventListener("pointercancel", release, { signal });
  spec.handle.addEventListener("blur", cancel, { signal });
  spec.handle.addEventListener(
    "dblclick",
    () => {
      apply(spec.fallback(), true);
    },
    { signal },
  );
  spec.handle.addEventListener(
    "keydown",
    (event) => {
      const step = event.shiftKey ? SHIFT_STEP : KEY_STEP;
      // The handle is on the side the panel grows from, so which arrow widens
      // it is the caller's business: `widthAt` already knows the direction.
      const grow =
        spec.widthAt(0) > spec.widthAt(1) ? "ArrowLeft" : "ArrowRight";
      const width = current();
      if (event.key === grow) apply(width + step, true);
      else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        apply(width - step, true);
      } else if (event.key === "Home") apply(spec.min, true);
      else if (event.key === "End") apply(spec.max(), true);
      else if (event.key === "Enter") apply(spec.fallback(), true);
      else return;
      event.preventDefault();
    },
    { signal },
  );
}
