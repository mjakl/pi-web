import { parseUnifiedPatch, patchLines, unifiedRows } from "@core/patch";
import { describe, expect, it } from "vitest";

describe("parseUnifiedPatch", () => {
  it("pairs removed and added lines side by side", () => {
    const files = parseUnifiedPatch(
      "--- a/x.ts\t2026-01-01\n+++ b/x.ts\n@@ -1,3 +1,3 @@\n context\n-old line\n+new line\n more\n",
    );
    expect(files).toHaveLength(1);
    const file = files?.[0];
    expect(file?.oldPath).toBe("a/x.ts");
    expect(file?.newPath).toBe("b/x.ts");
    const lines = file?.rows.filter((row) => row.type === "line") ?? [];
    expect(lines[1]).toEqual({
      type: "line",
      left: { lineNo: 2, text: "old line", type: "removed" },
      right: { lineNo: 2, text: "new line", type: "added" },
    });
  });

  it("pads the shorter side of an uneven change", () => {
    const files = parseUnifiedPatch(
      "--- a\n+++ b\n@@ -1,1 +1,2 @@\n-one\n+one\n+two\n",
    );
    const rows = files?.[0]?.rows.filter((row) => row.type === "line") ?? [];
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      left: { type: "empty", lineNo: null },
      right: { type: "added", text: "two" },
    });
  });

  it("keeps a removed line that looks like a file header inside a hunk", () => {
    const files = parseUnifiedPatch(
      "--- a\n+++ b\n@@ -1,2 +1,2 @@\n--- not a header\n+++ also not\n",
    );
    expect(files).toHaveLength(1);
    expect(files?.[0]?.rows.filter((row) => row.type === "line")).toHaveLength(
      1,
    );
  });

  it("returns null when nothing in the text is a diff line", () => {
    expect(parseUnifiedPatch("no diff here")).toBeNull();
  });
});

describe("patchLines", () => {
  it("classifies each line of a patch that would not parse", () => {
    expect(patchLines("@@ x @@\n+a\n-b\nc").map((line) => line.type)).toEqual([
      "hunk",
      "added",
      "removed",
      "context",
    ]);
  });
});

describe("unifiedRows", () => {
  const patch = [
    "diff --git a/x.ts b/x.ts",
    "--- a/x.ts",
    "+++ b/x.ts",
    "@@ -1,4 +1,4 @@",
    " one",
    "-two",
    "+TWO",
    " three",
    " four",
    "",
  ].join("\n");

  it("numbers removals from the old side and everything else from the new", () => {
    const rows = unifiedRows(patch);
    expect(rows[0]).toEqual({ type: "hunk", text: "@@ -1,4 +1,4 @@" });
    expect(rows[1]).toEqual({
      type: "line",
      lineNo: 1,
      text: "one",
      kind: "context",
    });
    expect(rows[2]).toEqual({
      type: "line",
      lineNo: 2,
      text: "two",
      kind: "removed",
    });
    expect(rows[3]).toEqual({
      type: "line",
      lineNo: 2,
      text: "TWO",
      kind: "added",
    });
  });

  it("collapses an unchanged run longer than twice the context", () => {
    const long = [
      "@@ -1,12 +1,12 @@",
      ...Array.from({ length: 10 }, (_, index) => ` line ${String(index)}`),
      "-old",
      "+new",
      "",
    ].join("\n");
    const rows = unifiedRows(long);
    const collapsed = rows.find((row) => row.type === "collapsed");
    expect(collapsed).toEqual({ type: "collapsed", count: 4 });
    expect(rows.filter((row) => row.type === "line")).toHaveLength(8);
  });

  it("ignores anything before the first hunk header", () => {
    expect(unifiedRows("garbage\nno hunk here\n")).toEqual([]);
  });
});
