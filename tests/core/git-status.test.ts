import {
  classify,
  parseGitStatus,
  sumNumstat,
  untrackedPatch,
} from "@core/git-status";
import { describe, expect, it } from "vitest";

describe("classify", () => {
  it("puts untracked before the conflict rules", () => {
    expect(classify("??")).toBe("U");
  });

  it("follows the first-match order of the porcelain codes", () => {
    expect(classify("UU")).toBe("C");
    expect(classify("AU")).toBe("C");
    expect(classify("DU")).toBe("C");
    expect(classify(" D")).toBe("D");
    expect(classify("R ")).toBe("R");
    expect(classify("C ")).toBe("R");
    expect(classify("A ")).toBe("A");
    expect(classify(" M")).toBe("M");
    expect(classify("MM")).toBe("M");
  });
});

describe("parseGitStatus", () => {
  it("reads NUL-separated records and takes the second one for a rename", () => {
    const changes = parseGitStatus(
      " M src/a.ts\0R  src/new.ts\0src/old.ts\0?? notes.md\0",
    );
    expect(changes).toEqual([
      { path: "src/a.ts", status: "M", code: " M" },
      {
        path: "src/new.ts",
        status: "R",
        code: "R ",
        original: "src/old.ts",
      },
      { path: "notes.md", status: "U", code: "??" },
    ]);
  });

  it("skips records that are too short or misshapen", () => {
    expect(parseGitStatus("M\0 Mx\0\0")).toEqual([]);
  });
});

describe("sumNumstat", () => {
  it("adds the counted rows and skips binary ones", () => {
    expect(sumNumstat("3\t1\tsrc/a.ts\n-\t-\tlogo.png\n2\t0\tb.ts\n")).toEqual({
      additions: 5,
      deletions: 1,
    });
  });
});

describe("untrackedPatch", () => {
  it("builds a whole-file addition", () => {
    expect(untrackedPatch("notes.md", "one\ntwo\n")).toBe(
      [
        "diff --git a/notes.md b/notes.md",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/notes.md",
        "@@ -0,0 +1,2 @@",
        "+one",
        "+two",
        "",
      ].join("\n"),
    );
  });

  it("marks a file that does not end with a newline", () => {
    expect(untrackedPatch("a.txt", "one")).toContain(
      "\\ No newline at end of file",
    );
  });
});
