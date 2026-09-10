import { assistantEntry, userEntry } from "@adapters/fake/index";
import {
  conversationRail,
  hasBranches,
  messagePreview,
} from "@core/conversation-rail";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

function compaction(id: string, parentId: string | null): SessionEntry {
  return {
    type: "compaction",
    id,
    parentId,
    timestamp: new Date().toISOString(),
    summary: "earlier work",
    tokensBefore: 1000,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  } as SessionEntry;
}

/** u1 -> a1 -> u2 -> a2, with a second branch u2b -> a2b off a1. */
const branched: SessionEntry[] = [
  userEntry("u1", null, "first question"),
  assistantEntry("a1", "u1", "first answer", 100),
  userEntry("u2", "a1", "second question"),
  assistantEntry("a2", "u2", "second answer", 200),
  userEntry("u2b", "a1", "another way"),
  assistantEntry("a2b", "u2b", "other answer", 200),
];

describe("message preview", () => {
  it("collapses whitespace and stops at 100 characters", () => {
    expect(messagePreview("  hello   there \n friend ")).toBe(
      "hello there friend",
    );
    const long = "x".repeat(150);
    const preview = messagePreview(long);
    expect(preview).toHaveLength(100);
    expect(preview.endsWith("…")).toBe(true);
    expect(messagePreview("y".repeat(100))).toHaveLength(100);
  });
});

describe("conversation rail", () => {
  it("marks prompts, stars, and compactions of a linear session", () => {
    const entries: SessionEntry[] = [
      userEntry("u1", null, "why is it slow"),
      assistantEntry("a1", "u1", "because of the loop", 100),
      compaction("c1", "a1"),
      userEntry("u2", "c1", "fix it"),
      assistantEntry("a2", "u2", "done", 200),
    ];
    const marks = conversationRail(entries, "a2", new Set(["a2"]));
    expect(marks.map((mark) => [mark.id, mark.kind, mark.row])).toEqual([
      ["u1", "prompt", 0],
      ["c1", "compaction", 1],
      ["u2", "prompt", 2],
      ["a2", "star", 3],
    ]);
    expect(marks.every((mark) => mark.active && mark.lane === 0)).toBe(true);
    expect(marks[0]?.preview).toBe("why is it slow");
    // Stars and separators carry no preview, as in pi-web.
    expect(marks[1]?.preview).toBeUndefined();
    expect(marks[3]?.preview).toBeUndefined();
  });

  it("gives every branch its own lane and keeps the viewed one at lane 0", () => {
    const marks = conversationRail(branched, "a2b");
    const byId = new Map(marks.map((mark) => [mark.id, mark]));
    expect(byId.get("u1")?.lane).toBe(0);
    // The branch being viewed is sorted first, so it keeps lane 0.
    expect(byId.get("u2b")?.lane).toBe(0);
    expect(byId.get("u2b")?.active).toBe(true);
    expect(byId.get("u2")?.lane).toBe(1);
    expect(byId.get("u2")?.active).toBe(false);
    expect(byId.get("u2")?.row).toBe(1);
    expect(byId.get("u2b")?.row).toBe(1);
    expect(byId.get("u2")?.parentId).toBe("u1");
  });

  it("points every mark at the deepest mark of its own lane", () => {
    const marks = conversationRail(branched, "a2");
    const byId = new Map(marks.map((mark) => [mark.id, mark]));
    expect(byId.get("u2")?.targetLeafId).toBe("u2");
    expect(byId.get("u2b")?.targetLeafId).toBe("u2b");
    // The root's lane continues into the branch on screen.
    expect(byId.get("u1")?.targetLeafId).toBe("u2");
  });

  it("re-parents marks across the entries between them", () => {
    const entries: SessionEntry[] = [
      userEntry("u1", null, "one"),
      assistantEntry("a1", "u1", "answer", 100),
      assistantEntry("a2", "a1", "more", 150),
      userEntry("u2", "a2", "two"),
    ];
    const marks = conversationRail(entries, "u2");
    expect(marks.map((mark) => mark.id)).toEqual(["u1", "u2"]);
    expect(marks[1]?.parentId).toBe("u1");
  });

  it("sees a branch as soon as two entries share a parent", () => {
    expect(hasBranches(branched)).toBe(true);
    expect(
      hasBranches([
        userEntry("u1", null, "one"),
        assistantEntry("a1", "u1", "answer", 100),
      ]),
    ).toBe(false);
  });
});
