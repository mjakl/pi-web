export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Browser localStorage, or null on the server and when access is blocked. */
export function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
