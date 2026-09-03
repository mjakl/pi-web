import fs from "fs";

type DirentType = Pick<fs.Dirent, "isDirectory" | "isFile">;

const IGNORED_NAMES = new Set([
  "node_modules", ".git", ".next", "dist", "build", "__pycache__",
  ".turbo", ".cache", "coverage", ".pytest_cache", ".mypy_cache",
  "target", "vendor", ".DS_Store",
]);

const IGNORED_SUFFIXES = [".pyc"];

/** Entries that directory listings and the non-git file index walk skip. */
export function isIgnoredDirent(name: string): boolean {
  return IGNORED_NAMES.has(name) || IGNORED_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

export function resolveDirentIsDirectory(
  dirent: DirentType,
  fullPath: string,
): boolean | null {
  if (dirent.isDirectory()) return true;
  if (dirent.isFile()) return false;

  try {
    return fs.statSync(fullPath).isDirectory();
  } catch {
    return null;
  }
}
