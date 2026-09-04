/**
 * Page size for GET /api/sessions/[id]. The client mirrors these so a reload
 * after a turn can ask for what is already on screen instead of snapping back
 * to the newest page and discarding history the user paged in.
 */
export const SESSION_TAIL_DEFAULT = 50;
export const SESSION_TAIL_MAX = 1000;

/**
 * Tail size a snapshot reload should request, or null when the server default
 * already covers what is loaded.
 */
export function getSnapshotTail(loadedCount: number): number | null {
  if (loadedCount <= SESSION_TAIL_DEFAULT) return null;
  return Math.min(loadedCount, SESSION_TAIL_MAX);
}

export const CHAT_SCROLL_TAIL_TOLERANCE = 8;

export function captureScrollDistance(scrollHeight: number, scrollTop: number): number {
  return scrollHeight - scrollTop;
}

export function restoreScrollTop(scrollHeight: number, savedDistance: number): number {
  return Math.max(0, scrollHeight - savedDistance);
}

export function isScrollAtTail(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  tolerance = CHAT_SCROLL_TAIL_TOLERANCE,
): boolean {
  return scrollTop + clientHeight >= scrollHeight - tolerance;
}

export function getLiveFollowAttached(
  wasAttached: boolean,
  previousScrollTop: number,
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
): boolean {
  if (isScrollAtTail(scrollTop, clientHeight, scrollHeight)) return true;
  if (scrollTop < previousScrollTop) return false;
  return wasAttached;
}
