import { readdirSync, statSync } from "fs";
import { homedir } from "os";
import path from "path";
import { getAdditionalAllowedRoots } from "./allowed-roots";
import { isExistingPathWithinRoots, isPathWithinRoots } from "./path-security";
import { isAbsolutePath, toSlashPath } from "./paths";
import { listSessionCwds } from "./session-reader";
import { resolveProject } from "./worktree";
export { allowFileRoot } from "./allowed-roots";

export async function getAllowedFileRoots(): Promise<Set<string>> {
  const roots = new Set<string>();
  const sessionCwds = await listSessionCwds();
  const projects = await Promise.all(sessionCwds.map((cwd) => resolveProject(cwd)));
  sessionCwds.forEach((cwd, index) => {
    roots.add(toSlashPath(cwd));
    roots.add(toSlashPath(projects[index].projectRoot));
  });

  // Also allow ~/pi-cwd-* directories created by the default-cwd endpoint.
  try {
    for (const name of readdirSync(homedir())) {
      if (/^pi-cwd-\d{8}$/.test(name)) {
        roots.add(toSlashPath(path.join(homedir(), name)));
      }
    }
  } catch {
    // ignore if home is unreadable
  }

  for (const root of getAdditionalAllowedRoots()) roots.add(root);

  return roots;
}

/** Authorize an existing path against the allowed roots after resolving symbolic links. */
export async function isExistingPathAllowed(target: string): Promise<boolean> {
  return isExistingPathWithinRoots(target, await getAllowedFileRoots());
}

export type DirectoryAuthorization =
  | { directory: string }
  | { status: 400 | 403 | 404; error: string };

/**
 * Authorize a request-supplied directory. Containment is checked lexically
 * before the filesystem is touched, so an unauthorized caller cannot learn
 * which paths exist, and again after symbolic links resolve.
 */
export async function authorizeDirectory(cwd: string): Promise<DirectoryAuthorization> {
  if (!cwd || !isAbsolutePath(cwd)) {
    return { status: 400, error: "cwd must be an absolute path" };
  }
  const allowedRoots = await getAllowedFileRoots();
  if (!isPathWithinRoots(cwd, allowedRoots)) {
    return { status: 403, error: "Access denied" };
  }

  let stat;
  try {
    stat = statSync(cwd);
  } catch {
    return { status: 404, error: "Directory not found" };
  }
  if (!stat.isDirectory()) {
    return { status: 400, error: "Not a directory" };
  }
  if (!isExistingPathWithinRoots(cwd, allowedRoots)) {
    return { status: 403, error: "Access denied" };
  }
  return { directory: cwd };
}
