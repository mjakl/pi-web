import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { AgentMessage, SessionContext } from "./types";
import { isMessageGroupAnchor } from "./message-display";
import { getMessagePreview } from "./message-preview";

export const SESSION_STAR_TYPE = "pi-web:star";

export function parseSessionStar(
  entry: unknown,
): { targetId: string; starred: boolean } | null {
  if (!entry || typeof entry !== "object") return null;
  const candidate = entry as {
    type?: unknown;
    customType?: unknown;
    data?: unknown;
  };
  if (
    candidate.type !== "custom" ||
    candidate.customType !== SESSION_STAR_TYPE ||
    !candidate.data ||
    typeof candidate.data !== "object"
  )
    return null;
  const data = candidate.data as { targetId?: unknown; starred?: unknown };
  return typeof data.targetId === "string" && typeof data.starred === "boolean"
    ? { targetId: data.targetId, starred: data.starred }
    : null;
}

/** Resolve session-wide annotations, including changes made from another branch. */
export function readSessionStars(entries: readonly unknown[]): string[] {
  const stars = new Set<string>();
  const answers = new Set<string>();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as {
      id?: unknown;
      type?: unknown;
      message?: { role?: unknown };
    };
    if (
      candidate.type === "message" &&
      candidate.message?.role === "assistant" &&
      typeof candidate.id === "string"
    )
      answers.add(candidate.id);
    const star = parseSessionStar(entry);
    if (star?.starred) stars.add(star.targetId);
    else if (star) stars.delete(star.targetId);
  }
  return [...stars].filter((id) => answers.has(id));
}

export function setSessionStar(
  manager: SessionManager,
  targetId: string,
  starred: boolean,
): string[] {
  const entry = manager.getEntry(targetId);
  if (entry?.type !== "message" || entry.message.role !== "assistant")
    throw new Error("Star target must be an assistant answer");
  const stars = readSessionStars(manager.getEntries());
  if (stars.includes(targetId) !== starred)
    manager.appendCustomEntry(SESSION_STAR_TYPE, { targetId, starred });
  return readSessionStars(manager.getEntries());
}

/** Clear stars across the entire session tree without changing its messages. */
export function clearSessionStars(manager: SessionManager): string[] {
  for (const targetId of readSessionStars(manager.getEntries())) {
    manager.appendCustomEntry(SESSION_STAR_TYPE, { targetId, starred: false });
  }
  return [];
}

/** A copied branch may contain stale star records or omit later annotations. */
export function copySessionStars(
  source: readonly unknown[],
  target: SessionManager,
): void {
  const wanted = new Set(readSessionStars(source));
  const existing = new Set(readSessionStars(target.getEntries()));
  for (const entry of target.getEntries()) {
    if (entry.type !== "message" || entry.message.role !== "assistant")
      continue;
    if (wanted.has(entry.id) !== existing.has(entry.id))
      target.appendCustomEntry(SESSION_STAR_TYPE, {
        targetId: entry.id,
        starred: wanted.has(entry.id),
      });
  }
}

/** Keep unloaded rail anchors while incorporating a toggle on a loaded answer. */
export function updateStarAnchors(
  anchors: NonNullable<SessionContext["historyAnchors"]>,
  messages: AgentMessage[],
  entryIds: string[],
  starredEntryIds: string[],
): NonNullable<SessionContext["historyAnchors"]> {
  const stars = new Set(starredEntryIds);
  const loaded = new Set(entryIds);
  return [
    ...anchors.filter(
      (anchor) =>
        !loaded.has(anchor.id) && (!anchor.starred || stars.has(anchor.id)),
    ),
    ...messages.flatMap((message, index) => {
      const id = entryIds[index];
      if (!id) return [];
      if (isMessageGroupAnchor(message))
        return [
          {
            id,
            timestamp: message.timestamp,
            ...(message.role === "user"
              ? { preview: getMessagePreview(message.content) }
              : {}),
            ...(message.role === "custom" && message.customType === "compaction"
              ? { compaction: true }
              : {}),
          },
        ];
      return stars.has(id)
        ? [{ id, timestamp: message.timestamp, starred: true }]
        : [];
    }),
  ];
}
