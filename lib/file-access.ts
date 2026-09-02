import { readdirSync } from "fs";
import { homedir } from "os";
import path from "path";
import { getAdditionalAllowedRoots, normalizeSlashes } from "./allowed-roots";
import { isExistingPathWithinRoots, isPathWithinRoots } from "./path-security";
import { listSessionCwds } from "./session-reader";
import { resolveProject } from "./worktree";
export { allowFileRoot, normalizeSlashes } from "./allowed-roots";
export { isWindowsAbsolutePath } from "./paths";

export async function getAllowedFileRoots(): Promise<Set<string>> {
  const roots = new Set<string>();
  const sessionCwds = await listSessionCwds();
  const projects = await Promise.all(sessionCwds.map((cwd) => resolveProject(cwd)));
  sessionCwds.forEach((cwd, index) => {
    roots.add(normalizeSlashes(cwd));
    roots.add(normalizeSlashes(projects[index].projectRoot));
  });

  // Also allow ~/pi-cwd-* directories created by the default-cwd endpoint.
  try {
    for (const name of readdirSync(homedir())) {
      if (/^pi-cwd-\d{8}$/.test(name)) {
        roots.add(normalizeSlashes(path.join(homedir(), name)));
      }
    }
  } catch {
    // ignore if home is unreadable
  }

  for (const root of getAdditionalAllowedRoots()) roots.add(root);

  return roots;
}

/** Authorize a path lexically, without touching the filesystem. */
export function isFilePathAllowed(target: string, allowedRoots: Set<string>): boolean {
  return isPathWithinRoots(target, allowedRoots);
}

/** Authorize an existing path after resolving symbolic links. */
export function isExistingFilePathAllowed(target: string, allowedRoots: Set<string>): boolean {
  return isExistingPathWithinRoots(target, allowedRoots);
}
