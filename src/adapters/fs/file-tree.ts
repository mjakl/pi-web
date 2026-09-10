import type { FileEntry } from "@core/composer";
import type { Files } from "@core/ports";
import { execFile } from "node:child_process";
import { constants, open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

// Caps chosen so a monorepo cannot stall a keystroke: git is asked once per
// folder and the answer is reused for ten seconds.
const MAX_FILES = 5000;
const GIT_HARD_CAP = 200_000;
const WALK_HARD_CAP = 50_000;
const MAX_WALK_DEPTH = 8;
const MAX_CHILDREN = 20;
const CACHE_TTL_MS = 10_000;
const CACHE_MAX_ENTRIES = 20;
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;

const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "__pycache__",
  ".turbo",
  ".cache",
  "coverage",
  ".pytest_cache",
  ".mypy_cache",
  "target",
  "vendor",
]);

function toPosix(path: string): string {
  return sep === "/" ? path : path.replaceAll(sep, "/");
}

async function gitFiles(cwd: string): Promise<string[] | undefined> {
  try {
    const { stdout } = await run(
      "git",
      [
        "-C",
        cwd,
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
      ],
      {
        timeout: 10_000,
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, LC_ALL: "C" },
        encoding: "utf8",
      },
    );
    const files = stdout.split("\0").filter((line) => line !== "");
    return files.slice(0, GIT_HARD_CAP);
  } catch {
    return undefined;
  }
}

/** Breadth-first, so a shallow file is never lost to a deep subtree. */
async function walkFiles(cwd: string): Promise<string[]> {
  const files: string[] = [];
  let level = [""];
  for (let depth = 0; depth <= MAX_WALK_DEPTH && level.length > 0; depth += 1) {
    const next: string[] = [];
    for (const relative of level) {
      if (files.length >= WALK_HARD_CAP) return files;
      let entries;
      try {
        entries = await readdir(join(cwd, relative), { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
        if (entry.isDirectory()) {
          if (!SKIPPED_DIRECTORIES.has(entry.name)) next.push(path);
        } else if (entry.isFile() && !entry.name.endsWith(".pyc")) {
          files.push(path);
          if (files.length >= WALK_HARD_CAP) return files;
        }
      }
    }
    level = next;
  }
  return files;
}

function expand(query: string, cwd: string): string {
  const path = query.replaceAll("\\", "/");
  if (path === "~" || path.startsWith("~/")) {
    return join(homedir(), path.slice(1));
  }
  return isAbsolute(path) ? path : resolve(cwd, path);
}

export function createFileTree(): Files {
  const cache = new Map<
    string,
    {
      expiresAt: number;
      index: Promise<{ files: string[]; truncated: boolean }>;
    }
  >();

  async function load(
    cwd: string,
  ): Promise<{ files: string[]; truncated: boolean }> {
    const listed = (await gitFiles(cwd)) ?? (await walkFiles(cwd));
    const files = listed.map(toPosix).sort((a, b) => a.localeCompare(b));
    return {
      files: files.slice(0, MAX_FILES),
      truncated: files.length > MAX_FILES,
    };
  }

  return {
    index(cwd) {
      const hit = cache.get(cwd);
      if (hit && hit.expiresAt > Date.now()) return hit.index;
      const index = load(cwd);
      cache.set(cwd, { expiresAt: Date.now() + CACHE_TTL_MS, index });
      index.catch(() => cache.delete(cwd));
      while (cache.size > CACHE_MAX_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
      return index;
    },

    async children(query, cwd) {
      const expanded = expand(query, cwd);
      // A query that ends in a separator names the directory itself.
      const trailing = /[\\/]$/.test(query) || query === "" || query === "~";
      const directory = trailing ? expanded : join(expanded, "..");
      const prefix = (
        trailing ? "" : expanded.slice(directory.length + 1)
      ).toLowerCase();
      const entries = await readdir(directory, { withFileTypes: true });
      const matched: FileEntry[] = [];
      for (const entry of entries) {
        if (!entry.name.toLowerCase().startsWith(prefix)) continue;
        const path = join(directory, entry.name);
        let isDir = entry.isDirectory();
        if (entry.isSymbolicLink()) {
          isDir = await stat(path).then(
            (info) => info.isDirectory(),
            () => false,
          );
        }
        matched.push({ path, isDir });
      }
      return matched
        .sort(
          (a, b) =>
            Number(b.isDir) - Number(a.isDir) ||
            a.path.localeCompare(b.path, "en"),
        )
        .slice(0, MAX_CHILDREN);
    },

    async readOutput(path) {
      // O_NOFOLLOW: the name was validated, a symlink at that name was not.
      const handle = await open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const info = await handle.stat();
        if (!info.isFile()) throw new Error("Not a regular file");
        if (info.size > MAX_OUTPUT_BYTES) {
          throw new Error("Output file is too large to show here");
        }
        return await handle.readFile("utf8");
      } finally {
        await handle.close();
      }
    },
  };
}
