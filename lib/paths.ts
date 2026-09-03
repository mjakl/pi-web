import { normalize, posix, win32 } from "path";

// ============================================================================
// Path primitives.
//
// Two canonical forms coexist deliberately — pick by where the path is going:
//
//   toNativePath()  Native separators (`D:\repo` on Windows). Use for anything
//                   that reaches fs/path APIs, gets compared against a session
//                   cwd, or is shown to the user. This is the form pi records
//                   cwds in, so it is the default for user-facing paths.
//
//   toSlashPath()   Forward slashes (`D:/repo`). Use only for internal,
//                   never-displayed bookkeeping — the allowed-roots set, and
//                   separator-insensitive text matching. Containment checks
//                   re-normalize their inputs anyway (see path-security.ts),
//                   so this form is about consistent keys, not correctness.
//
// Comparison always goes through samePath()/isPathWithinRoots(), never `===`,
// and map keys through pathIdentityKey(): git emits POSIX-style paths even on
// Windows, and Windows itself is case-insensitive, so raw string equality
// silently fails on both counts.
// ============================================================================

const WINDOWS_ABSOLUTE_RE = /^[a-zA-Z]:[\\/]/;

export function isWindowsAbsolutePath(filePath: string): boolean {
  return WINDOWS_ABSOLUTE_RE.test(filePath) || filePath.startsWith("\\\\") || filePath.startsWith("//");
}

/**
 * Whether a request-supplied path is absolute in either convention, POSIX
 * (`/repo`) or Windows drive/UNC (`D:\repo`, `\\server\share`), regardless
 * of the platform Pi Web runs on.
 */
export function isAbsolutePath(filePath: string): boolean {
  return filePath.startsWith("/") || isWindowsAbsolutePath(filePath);
}

/**
 * Convert a path to native separators. Chiefly for git output: git prints
 * POSIX-style absolute paths even on Windows (`D:/repo/sub`), which never
 * string-compares equal to the native paths Node and pi produce.
 *
 * Only pass paths — a branch name like `feature/x` would become `feature\x`.
 */
export function toNativePath(p: string): string {
  if (!p || process.platform !== "win32") return p;
  return normalize(p);
}

/** Convert a path to forward slashes. See the form guidance above. */
export function toSlashPath(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Stable, internal identity for a path: normalized for `platform`, without
 * trailing separators, and case-folded on Windows because the default Windows
 * filesystem is case-insensitive. Keep the original path for display and
 * filesystem operations; use the key only for grouping and equality. The
 * explicit platform argument keeps the Windows rules testable on other hosts.
 */
export function pathIdentityKey(p: string, platform: NodeJS.Platform = process.platform): string {
  if (!p) return p;
  const pathApi = platform === "win32" ? win32 : posix;
  const normalized = pathApi.normalize(p);
  const rootLength = pathApi.parse(normalized).root.length;
  let end = normalized.length;
  while (end > rootLength && normalized[end - 1] === pathApi.sep) end--;
  const trimmed = normalized.slice(0, end);
  return platform === "win32" ? trimmed.toLowerCase() : trimmed;
}

/**
 * Whether two paths denote the same location, tolerating separator style and —
 * on Windows, where the filesystem is case-insensitive — case, including the
 * drive letter (`d:\repo` vs `D:\repo`).
 *
 * Compares lexically: callers wanting symlinks resolved should realpath first.
 */
export function samePath(a: string, b: string): boolean {
  return pathIdentityKey(a) === pathIdentityKey(b);
}
