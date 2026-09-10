import type { SessionCatalog } from "@core/ports";
import { isSessionId, type SessionSummary } from "@core/sessions";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { closeSync, openSync, readSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

// Reads Pi's sessions/<encoded-cwd>/*.jsonl store. Listing touches only the
// first line of every file (the header), so a multi-gigabyte store stays cheap
// to browse. Full parsing happens only for the one session being viewed.

const HEADER_MAX_BYTES = 8192;

type Header = { id: string; cwd: string; timestamp: string };

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
    return { id: header.id, cwd: header.cwd, timestamp: header.timestamp };
  } catch {
    return undefined;
  } finally {
    closeSync(fd);
  }
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

  async function scan(): Promise<SessionSummary[]> {
    const summaries: SessionSummary[] = [];
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
    return summaries;
  }

  async function pathOf(id: string): Promise<string | undefined> {
    if (!isSessionId(id)) return undefined;
    if (!paths.has(id)) await scan();
    return paths.get(id);
  }

  return {
    list: scan,
    pathOf,
    remember(id, filePath) {
      paths.set(id, filePath);
    },
    async read(id) {
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
        branch: manager.getBranch(),
      };
    },
  };
}
