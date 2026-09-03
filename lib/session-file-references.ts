import type { SessionEntry } from "./types";
import { getSessionEntries, isValidSessionId, resolveSessionPath } from "./session-reader";

/** Whether `sessionId` is a readable session whose persisted entries satisfy `isReferencedByEntries` for `filePath`. */
export async function isReferencedBySession(
  filePath: string,
  sessionId: string | null,
  isReferencedByEntries: (filePath: string, entries: SessionEntry[]) => boolean,
): Promise<boolean> {
  if (!isValidSessionId(sessionId)) return false;
  try {
    const sessionPath = await resolveSessionPath(sessionId);
    if (!sessionPath) return false;
    return isReferencedByEntries(filePath, getSessionEntries(sessionPath));
  } catch {
    return false;
  }
}
