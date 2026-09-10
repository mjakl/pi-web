import type { ProjectResolver } from "@core/ports";
import { execFile } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { pathKey } from "./session-files.ts";

// Which repository a session's working folder belongs to. Sessions of the
// worktrees of one checkout group together under the repository, and sessions
// whose folder is gone stay grouped through the map pi-web leaves behind.

const run = promisify(execFile);
const CACHE_MS = 60_000;

type Project = { root: string; branch: string | null };

/** pi-web's `web-worktree-projects.json`: path identity -> project root. */
function knownProjects(agentDir: string): Record<string, string> {
  try {
    const value: unknown = JSON.parse(
      readFileSync(join(agentDir, "web-worktree-projects.json"), "utf8"),
    );
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(value).filter(([, root]) => typeof root === "string"),
    );
  } catch {
    return {};
  }
}

export function createPiProjectResolver(options: {
  agentDir: string;
}): ProjectResolver {
  const cache = new Map<string, { at: number; project: Project }>();

  async function look(cwd: string): Promise<Project> {
    try {
      if (!statSync(cwd).isDirectory()) throw new Error("not a directory");
    } catch {
      const root = knownProjects(options.agentDir)[pathKey(cwd)];
      return { root: root ?? cwd, branch: null };
    }
    try {
      const { stdout } = await run(
        "git",
        [
          "rev-parse",
          "--path-format=absolute",
          "--show-toplevel",
          "--git-common-dir",
          "--abbrev-ref",
          "HEAD",
        ],
        { cwd, timeout: 5000 },
      );
      const [top, commonDir, head] = stdout.trim().split("\n");
      // In a worktree the shared .git lives in the main checkout, so its
      // parent is the project every worktree of the repository belongs to.
      const main = commonDir ? dirname(commonDir) : undefined;
      return {
        root: main ?? top ?? cwd,
        branch: head && head !== "HEAD" ? head : null,
      };
    } catch {
      return { root: cwd, branch: null };
    }
  }

  return {
    async resolve(cwd) {
      const hit = cache.get(cwd);
      if (hit && Date.now() - hit.at < CACHE_MS) return hit.project;
      const project = await look(cwd);
      cache.set(cwd, { at: Date.now(), project });
      return project;
    },
  };
}
