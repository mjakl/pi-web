import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { TOOL_SELECTION_TYPE } from "./session-tool-selection";
import { writePrivateFileAtomicSync } from "./atomic-file";
import type { SessionEntry, SessionHeader, UserMessage } from "./types";

/** Called during runtime disposal, before releasing its registry entry. */
export function rewindSessionFile(filePath: string, sessionId: string, entryId: string): UserMessage {
  const lines = readFileSync(filePath, "utf8").split("\n").filter((line) => line.trim());
  const entries = lines.map((line) => JSON.parse(line)) as (SessionEntry | SessionHeader)[];
  const header = entries[0];
  if (header?.type !== "session" || header.id !== sessionId) throw new Error("Session file identity changed");
  const index = entries.findIndex((entry) => entry.type !== "session" && entry.id === entryId);
  const target = entries[index];
  if (index <= 0 || target.type !== "message" || target.message.role !== "user") {
    throw new Error("Rewind requires an existing user message");
  }
  if (target.parentId && !entries.slice(1, index).some((entry) => entry.id === target.parentId)) {
    throw new Error("Rewind target has no earlier parent");
  }

  // Rewind conversation history, not session preferences. In particular, an
  // explicit Chat-only selection must never turn into the legacy tool default.
  let parentId = target.parentId;
  const preferences = entries.slice(index + 1).flatMap((entry) => {
    if (entry.type !== "session_info" && entry.type !== "model_change" && entry.type !== "thinking_level_change"
      && !(entry.type === "custom" && entry.customType === TOOL_SELECTION_TYPE)) return [];
    const retained = { ...entry, parentId };
    parentId = entry.id;
    return [JSON.stringify(retained)];
  });

  // The last retained file entry may be on another branch. Persist the selected
  // message's parent as the new leaf without keeping any of its removed content.
  const leaf = {
    type: "custom", customType: "pi-web-rewind", data: {},
    id: randomUUID(), parentId, timestamp: new Date().toISOString(),
  };
  writePrivateFileAtomicSync(filePath, [...lines.slice(0, index), ...preferences, JSON.stringify(leaf)].join("\n") + "\n");
  return target.message;
}
