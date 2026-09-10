import {
  compareSessions,
  groupByProject,
  relativeTime,
  sessionTitle,
  type SessionSummary,
} from "@core/sessions";
import { describe, expect, it } from "vitest";

function summary(
  id: string,
  extra: Partial<SessionSummary> = {},
): SessionSummary {
  return {
    id,
    cwd: "/repo/one",
    createdAt: "2026-01-01T00:00:00.000Z",
    modifiedAt: "2026-01-01T00:00:00.000Z",
    fileSize: 0,
    ...extra,
  };
}

describe("session titles", () => {
  it("prefers the name, then the first message, then the id", () => {
    const meta = {
      firstMessage: "  Explain   the   parser  ",
      messageCount: 2,
      starCount: 0,
      modifiedAt: "2026-01-01",
      fileSize: 1,
    };
    expect(sessionTitle(summary("abcdefghijklmnop"), meta)).toBe(
      "Explain the parser",
    );
    expect(
      sessionTitle(summary("abcdefghijklmnop"), { ...meta, name: "Parser" }),
    ).toBe("Parser");
    expect(
      sessionTitle(summary("abcdefghijklmnop"), { ...meta, firstMessage: "" }),
    ).toBe("abcdefghijkl");
    expect(
      sessionTitle(summary("x"), { ...meta, firstMessage: "y".repeat(80) }),
    ).toHaveLength(50);
  });
});

describe("sidebar order and grouping", () => {
  it("puts working sessions first, then live ones, then the newest", () => {
    const rows = [
      summary("old", { modifiedAt: "2026-01-01T00:00:00.000Z" }),
      summary("new", { modifiedAt: "2026-02-01T00:00:00.000Z" }),
      summary("live", { live: true, modifiedAt: "2025-01-01T00:00:00.000Z" }),
      summary("busy", {
        live: true,
        running: true,
        modifiedAt: "2024-01-01T00:00:00.000Z",
      }),
    ];
    expect([...rows].sort(compareSessions).map((row) => row.id)).toEqual([
      "busy",
      "live",
      "new",
      "old",
    ]);
  });

  it("groups worktrees of one checkout under its project root", () => {
    const groups = groupByProject([
      summary("a", { cwd: "/repo/main", projectRoot: "/repo/main" }),
      summary("b", { cwd: "/repo/wt", projectRoot: "/repo/main" }),
      summary("c", { cwd: "/other" }),
    ]);
    expect(groups.map((group) => group.root)).toEqual(["/repo/main", "/other"]);
    expect(groups[0]?.sessions.map((row) => row.id)).toEqual(["a", "b"]);
  });
});

describe("relative time", () => {
  it("shortens the age until a date is clearer", () => {
    const now = Date.parse("2026-03-01T12:00:00.000Z");
    expect(relativeTime("2026-03-01T11:59:30.000Z", now)).toBe("now");
    expect(relativeTime("2026-03-01T11:30:00.000Z", now)).toBe("30m");
    expect(relativeTime("2026-03-01T06:00:00.000Z", now)).toBe("6h");
    expect(relativeTime("2026-02-25T12:00:00.000Z", now)).toBe("4d");
    expect(relativeTime("2025-12-01T12:00:00.000Z", now)).toBe("2025-12-01");
  });
});
