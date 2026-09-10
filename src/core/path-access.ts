// Which absolute paths a request may reach. Phase 2 only needs "inside the
// session's own working folder"; Phase 4 extends the same two functions with
// the full allowed-root policy instead of adding checks to route handlers.

function segmentsOf(path: string): string[] | null {
  const slashed = path.replaceAll("\\", "/");
  if (!slashed.startsWith("/") && !/^[a-zA-Z]:\//.test(slashed)) return null;
  const out: string[] = slashed.startsWith("/") ? [""] : [];
  for (const part of slashed.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length > (slashed.startsWith("/") ? 1 : 0)) out.pop();
      continue;
    }
    out.push(part);
  }
  return out;
}

/** True when `candidate` is `root` or sits under it. Both must be absolute. */
export function directoryWithin(root: string, candidate: string): boolean {
  const base = segmentsOf(root);
  const target = segmentsOf(candidate);
  if (!base || !target || target.length < base.length) return false;
  return base.every((segment, index) => target[index] === segment);
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
