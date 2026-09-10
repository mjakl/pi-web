// Unified diffs as a side-by-side table. Pi's edit and write tools return the
// patch they applied in the tool result's `details`; this turns it into rows a
// view can print without knowing anything about diff syntax.

export type DiffCell = {
  lineNo: number | null;
  text: string;
  type: "context" | "removed" | "added" | "empty";
};

export type DiffRow =
  | { type: "hunk"; text: string }
  | { type: "line"; left: DiffCell; right: DiffCell };

export type DiffFile = {
  oldPath?: string;
  newPath?: string;
  rows: DiffRow[];
};

const EMPTY: DiffCell = { lineNo: null, text: "", type: "empty" };

function cleanPath(path: string): string {
  const tab = path.indexOf("\t");
  return (tab === -1 ? path : path.slice(0, tab)).trim();
}

/**
 * Parse a unified patch into split-diff files. Returns null when the text
 * holds no content lines at all, which is the signal to fall back to printing
 * the patch as it came.
 */
export function parseUnifiedPatch(text: string): DiffFile[] | null {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let pendingOldPath: string | undefined;
  let oldLineNo = 0;
  let newLineNo = 0;
  // Lines still expected in this hunk, from the @@ counts. Inside a hunk a
  // line starting with "--- " is a removed "-- " line, not a file header.
  let oldRemaining = 0;
  let newRemaining = 0;
  let removed: { lineNo: number; text: string }[] = [];
  let added: { lineNo: number; text: string }[] = [];

  const flush = () => {
    const rows = current?.rows;
    if (rows) {
      for (
        let index = 0;
        index < Math.max(removed.length, added.length);
        index += 1
      ) {
        const left = removed[index];
        const right = added[index];
        rows.push({
          type: "line",
          left: left ? { ...left, type: "removed" } : EMPTY,
          right: right ? { ...right, type: "added" } : EMPTY,
        });
      }
    }
    removed = [];
    added = [];
  };

  for (const line of text.split(/\r?\n/)) {
    if (oldRemaining <= 0 && newRemaining <= 0) {
      if (line.startsWith("--- ")) {
        flush();
        pendingOldPath = cleanPath(line.slice(4));
        continue;
      }
      if (line.startsWith("+++ ")) {
        flush();
        current = {
          ...(pendingOldPath === undefined ? {} : { oldPath: pendingOldPath }),
          newPath: cleanPath(line.slice(4)),
          rows: [],
        };
        files.push(current);
        continue;
      }
    }

    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      if (!current) {
        current = { rows: [] };
        files.push(current);
      }
      flush();
      oldLineNo = Number(hunk[1]);
      newLineNo = Number(hunk[3]);
      oldRemaining = hunk[2] === undefined ? 1 : Number(hunk[2]);
      newRemaining = hunk[4] === undefined ? 1 : Number(hunk[4]);
      current.rows.push({ type: "hunk", text: line });
      continue;
    }

    if (!current) continue;
    const content = line.slice(1);
    if (line.startsWith(" ")) {
      flush();
      current.rows.push({
        type: "line",
        left: { lineNo: oldLineNo, text: content, type: "context" },
        right: { lineNo: newLineNo, text: content, type: "context" },
      });
      oldLineNo += 1;
      newLineNo += 1;
      if (oldRemaining > 0) oldRemaining -= 1;
      if (newRemaining > 0) newRemaining -= 1;
    } else if (line.startsWith("-")) {
      removed.push({ lineNo: oldLineNo, text: content });
      oldLineNo += 1;
      if (oldRemaining > 0) oldRemaining -= 1;
    } else if (line.startsWith("+")) {
      added.push({ lineNo: newLineNo, text: content });
      newLineNo += 1;
      if (newRemaining > 0) newRemaining -= 1;
    } else if (line !== "") {
      // "\ No newline at end of file" and anything else unrecognised.
      flush();
      current.rows.push({ type: "hunk", text: line });
    }
  }
  flush();

  const parsed = files.filter((file) =>
    file.rows.some((row) => row.type === "line"),
  );
  return parsed.length > 0 ? parsed : null;
}

export type PatchLine = {
  lineNo: number;
  text: string;
  type: "context" | "removed" | "added" | "hunk";
};

/** Fallback rendering: the patch as it came, classified line by line. */
export function patchLines(text: string): PatchLine[] {
  return text.split(/\r?\n/).map((line, index) => ({
    lineNo: index + 1,
    text: line,
    type: line.startsWith("@@")
      ? "hunk"
      : line.startsWith("+")
        ? "added"
        : line.startsWith("-")
          ? "removed"
          : "context",
  }));
}

export type UnifiedRow =
  | { type: "hunk"; text: string }
  | { type: "collapsed"; count: number }
  | {
      type: "line";
      lineNo: number | null;
      text: string;
      kind: "context" | "added" | "removed";
    };

/** Unchanged runs longer than this keep `CONTEXT` lines on either side. */
const CONTEXT = 3;

/**
 * A whole-file diff as one column. `parseUnifiedPatch` pairs lines for the
 * transcript's side-by-side cards; the file viewer wants what `git diff`
 * prints, with the long untouched stretches folded away.
 */
export function unifiedRows(text: string): UnifiedRow[] {
  const rows: UnifiedRow[] = [];
  let oldLineNo = 0;
  let newLineNo = 0;
  let inHunk = false;
  const lines = text.split(/\r?\n/);
  // The newline that ends the patch is not an empty context line.
  if (lines.at(-1) === "") lines.pop();
  for (const line of lines) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      oldLineNo = Number(hunk[1]);
      newLineNo = Number(hunk[2]);
      inHunk = true;
      rows.push({ type: "hunk", text: line });
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith("+")) {
      rows.push({
        type: "line",
        lineNo: newLineNo,
        text: line.slice(1),
        kind: "added",
      });
      newLineNo += 1;
    } else if (line.startsWith("-")) {
      rows.push({
        type: "line",
        lineNo: oldLineNo,
        text: line.slice(1),
        kind: "removed",
      });
      oldLineNo += 1;
    } else if (line.startsWith(" ") || line === "") {
      rows.push({
        type: "line",
        lineNo: newLineNo,
        text: line.slice(1),
        kind: "context",
      });
      oldLineNo += 1;
      newLineNo += 1;
    } else {
      // "\ No newline at end of file" and anything else unrecognised.
      rows.push({ type: "hunk", text: line });
    }
  }
  return collapseContext(rows);
}

function collapseContext(rows: UnifiedRow[]): UnifiedRow[] {
  const out: UnifiedRow[] = [];
  let run: UnifiedRow[] = [];
  const flush = () => {
    if (run.length > CONTEXT * 2 + 1) {
      out.push(
        ...run.slice(0, CONTEXT),
        { type: "collapsed", count: run.length - CONTEXT * 2 },
        ...run.slice(-CONTEXT),
      );
    } else out.push(...run);
    run = [];
  };
  for (const row of rows) {
    if (row.type === "line" && row.kind === "context") run.push(row);
    else {
      flush();
      out.push(row);
    }
  }
  flush();
  return out;
}
