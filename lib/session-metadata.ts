import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { createInterface } from "readline";
import { skillExpansionToCommand } from "./slash-display";
import {
  SESSION_TITLE_MAX_CHARS,
  type SessionMetadataFingerprint,
  type SessionRowMetadata,
} from "./session-metadata-types";

export { SESSION_TITLE_MAX_CHARS } from "./session-metadata-types";

function extractTextContent(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: "text"; text: string } => (
      Boolean(block)
      && typeof block === "object"
      && (block as { type?: unknown }).type === "text"
      && typeof (block as { text?: unknown }).text === "string"
    ))
    .map((block) => block.text)
    .join(" ");
}

export function sessionTitleFromFirstMessage(firstMessage: string): string {
  const display = skillExpansionToCommand(firstMessage) ?? firstMessage;
  return display.slice(0, SESSION_TITLE_MAX_CHARS) || "(no messages)";
}

function fingerprintMatches(
  fingerprint: SessionMetadataFingerprint,
  expected?: SessionMetadataFingerprint,
): boolean {
  return !expected || (
    fingerprint.fileSize === expected.fileSize
    && fingerprint.modified === expected.modified
  );
}

async function fileFingerprint(filePath: string): Promise<SessionMetadataFingerprint> {
  const stats = await stat(filePath);
  return { fileSize: stats.size, modified: stats.mtime.toISOString() };
}

/**
 * Read the exact row metadata for one session without synchronously loading the
 * file into the Next.js event loop. Returns null when the inventory fingerprint
 * is stale or the file changes during the scan.
 */
export async function readSessionRowMetadata(
  filePath: string,
  id: string,
  expected?: SessionMetadataFingerprint,
): Promise<SessionRowMetadata | null> {
  const before = await fileFingerprint(filePath);
  if (!fingerprintMatches(before, expected)) return null;

  let name: string | undefined;
  let messageCount = 0;
  let firstMessage = "";
  const input = createReadStream(filePath, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });

  try {
    for await (const line of lines) {
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }

      if (entry.type === "session_info") {
        name = typeof entry.name === "string" && entry.name.trim()
          ? entry.name.trim()
          : undefined;
        continue;
      }
      if (entry.type !== "message") continue;

      messageCount += 1;
      if (firstMessage) continue;
      const message = entry.message;
      if (!message || typeof message !== "object" || (message as { role?: unknown }).role !== "user") continue;
      firstMessage = extractTextContent(message);
    }
  } finally {
    lines.close();
    input.destroy();
  }

  const after = await fileFingerprint(filePath);
  if (!fingerprintMatches(after, before)) return null;
  return {
    id,
    ...after,
    name,
    messageCount,
    firstMessage: sessionTitleFromFirstMessage(firstMessage),
  };
}
