// Which absolute paths a request may reach. One policy, used by every file
// route: lexical containment first (so a bad path never causes an fs call),
// then the caller re-checks the resolved path against the resolved roots.

/** Rejected requests carry the status the route should answer with. */
export class FileAccessError extends Error {
  readonly status: 400 | 403 | 404 | 413;

  constructor(message: string, status: 400 | 403 | 404 | 413) {
    super(message);
    this.status = status;
  }
}

/** Windows drive letters and UNC shares use win32 comparison rules. */
function isWindowsStyle(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

function segmentsOf(path: string): string[] | null {
  const slashed = path.replaceAll("\\", "/");
  const windows = isWindowsStyle(path);
  if (!slashed.startsWith("/") && !/^[a-zA-Z]:\//.test(slashed)) return null;
  const out: string[] = slashed.startsWith("/") ? [""] : [];
  for (const part of slashed.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length > (slashed.startsWith("/") ? 1 : 0)) out.pop();
      continue;
    }
    // Case folding on Windows only: elsewhere two names differing in case are
    // two files.
    out.push(windows ? part.toLowerCase() : part);
  }
  return out;
}

/**
 * One spelling per folder, for keying maps of paths: normalised, without a
 * trailing separator, case-folded on Windows only. Not a security check —
 * containment is `directoryWithin`.
 */
export function pathKey(path: string): string {
  const segments = segmentsOf(path);
  if (!segments) return path;
  const joined = segments.join("/");
  return joined === "" ? "/" : joined;
}

export function isAbsolutePath(path: string): boolean {
  return segmentsOf(path) !== null;
}

/** True when `candidate` is `root` or sits under it. Both must be absolute. */
export function directoryWithin(root: string, candidate: string): boolean {
  // A Windows root never contains a POSIX path, and the reverse: comparing
  // them case-folded would make `/c/x` look like `C:/X`.
  if (isWindowsStyle(root) !== isWindowsStyle(candidate)) return false;
  const base = segmentsOf(root);
  const target = segmentsOf(candidate);
  if (!base || !target || target.length < base.length) return false;
  return base.every((segment, index) => target[index] === segment);
}

/** Two spellings of one path; case-insensitive on Windows only. */
export function samePath(a: string, b: string): boolean {
  const left = segmentsOf(a);
  const right = segmentsOf(b);
  if (!left || !right) return a === b;
  if (isWindowsStyle(a) !== isWindowsStyle(b)) return false;
  return left.length === right.length && left.every((x, i) => x === right[i]);
}

export function withinAny(roots: Iterable<string>, candidate: string): boolean {
  for (const root of roots) {
    if (directoryWithin(root, candidate)) return true;
  }
  return false;
}

/** The directory holding `path`, for checking a file that does not exist. */
export function parentPath(path: string): string {
  const slashed = path.replaceAll("\\", "/").replace(/\/+$/, "");
  const cut = slashed.lastIndexOf("/");
  if (cut <= 0) return slashed.slice(0, cut + 1) || "/";
  return slashed.slice(0, cut);
}

/**
 * A tool may report a file relative to the folder it ran in. Resolving it
 * here is what lets the transcript link it into the file panel.
 */
export function resolveUnder(cwd: string, path: string): string {
  if (path === "") return path;
  if (isAbsolutePath(path)) return path;
  if (cwd === "") return path;
  return `${cwd.replace(/[\\/]+$/, "")}/${path.replace(/^\.\//, "")}`;
}

const BASH_OUTPUT_NAME = /^pi-bash-[A-Za-z0-9_-]+\.log$/;

/**
 * Pi writes truncated shell output to `<tmpdir>/pi-bash-*.log`. Serving one
 * back needs the file to sit directly in the temporary directory and carry
 * that exact name; the caller still has to prove the session references it.
 */
export function isBashOutputPath(tmpdir: string, path: string): boolean {
  const parts = segmentsOf(path);
  const base = segmentsOf(tmpdir);
  if (!parts || !base || parts.length !== base.length + 1) return false;
  const name = parts.at(-1) ?? "";
  return directoryWithin(tmpdir, path) && BASH_OUTPUT_NAME.test(name);
}

// A path token ends where these characters stop. A trailing `:12` or `:12:3`
// is a line reference, not part of the name.
const PATH_CHARACTER = /[A-Za-z0-9_.~%-]/;
const LINE_SUFFIX = /^:\d+(?::\d+)?/;

function mentions(text: string, needle: string): boolean {
  if (needle === "") return false;
  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at === -1) return false;
    from = at + 1;
    const before = at === 0 ? "" : text[at - 1];
    if (before !== undefined && before !== "" && PATH_CHARACTER.test(before)) {
      continue;
    }
    if (before === "/" || before === "\\") continue;
    const after = text.slice(at + needle.length);
    if (after === "" || !PATH_CHARACTER.test(after[0] ?? "")) {
      if (after.startsWith("/") || after.startsWith("\\")) continue;
      return true;
    }
    if (LINE_SUFFIX.test(after)) return true;
  }
}

/**
 * pi-web's escape hatch: a file a session's transcript literally names may be
 * read even when it sits outside every allowed root, because the agent
 * already showed its contents in the conversation. Whole-token match only,
 * tolerant of `file://` URLs, percent-encoding, and a `:line` suffix.
 */
export function referencesPath(text: string, path: string): boolean {
  const posix = path.replaceAll("\\", "/");
  const candidates = new Set([
    path,
    posix,
    encodeURI(posix),
    `file://${posix}`,
    // Session entries are searched as JSON, where a Windows separator is
    // doubled.
    path.replaceAll("\\", "\\\\"),
  ]);
  try {
    candidates.add(decodeURIComponent(posix));
  } catch {
    // A stray `%` is not an encoding; the raw form is already covered.
  }
  for (const candidate of candidates) {
    if (mentions(text, candidate)) return true;
  }
  return false;
}
