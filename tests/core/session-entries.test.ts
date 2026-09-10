import { assistantEntry, userEntry } from "@adapters/fake/index";
import {
  branchLeaves,
  readStars,
  rowMetadata,
  sessionStats,
  STAR_TYPE,
} from "@core/session-entries";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

function star(
  id: string,
  parentId: string,
  targetId: string,
  starred: boolean,
): SessionEntry {
  return {
    type: "custom",
    customType: STAR_TYPE,
    data: { targetId, starred },
    id,
    parentId,
    timestamp: "2026-01-01T00:00:00.000Z",
  };
}

function at(entry: SessionEntry, timestamp: string): SessionEntry {
  return { ...entry, timestamp };
}

describe("stars", () => {
  it("takes the last write per target and only counts answers", () => {
    const entries = [
      userEntry("u1", null, "hi"),
      assistantEntry("a1", "u1", "one", 100),
      assistantEntry("a2", "a1", "two", 200),
      star("s1", "a2", "a1", true),
      star("s2", "s1", "a1", false),
      star("s3", "s2", "a2", true),
      star("s4", "s3", "u1", true),
    ];
    expect(readStars(entries)).toEqual(new Set(["a2"]));
  });
});

describe("session statistics", () => {
  it("counts every branch and skips the time a human spent typing", () => {
    const entries = [
      at(userEntry("u1", null, "hi"), "2026-01-01T00:00:00.000Z"),
      at(assistantEntry("a1", "u1", "one", 100), "2026-01-01T00:00:10.000Z"),
      // A minute of thinking before the next prompt is not active time.
      at(userEntry("u2", "a1", "more"), "2026-01-01T00:01:10.000Z"),
      at(assistantEntry("a2", "u2", "two", 300), "2026-01-01T00:01:15.000Z"),
      // A second branch off the first answer still counts towards totals.
      at(userEntry("u3", "a1", "other"), "2026-01-01T00:02:00.000Z"),
    ];
    const stats = sessionStats(entries);
    expect(stats).toMatchObject({
      userMessages: 3,
      assistantMessages: 2,
      toolCalls: 0,
      toolResults: 0,
      totalMessages: 5,
      activeMs: 15_000,
    });
    expect(stats.tokens.total).toBe(400);
    expect(stats.cacheHitRate).toBeNull();
  });
});

describe("branch leaves", () => {
  it("lists one tip per branch, labelled by its last request", () => {
    const entries = [
      userEntry("u1", null, "start"),
      assistantEntry("a1", "u1", "one", 100),
      userEntry("u2", "a1", "left"),
      userEntry("u3", "a1", "right"),
    ];
    const leaves = branchLeaves(entries, "u3");
    expect(leaves.map((leaf) => leaf.label)).toEqual(["right", "left"]);
    expect(leaves.map((leaf) => leaf.current)).toEqual([true, false]);
  });

  it("has a single leaf while nothing has branched", () => {
    const entries = [
      userEntry("u1", null, "start"),
      assistantEntry("a1", "u1", "one", 100),
    ];
    expect(branchLeaves(entries, "a1")).toHaveLength(1);
  });
});

describe("row metadata", () => {
  it("takes the last name, the first request, and counts messages", () => {
    const entries: SessionEntry[] = [
      userEntry("u1", null, "  first   request "),
      assistantEntry("a1", "u1", "one", 100),
      {
        type: "session_info",
        name: "Named",
        id: "i1",
        parentId: "a1",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
      {
        type: "session_info",
        name: "  ",
        id: "i2",
        parentId: "i1",
        timestamp: "2026-01-01T00:00:01.000Z",
      },
      star("s1", "i2", "a1", true),
    ];
    expect(
      rowMetadata(entries, { modifiedAt: "2026-01-01", fileSize: 12 }),
    ).toEqual({
      firstMessage: "first request",
      messageCount: 2,
      starCount: 1,
      modifiedAt: "2026-01-01",
      fileSize: 12,
    });
  });
});
