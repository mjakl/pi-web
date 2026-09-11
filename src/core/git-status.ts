// `git status --porcelain=v1 -z --untracked-files=all`, classified. Two
// letters per record, NUL-separated; a rename or copy is followed by a second
// record holding the path it came from.

export type GitFileStatus = "M" | "A" | "D" | "R" | "U" | "C";

export type GitChange = {
  /** Repository-relative, in Git's POSIX spelling. */
  path: string;
  status: GitFileStatus;
  /** The raw two-letter code, for the row title. */
  code: string;
  /** Where a rename or copy came from; the diff needs both paths. */
  original?: string;
};

const CONFLICT_CODES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

/** First rule that matches wins, exactly as pi-web's `lib/git-status.ts`. */
export function classify(code: string): GitFileStatus {
  if (code === "??") return "U";
  if (CONFLICT_CODES.has(code) || code.includes("U")) return "C";
  if (code.includes("D")) return "D";
  if (code.includes("R") || code.includes("C")) return "R";
  if (code.includes("A")) return "A";
  return "M";
}

export function parseGitStatus(stdout: string): GitChange[] {
  const records = stdout.split("\0");
  const changes: GitChange[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    // "XY path": anything shorter, or without the separating space, is noise.
    if (record === undefined || record.length < 4 || record[2] !== " ") {
      continue;
    }
    const code = record.slice(0, 2);
    const path = record.slice(3);
    const status = classify(code);
    let original: string | undefined;
    if (code.includes("R") || code.includes("C")) {
      index += 1;
      original = records[index];
    }
    changes.push({
      path,
      status,
      code,
      ...(original === undefined || original === "" ? {} : { original }),
    });
  }
  return changes;
}

/**
 * `git diff --numstat` rows: additions, deletions, path. A binary file
 * reports "-" for both and is skipped rather than counted as zero.
 */
export function sumNumstat(stdout: string): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const line of stdout.split("\n")) {
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const added = Number(parts[0]);
    const removed = Number(parts[1]);
    if (!Number.isFinite(added) || !Number.isFinite(removed)) continue;
    additions += added;
    deletions += removed;
  }
  return { additions, deletions };
}

const STATUS_LABEL: Record<GitFileStatus, string> = {
  M: "Modified",
  A: "Added",
  D: "Deleted",
  R: "Renamed",
  U: "Untracked",
  C: "Conflict",
};

export function statusLabel(status: GitFileStatus): string {
  return STATUS_LABEL[status];
}

/**
 * A synthetic patch for a file Git has never seen: `git diff` says nothing
 * about it, but the viewer should still show what was added.
 */
export function untrackedPatch(relativePath: string, content: string): string {
  const lines = content.split("\n");
  const endsWithNewline = lines.at(-1) === "";
  if (endsWithNewline) lines.pop();
  const body = lines.map((line) => `+${line}`);
  if (!endsWithNewline && lines.length > 0) {
    body.push("\\ No newline at end of file");
  }
  return [
    `diff --git a/${relativePath} b/${relativePath}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${relativePath}`,
    `@@ -0,0 +1,${String(lines.length)} @@`,
    ...body,
    "",
  ].join("\n");
}
