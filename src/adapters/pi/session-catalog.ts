import { pathKey } from "@core/path-access";
import type { SessionCatalog, SessionRead } from "@core/ports";
import { STAR_TYPE, userMessageText } from "@core/session-entries";
import {
  isSessionId,
  type SessionRowMetadata,
  type SessionSummary,
} from "@core/sessions";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { closeSync, createReadStream, openSync, readSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { createInterface } from "node:readline";
import { exportSessionHtml } from "./session-export.ts";
import {
  branchToNewFile,
  removeSessionFile,
  rewindSessionFile,
} from "./session-files.ts";

// Reads Pi's sessions/<encoded-cwd>/*.jsonl store. Listing touches only the
// first line of every file (the header), so a multi-gigabyte store stays cheap
// to browse. Full parsing happens only for the one session being viewed, and
// row metadata streams a file line by line instead of holding it.

const HEADER_MAX_BYTES = 8192;
const METADATA_CACHE_MAX = 4096;

type Header = {
  id: string;
  cwd: string;
  timestamp: string;
  /** Absolute path of the session this one was forked or branched from. */
  parentSession?: string;
};

function readHeader(filePath: string): Header | undefined {
  const fd = openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(HEADER_MAX_BYTES);
    const bytes = readSync(fd, buffer, 0, HEADER_MAX_BYTES, 0);
    const newline = buffer.indexOf(10);
    if (newline < 0 || newline > bytes) return undefined;
    const parsed: unknown = JSON.parse(buffer.subarray(0, newline).toString());
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const header = parsed as Partial<Record<keyof Header | "type", unknown>>;
    if (
      header.type !== "session" ||
      !isSessionId(header.id) ||
      typeof header.cwd !== "string" ||
      !isAbsolute(header.cwd) ||
      typeof header.timestamp !== "string" ||
      Number.isNaN(Date.parse(header.timestamp))
    ) {
      return undefined;
    }
    return {
      id: header.id,
      cwd: header.cwd,
      timestamp: header.timestamp,
      ...(typeof header.parentSession === "string" &&
      isAbsolute(header.parentSession)
        ? { parentSession: header.parentSession }
        : {}),
    };
  } catch {
    return undefined;
  } finally {
    closeSync(fd);
  }
}

/**
 * Row metadata by streaming: the same counts `rowMetadata()` derives in the
 * core, but one line at a time so a hundred-megabyte session never lands in
 * memory just to show a sidebar row.
 */
