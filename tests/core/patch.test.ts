import { parseUnifiedPatch, patchLines } from "@core/patch";
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
