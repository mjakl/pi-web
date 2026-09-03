import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { createInterface } from "readline";
import { skillExpansionToCommand } from "./slash-display";
import {
  SESSION_TITLE_MAX_CHARS,
  type SessionMetadataFingerprint,
  type SessionRowMetadata,
} from "./session-metadata-types";

export function extractTextContent(message: unknown): string {
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

interface SessionFileFingerprint extends SessionMetadataFingerprint {
  device: number;
  inode: number;
  changedMs: number;
  modifiedMs: number;
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

function sameFileFingerprint(
  left: SessionFileFingerprint | null,
  right: SessionFileFingerprint | null,
): boolean {
  return left && right ? (
    left.fileSize === right.fileSize
    && left.device === right.device
    && left.inode === right.inode
    && left.changedMs === right.changedMs
    && left.modifiedMs === right.modifiedMs
  ) : left === right;
}

function publicFingerprint(
  fingerprint: SessionFileFingerprint | null,
): SessionMetadataFingerprint | null {
  return fingerprint && {
    fileSize: fingerprint.fileSize,
    modified: fingerprint.modified,
  };
}

async function fileFingerprint(filePath: string): Promise<SessionFileFingerprint | null> {
  try {
    const stats = await stat(filePath);
    return {
      fileSize: stats.size,
      modified: stats.mtime.toISOString(),
      device: stats.dev,
      inode: stats.ino,
      changedMs: stats.ctimeMs,
      modifiedMs: stats.mtimeMs,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Runs a session read between two filesystem identity checks. Once the read is
 * attempted, an identity change or unavailable closing check returns null.
 * A callback error is rethrown only when the file identity stayed unchanged.
 */
export async function readStableSessionFile<T>(
  filePath: string,
  read: (fingerprint: SessionMetadataFingerprint | null) => Promise<T> | T,
  expected?: SessionMetadataFingerprint,
): Promise<T | null> {
  const before = await fileFingerprint(filePath);
  if (expected && (!before || !fingerprintMatches(before, expected))) return null;

  let value!: T;
  let callbackError: unknown;
  let callbackFailed = false;
  try {
    value = await read(publicFingerprint(before));
  } catch (error) {
    callbackFailed = true;
    callbackError = error;
  }

  let after: SessionFileFingerprint | null;
  try {
    after = await fileFingerprint(filePath);
  } catch {
    return null;
  }
  if (!sameFileFingerprint(after, before)) return null;
  if (callbackFailed) throw callbackError;
  return value;
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
  return readStableSessionFile(filePath, async (fingerprint) => {
    if (!fingerprint) return null;

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

    return {
      id,
      ...fingerprint,
      name,
      messageCount,
      firstMessage: sessionTitleFromFirstMessage(firstMessage),
    };
  }, expected);
}