async function streamRowMetadata(
  filePath: string,
  file: { modifiedAt: string; fileSize: number },
): Promise<SessionRowMetadata> {
  const stars = new Map<string, boolean>();
  const answers = new Set<string>();
  let name: string | undefined;
  let firstMessage = "";
  let messageCount = 0;

  const lines = createInterface({
    input: createReadStream(filePath, "utf8"),
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  for await (const line of lines) {
    if (!line) continue;
    let entry: SessionEntry;
    try {
      entry = JSON.parse(line) as SessionEntry;
    } catch {
      continue;
    }
    if (entry.type === "session_info") {
      const trimmed = entry.name?.trim();
      name = trimmed === "" ? undefined : trimmed;
    } else if (entry.type === "custom" && entry.customType === STAR_TYPE) {
      const data = entry.data as
        | { targetId?: unknown; starred?: unknown }
        | undefined;
      if (
        typeof data?.targetId === "string" &&
        typeof data.starred === "boolean"
      ) {
        stars.set(data.targetId, data.starred);
      }
    } else if (entry.type === "message") {
      messageCount += 1;
      if (entry.message.role === "assistant") answers.add(entry.id);
      else if (!firstMessage) firstMessage = userMessageText(entry) ?? "";
    }
  }

  let starCount = 0;
  for (const [targetId, starred] of stars) {
    if (starred && answers.has(targetId)) starCount += 1;
  }
  return {
    ...(name ? { name } : {}),
    firstMessage,
    messageCount,
    starCount,
    ...file,
  };
}

export type PiSessionCatalog = SessionCatalog & {
  /** File path for a known id; scans the store when the id is not cached. */
  pathOf(id: string): Promise<string | undefined>;
  /** Remember a file this process created so it is readable before the next scan. */
  remember(id: string, filePath: string): void;
};

export function createPiSessionCatalog(options: {
  agentDir: string;
}): PiSessionCatalog {
  const sessionsDir = join(options.agentDir, "sessions");
  const paths = new Map<string, string>();
  const rows = new Map<
    string,
    { summary: SessionSummary; metadata: SessionRowMetadata }
  >();

  async function scan(): Promise<SessionSummary[]> {
    const summaries: SessionSummary[] = [];
    // parentSession is a path; the sidebar needs the id it belongs to, and
    // only this scan knows both.
    const idByPath = new Map<string, string>();
    const parents = new Map<string, string>();
    let folders: string[] = [];
    try {
      folders = await readdir(sessionsDir);
    } catch {
      return summaries;
    }
    for (const folder of folders) {
      const dir = join(sessionsDir, folder);
      let files: string[] = [];
      try {
        files = (await readdir(dir)).filter((name) => name.endsWith(".jsonl"));
      } catch {
        continue;
      }
      for (const file of files) {
        const filePath = join(dir, file);
        try {
          const header = readHeader(filePath);
          if (!header) continue;
          const info = await stat(filePath);
          paths.set(header.id, filePath);
          idByPath.set(pathKey(filePath), header.id);
          if (header.parentSession !== undefined) {
            parents.set(header.id, pathKey(header.parentSession));
          }
          summaries.push({
            id: header.id,
            cwd: header.cwd,
            createdAt: header.timestamp,
            modifiedAt: info.mtime.toISOString(),
            fileSize: info.size,
          });
        } catch {
          // Unreadable or concurrently removed files are left out.
        }
      }
    }
    return summaries.map((summary) => {
      const parentId = idByPath.get(parents.get(summary.id) ?? "");
      return parentId === undefined ? summary : { ...summary, parentId };
    });
  }

  async function pathOf(id: string): Promise<string | undefined> {
    if (!isSessionId(id)) return undefined;
    if (!paths.has(id)) await scan();
    return paths.get(id);
  }

  /** The file behind an id, or a "Session not found" error for callers that write. */
  async function fileOf(id: string): Promise<string> {
    const filePath = await pathOf(id);
    if (!filePath) throw new Error("Session not found");
    return filePath;
  }

  async function openManager(id: string): Promise<SessionManager> {
    return SessionManager.open(await fileOf(id));
  }

  return {
    list: scan,
    pathOf,
    remember(id, filePath) {
      paths.set(id, filePath);
    },

    async read(id, leafId): Promise<SessionRead | undefined> {
      const filePath = await pathOf(id);
      if (!filePath) return undefined;
      const info = await stat(filePath);
      const manager = SessionManager.open(filePath);
      const header = manager.getHeader();
      if (!header) return undefined;
      const name = manager.getSessionName();
      return {
        summary: {
          id: header.id,
          cwd: header.cwd,
          ...(name ? { name } : {}),
          createdAt: header.timestamp,
          modifiedAt: info.mtime.toISOString(),
          fileSize: info.size,
        },
        branch: manager.getBranch(leafId),
        entries: manager.getEntries(),
        leafId: manager.getLeafId(),
      };
    },

    async rowMetadata(id) {
      const filePath = await pathOf(id);
      if (!filePath) return undefined;
      const info = await stat(filePath);
      const key = `${filePath}\0${String(info.size)}\0${String(info.mtimeMs)}`;
      const cached = rows.get(key);
      if (cached) return cached;
      const header = readHeader(filePath);
      if (!header) return undefined;
      const file = {
        modifiedAt: info.mtime.toISOString(),
        fileSize: info.size,
      };
      const metadata = await streamRowMetadata(filePath, file);
      const row = {
        summary: {
          id: header.id,
          cwd: header.cwd,
          ...(metadata.name ? { name: metadata.name } : {}),
          createdAt: header.timestamp,
          ...file,
        },
        metadata,
      };
      if (rows.size >= METADATA_CACHE_MAX) {
        const oldest = rows.keys().next().value;
        if (oldest !== undefined) rows.delete(oldest);
      }
      rows.set(key, row);
      return row;
    },

    async rename(id, name) {
      (await openManager(id)).appendSessionInfo(name);
    },

    async remove(id) {
      removeSessionFile(await fileOf(id));
      paths.delete(id);
    },

    async setStar(id, targetId, starred) {
      const manager = await openManager(id);
      const target = manager.getEntry(targetId);
      if (target?.type !== "message" || target.message.role !== "assistant") {
        throw new Error("Star target must be an assistant answer");
      }
      manager.appendCustomEntry(STAR_TYPE, { targetId, starred });
    },

    async fork(id, entryId) {
      const filePath = await fileOf(id);
      const manager = SessionManager.open(filePath);
      const entry = manager.getEntry(entryId);
      if (!entry) throw new Error("Select an existing conversation message");
      const text = userMessageText(entry) ?? "";
      // Editing a user message reopens the history *before* it; anything else
      // is copied up to and including itself.
      const leafId = text ? entry.parentId : entry.id;
      if (leafId === null) {
        throw new Error(
          "Nothing precedes the first message; use New for an empty session.",
        );
      }
      const forked = branchToNewFile(filePath, leafId);
      paths.set(forked.id, forked.file);
      return { id: forked.id, text };
    },

    async clone(id, leafId) {
      const filePath = await fileOf(id);
      const manager = SessionManager.open(filePath);
      const leaf = leafId ?? manager.getLeafId();
      if (leaf === null) throw new Error("Cannot clone an empty session");
      const cloned = branchToNewFile(filePath, leaf);
      paths.set(cloned.id, cloned.file);
      return cloned.id;
    },

    async rewind(id, entryId) {
      return rewindSessionFile(await fileOf(id), entryId);
    },

    async exportHtml(id) {
      return exportSessionHtml(await fileOf(id));
    },
  };
}
