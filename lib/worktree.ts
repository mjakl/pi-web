import { execFile } from "child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync } from "fs";
import { dirname, join } from "path";
import { promisify } from "util";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { samePath, toNativePath, pathIdentityKey } from "./paths";

const execFileAsync = promisify(execFile);

export interface ProjectInfo {
  /** Main checkout or bare repository directory; subdirectories keep their own identity. */
  projectRoot: string;
  branch: string | null;
  isWorktree: boolean;
  isTopLevel: boolean;
}

export interface WorktreeInfo {
  path: string;
  branch: string | null;
}

declare global {
  var __piProjectCache: Map<string, { info: ProjectInfo; expiresAt: number }> | undefined;
}

export function isWorkingDirectoryAvailable(cwd: string): boolean {
  try { return statSync(cwd).isDirectory(); } catch { return false; }
}

export function assertWorkingDirectoryAvailable(cwd: string): void {
  if (!isWorkingDirectoryAvailable(cwd)) {
    throw new Error(`Working folder is unavailable. This session is read-only: ${cwd}`);
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    timeout: 10_000, maxBuffer: 1024 * 1024,
    env: { ...process.env, LC_ALL: "C" },
  });
  return stdout.trim();
}

function realPathOrSelf(filePath: string): string {
  try { return realpathSync(filePath); } catch { return filePath; }
}

// Git forgets removed worktrees. Retain only their observed project identity,
// separately from user-owned transcripts, so history stays grouped after restart.
function readKnownProjects(): Record<string, string> {
  try {
    const value: unknown = JSON.parse(readFileSync(join(getAgentDir(), "web-worktree-projects.json"), "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, root]) => typeof root === "string"));
  } catch { return {}; }
}

function rememberProjects(paths: string[], root: string): void {
  const known = readKnownProjects();
  let changed = false;
  for (const path of paths) {
    const key = pathIdentityKey(path);
    if (known[key] !== root) { known[key] = root; changed = true; }
  }
  if (!changed) return;
  mkdirSync(getAgentDir(), { recursive: true });
  writePrivateFileAtomicSync(join(getAgentDir(), "web-worktree-projects.json"), JSON.stringify(known));
}

function removedProject(cwd: string): ProjectInfo {
  let root = readKnownProjects()[pathIdentityKey(cwd)];
  // Compatibility with worktrees created by earlier Pi Web versions.
  const parent = dirname(cwd);
  const legacyRoot = parent.endsWith("-worktrees") ? parent.slice(0, -"-worktrees".length) : "";
  if (!root && legacyRoot && existsSync(join(legacyRoot, ".git"))) root = realPathOrSelf(legacyRoot);
  return { projectRoot: root ?? cwd, branch: null, isWorktree: Boolean(root && !samePath(root, cwd)), isTopLevel: Boolean(root) };
}

export async function resolveProject(cwd: string, refresh = false): Promise<ProjectInfo> {
  const cache = globalThis.__piProjectCache ??= new Map();
  const key = `${getAgentDir()}:${pathIdentityKey(cwd)}`;
  // Availability must never be hidden by the identity cache.
  if (!isWorkingDirectoryAvailable(cwd)) { cache.delete(key); return removedProject(cwd); }
  const cached = cache.get(key);
  if (!refresh && cached && cached.expiresAt > Date.now()) return cached.info;
  let info: ProjectInfo;
  try {
    const out = await git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir", "--git-dir"]);
    const [commonDir, gitDir] = out.split("\n").map(toNativePath);
    const bare = await git(commonDir, ["rev-parse", "--is-bare-repository"]) === "true";
    const root = realPathOrSelf(bare ? commonDir : dirname(commonDir));
    const isBareDirectory = bare && samePath(realPathOrSelf(cwd), root);
    const toplevel = isBareDirectory ? root : toNativePath(await git(cwd, ["rev-parse", "--show-toplevel"]));
    const isTopLevel = samePath(toplevel, realPathOrSelf(cwd));
    const isWorktree = isTopLevel && !samePath(gitDir, commonDir);
    const branch = isBareDirectory ? null : await git(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(() => null);
    info = { projectRoot: isTopLevel ? root : cwd, branch, isWorktree, isTopLevel };
    if (isTopLevel) rememberProjects([cwd, realPathOrSelf(cwd)], root);
  } catch {
    info = { projectRoot: cwd, branch: null, isWorktree: false, isTopLevel: false };
  }
  cache.set(key, { info, expiresAt: Date.now() + 60_000 });
  return info;
}

export async function listWorktrees(cwd: string): Promise<WorktreeInfo[]> {
  const out = await git(cwd, ["worktree", "list", "--porcelain", "-z"]);
  const records: { path: string; branch: string | null; bare?: boolean; prunable?: boolean }[] = [];
  let current: typeof records[number] | undefined;
  for (const field of out.split("\0")) {
    if (field.startsWith("worktree ")) {
      current = { path: toNativePath(field.slice(9)), branch: null };
      records.push(current);
    } else if (current && field.startsWith("branch ")) current.branch = field.slice(7).replace(/^refs\/heads\//, "");
    else if (current && field === "bare") current.bare = true;
    else if (current && field.startsWith("prunable")) current.prunable = true;
  }
  if (records[0]) rememberProjects(records.map(record => record.path), records[0].path);
  return records.filter(record => !record.bare && !record.prunable && isWorkingDirectoryAvailable(record.path))
    .map(({ path, branch }) => ({ path, branch }));
}

export function findCurrentWorktreePath(worktrees: readonly WorktreeInfo[], cwd: string): string | null {
  return worktrees.find(worktree => samePath(worktree.path, realPathOrSelf(cwd)))?.path ?? null;
}
