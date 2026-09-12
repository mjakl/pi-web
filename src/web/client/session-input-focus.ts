// Navigation owns the request; composer mounting only supplies the ready input.
let pending: object | undefined;
let initialized = false;

export function cancelSessionInputFocus(): void {
  pending = undefined;
}

export function requestSessionInputFocus(): void {
  pending = {};
}

export function setUpSessionInputFocus(): void {
  if (initialized) return;
  initialized = true;
  if (!document.activeElement || document.activeElement === document.body)
    requestSessionInputFocus();
  // Capture runs before the click/submit handler admits a new navigation, so
  // its initiating interaction cancels the old request, not the new one.
  for (const name of ["pointerdown", "keydown", "focusin", "focusout"])
    document.addEventListener(name, cancelSessionInputFocus, true);
  addEventListener("blur", cancelSessionInputFocus);
  addEventListener("pagehide", cancelSessionInputFocus);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelSessionInputFocus();
  });
}

export function focusSessionInput(
  area: HTMLTextAreaElement | null,
  signal: AbortSignal,
): void {
  const request = pending;
  if (!request) return;
  const frame = requestAnimationFrame(() => {
    if (pending !== request) return;
    cancelSessionInputFocus();
    if (
      signal.aborted ||
      !area?.isConnected ||
      area.disabled ||
      area.readOnly ||
      area.closest("[hidden], [inert]") ||
      document.hidden ||
      document.querySelector(
        'dialog[open], [role="dialog"][aria-modal="true"]',
      ) ||
      matchMedia("(max-width: 640px), (pointer: coarse)").matches
    )
      return;
    area.focus({ preventScroll: true });
    area.setSelectionRange(area.value.length, area.value.length);
  });
  signal.addEventListener(
    "abort",
    () => {
      cancelAnimationFrame(frame);
      if (pending === request) cancelSessionInputFocus();
    },
    { once: true },
  );
}
