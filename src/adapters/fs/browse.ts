import type { DirectoryBrowser } from "@core/ports";
import { FileAccessError } from "@core/path-access";
import { readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, parse, resolve, sep } from "node:path";

// The folder picker's file system view. Names only: a reader browsing to a
// folder learns which directories exist, never what is in a file. Access to
// contents still has to be granted by validating the folder, which is what
// adds it to the allowed roots.

/** `~`, `~/x`, and relative paths, as pi-web accepts them. */
function expand(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return join(homedir(), trimmed.slice(2));
  }
  return isAbsolute(trimmed) ? trimmed : resolve(process.cwd(), trimmed);
}

function parentOf(path: string): string | null {
  const parsed = parse(path);
  return parsed.dir === path || parsed.dir === "" ? null : parsed.dir;
}

export function createDirectoryBrowser(): DirectoryBrowser {
  return {
    async browse(path) {
      const start = path === undefined || path.trim() === "" ? homedir() : path;
      const resolved = await realpath(expand(start)).catch(() => undefined);
      if (resolved === undefined) {
        throw new FileAccessError("Directory does not exist", 404);
      }
      const info = await stat(resolved);
      if (!info.isDirectory()) {
        throw new FileAccessError("Path is not a directory", 400);
      }
      const entries = await readdir(resolved, { withFileTypes: true });
      const directories: { name: string; path: string }[] = [];
      for (const entry of entries) {
        const full = join(resolved, entry.name);
        // Hidden folders are listed: repositories live in them too. A symlink
        // counts when it points at a directory; a broken one is dropped.
        const isDir = entry.isDirectory()
          ? true
          : entry.isSymbolicLink()
            ? await stat(full).then(
                (target) => target.isDirectory(),
                () => false,
              )
            : false;
        if (isDir) directories.push({ name: entry.name, path: full });
      }
      directories.sort((a, b) => a.name.localeCompare(b.name, "en"));
      return {
        path: resolved,
        parentPath: parentOf(resolved.replace(new RegExp(`${sep}+$`), "")),
        directories,
      };
    },
  };
}
