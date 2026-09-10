import { directoryWithin, isBashOutputPath } from "@core/path-access";
import { describe, expect, it } from "vitest";

describe("directoryWithin", () => {
  it("accepts the root itself and anything under it", () => {
    expect(directoryWithin("/repo", "/repo")).toBe(true);
    expect(directoryWithin("/repo", "/repo/src/web")).toBe(true);
    expect(directoryWithin("/repo/", "/repo/src/")).toBe(true);
  });

  it("rejects siblings, escapes, and relative paths", () => {
    expect(directoryWithin("/repo", "/repo-other")).toBe(false);
    expect(directoryWithin("/repo", "/repo/../etc")).toBe(false);
    expect(directoryWithin("/repo", "/etc/passwd")).toBe(false);
    expect(directoryWithin("/repo", "repo/src")).toBe(false);
    expect(directoryWithin("repo", "/repo/src")).toBe(false);
  });

  it("normalises Windows separators and drive roots", () => {
    expect(directoryWithin("C:/repo", "C:\\repo\\src")).toBe(true);
    expect(directoryWithin("C:/repo", "D:/repo/src")).toBe(false);
  });
});

describe("isBashOutputPath", () => {
  it("only accepts Pi's capture files directly in the temp directory", () => {
    expect(isBashOutputPath("/tmp", "/tmp/pi-bash-abc123.log")).toBe(true);
    expect(isBashOutputPath("/tmp", "/tmp/nested/pi-bash-a.log")).toBe(false);
    expect(isBashOutputPath("/tmp", "/tmp/other.log")).toBe(false);
    expect(isBashOutputPath("/tmp", "/tmp/pi-bash-../../etc/passwd")).toBe(
      false,
    );
    expect(isBashOutputPath("/tmp", "/var/pi-bash-a.log")).toBe(false);
  });
});
