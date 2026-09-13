import {
  type GitChange,
  parseGitStatus,
  sumNumstat,
  untrackedPatch,
} from "@core/git-status";
import type { Git, GitChangeFile, GitStatus } from "@core/ports";
import { directoryWithin } from "@core/path-access";
import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const TIMEOUT_MS = 10_000;
const MAX_BUFFER = 8 * 1024 * 1024;
const DIFF_BUFFER = 1024 * 1024;
/** A patch above this, or one with a NUL in it, is not worth rendering. */
const MAX_DIFF_BYTES = 256 * 1024;

/** Git speaks POSIX paths on every platform; the rest of web-pi does not. */
function toNative(path: string): string {
  return sep === "/" ? path : path.replaceAll("/", sep);
}

function toPosix(path: string): string {
  return sep === "/" ? path : path.replaceAll(sep, "/");
}

async function git(
  cwd: string,
  args: string[],
  maxBuffer = MAX_BUFFER,
): Promise<string | null> {
  try {
    const { stdout } = await run("git", ["-C", cwd, ...args], {
      timeout: TIMEOUT_MS,
      maxBuffer,
      // Parsing depends on English, unlocalised output.
      env: { ...process.env, LC_ALL: "C" },
      encoding: "utf8",
    });
    return stdout;
  } catch {
    return null;
  }
}

/** Untracked files have no diff to count, so their lines are counted here. */
async function untrackedAdditions(paths: string[]): Promise<number> {
  let additions = 0;
  for (const path of paths) {
    const info = await stat(path).catch(() => undefined);
    if (!info?.isFile() || info.size === 0 || info.size > MAX_DIFF_BYTES) {
      continue;
    }
    const content = await readFile(path, "utf8").catch(() => "");
    if (content === "" || content.includes("\0")) continue;
    additions += content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
  }
  return additions;
}

const EMPTY: GitStatus = {
  isRepository: false,
  root: null,
  files: [],
  additions: 0,
  deletions: 0,
};

export function createGit(): Git {
  return {
    async status(cwd) {
      const top = await git(cwd, ["rev-parse", "--show-toplevel"]);
      if (top === null) return EMPTY;
      const root = toNative(top.trim());
      const porcelain = await git(cwd, [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
      ]);
      if (porcelain === null) return { ...EMPTY, isRepository: true, root };
      const absolute = (change: GitChange): GitChangeFile => ({
        path: join(root, toNative(change.path)),
        status: change.status,
        code: change.code,
        ...(change.original === undefined
          ? {}
          : { original: join(root, toNative(change.original)) }),
      });
      // A session's folder can be a subdirectory of the repository; the panel
      // only shows what is under it.
      const files = parseGitStatus(porcelain)
        .map(absolute)
        .filter((file) => directoryWithin(cwd, file.path));
      const numstat = await git(cwd, [
        "diff",
        "--no-color",
        "--no-ext-diff",
        "--numstat",
        "HEAD",
        "--",
        ".",
      ]);
      const counts = numstat === null ? null : sumNumstat(numstat);
      const untracked = await untrackedAdditions(
        files.filter((file) => file.status === "U").map((file) => file.path),
      );
      return {
        isRepository: true,
        root,
        files,
        additions: (counts?.additions ?? 0) + untracked,
        deletions: counts?.deletions ?? 0,
      };
    },

    async diff(cwd, file) {
      const paths = [
        ...(file.original === undefined ? [] : [toPosix(file.original)]),
        toPosix(file.path),
      ];
      if (file.status !== "D") {
        const info = await stat(file.path).catch(() => undefined);
        if (!info?.isFile() || info.size > MAX_DIFF_BYTES) return null;
        const head = await readFile(file.path, "utf8").catch(() => null);
        if (head === null || head.includes("\0")) return null;
        if (file.status === "U") {
          const name = toPosix(relative(cwd, file.path));
          return untrackedPatch(name, head);
        }
      }
      const patch = await git(
        cwd,
        [
          "diff",
          "--no-color",
          "--no-ext-diff",
          "--unified=3",
          "HEAD",
          "--",
          ...paths,
        ],
        DIFF_BUFFER,
      );
      // A file Git has staged as added has no HEAD side; fall back to the
      // synthetic patch rather than showing nothing.
      if ((patch === null || !patch.includes("\n@@ ")) && file.status === "A") {
        const content = await readFile(file.path, "utf8").catch(() => null);
        if (content !== null && !content.includes("\0")) {
          return untrackedPatch(toPosix(relative(cwd, file.path)), content);
        }
      }
      if (patch === null || !patch.includes("\n@@ ")) return null;
      return patch;
    },
  };
}
