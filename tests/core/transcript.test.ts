import { assistantEntry, userEntry } from "@adapters/fake/index";
import {
  deferThinking,
  projectTranscript,
  toolPreview,
  toolProgress,
  transcriptTitle,
} from "@core/transcript";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

function assistantWith(
  id: string,
  parentId: string | null,
  content: unknown[],
  timestamp = 0,
): SessionEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: "2026-09-10T00:00:00.000Z",
    message: {
      role: "assistant",
      content: content as never,
      api: "openai-responses",
      provider: "fake",
      model: "fake-1",
      usage: {
        input: 90,
        output: 10,
        cacheRead: 5,
        cacheWrite: 3,
        totalTokens: 100,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "toolUse",
      timestamp,
    },
  };
}

function toolResult(
  id: string,
  parentId: string,
  options: {
    toolCallId?: string;
    text?: string;
    details?: unknown;
    isError?: boolean;
    timestamp?: number;
  } = {},
): SessionEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: "2026-09-10T00:00:00.000Z",
    message: {
      role: "toolResult",
      toolCallId: options.toolCallId ?? "call-1",
      toolName: "read",
      content: [{ type: "text", text: options.text ?? "file contents" }],
      ...(options.details === undefined ? {} : { details: options.details }),
      isError: options.isError ?? false,
      timestamp: options.timestamp ?? 0,
    },
  };
}

const readCall = {
  type: "toolCall",
  id: "call-1",
  name: "read",
  arguments: { path: "/repo/x.ts", extra: 1 },
};

describe("projectTranscript", () => {
  it("folds a tool result into the call that asked for it", () => {
    const transcript = projectTranscript([
      userEntry("u1", null, "read x"),
      assistantWith("a1", "u1", [
        { type: "thinking", thinking: "let me look" },
        readCall,
      ]),
      toolResult("t1", "a1", { timestamp: 4000 }),
      assistantEntry("a2", "t1", "done", 250),
    ]);
    expect(transcript.items.map((item) => item.kind)).toEqual([
      "user",
      "assistant",
      "assistant",
    ]);
    const first = transcript.items[1];
    if (first?.kind !== "assistant") throw new Error("expected an assistant");
    expect(first.blocks[0]).toMatchObject({
      kind: "thinking",
      text: "let me look",
      index: 0,
    });
    const call = first.blocks[1];
    if (call?.kind !== "tool") throw new Error("expected a tool call");
    expect(call.call.preview).toBe("/repo/x.ts");
    expect(call.call.result).toMatchObject({
      entryId: "t1",
      text: "file contents",
      isError: false,
      seconds: 4,
    });
    expect(first.usage).toMatchObject({ cacheRead: 5, cacheWrite: 3 });
    expect(transcript.lastContextTokens).toBe(250);
  });

  it("renders a reported patch as a diff instead of text", () => {
    const patch = "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n";
    const transcript = projectTranscript([
      assistantWith("a1", null, [readCall]),
      toolResult("t1", "a1", { details: { patch } }),
    ]);
    const item = transcript.items[0];
    if (item?.kind !== "assistant") throw new Error("expected an assistant");
    const call = item.blocks[0];
    expect(call?.kind === "tool" && call.call.result?.patch).toBe(patch);
  });

  it("keeps an errored result as text, never as a diff", () => {
    const transcript = projectTranscript([
      assistantWith("a1", null, [readCall]),
      toolResult("t1", "a1", { details: { patch: "x" }, isError: true }),
    ]);
    const item = transcript.items[0];
    if (item?.kind !== "assistant") throw new Error("expected an assistant");
    const call = item.blocks[0];
    expect(call?.kind === "tool" && call.call.result?.patch).toBeUndefined();
    expect(call?.kind === "tool" && call.call.result?.isError).toBe(true);
  });

  it("pairs subagent runs with their calls and refuses a mismatch", () => {
    const calls = {
      type: "toolCall",
      id: "call-2",
      name: "subagent",
      arguments: {
        calls: [
          { agent: "explorer", prompt: "look around", model: "fake-1" },
          { agent: "writer", prompt: "write it up" },
        ],
      },
    };
    const details = {
      kind: "pi-subagent",
      results: [
        {
          agent: "explorer",
          exitCode: 0,
          model: "fake-1",
          messages: [
            {
              role: "assistant",
              content: [{ type: "text", text: "found it" }],
            },
          ],
        },
        { agent: "writer", exitCode: 2, messages: [], stderr: "boom" },
      ],
    };
    const paired = projectTranscript([
      assistantWith("a1", null, [calls]),
      toolResult("t1", "a1", { toolCallId: "call-2", details }),
    ]);
    const item = paired.items[0];
    if (item?.kind !== "assistant") throw new Error("expected an assistant");
    const block = item.blocks[0];
    if (block?.kind !== "tool") throw new Error("expected a tool call");
    expect(block.call.subagent?.runs).toEqual([
      {
        status: "completed",
        output: "found it",
        model: "fake-1",
        captureTruncated: false,
        handledWithoutAgent: false,
      },
      {
        status: "failed",
        output: "",
        error: "boom",
        captureTruncated: false,
        handledWithoutAgent: false,
      },
    ]);

    const wrong = projectTranscript([
      assistantWith("a1", null, [calls]),
      toolResult("t1", "a1", {
        toolCallId: "call-2",
        details: { kind: "pi-subagent", results: [{ agent: "nope" }] },
      }),
    ]);
    const other = wrong.items[0];
    if (other?.kind !== "assistant") throw new Error("expected an assistant");
    const raw = other.blocks[0];
    expect(raw?.kind === "tool" && raw.call.subagent?.runs).toBeNull();
  });

  it("shows a skill expansion as the command that produced it", () => {
    const expansion = `<skill name="testing" location="/repo/.agents">\nReferences are relative to /repo/.agents.\n\nHow this repository tests things\n</skill>\n\nrun the unit tests`;
    const transcript = projectTranscript([userEntry("u1", null, expansion)]);
    const item = transcript.items[0];
    expect(item?.kind === "user" && item.command).toBe(
      "/skill:testing run the unit tests",
    );
    expect(transcriptTitle(transcript)).toBe(
      "/skill:testing run the unit tests",
    );
  });

  it("splits the file sections out of a compaction summary", () => {
    const transcript = projectTranscript([
      {
        type: "compaction",
        id: "c1",
        parentId: null,
        timestamp: "2026-09-10T00:00:00.000Z",
        summary:
          "We fixed the parser.\n\n<read-files>\n/repo/a.ts\n</read-files>\n<modified-files>\n/repo/b.ts\n</modified-files>",
        firstKeptEntryId: "u1",
        tokensBefore: 40_000,
      },
    ]);
    expect(transcript.items[0]).toMatchObject({
      kind: "compaction",
      summary: "We fixed the parser.",
      readFiles: ["/repo/a.ts"],
      modifiedFiles: ["/repo/b.ts"],
      tokensBefore: 40_000,
    });
  });

  it("skips hidden entries and keeps displayed custom messages", () => {
    const transcript = projectTranscript([
      userEntry("u1", null, "hi"),
      {
        type: "model_change",
        id: "m1",
        parentId: "u1",
        timestamp: "",
        provider: "p",
        modelId: "m",
      },
      {
        type: "custom_message",
        id: "c1",
        parentId: "m1",
        timestamp: "",
        customType: "note",
        content: "shown",
        display: true,
        details: { a: 1 },
      },
      {
        type: "custom_message",
        id: "c2",
        parentId: "c1",
        timestamp: "",
        customType: "note",
        content: "hidden",
        display: false,
      },
    ]);
    expect(transcript.items.map((item) => item.kind)).toEqual(["user", "note"]);
    const note = transcript.items[1];
    expect(note?.kind === "note" && note.details).toBe('{\n  "a": 1\n}');
    expect(transcriptTitle(transcript)).toBe("hi");
  });

  it("ignores usage of aborted messages for context accounting", () => {
    const aborted = assistantEntry("a1", null, "partial", 900);
    if (aborted.type === "message" && aborted.message.role === "assistant") {
      aborted.message.stopReason = "aborted";
    }
    const transcript = projectTranscript([
      assistantEntry("a0", null, "ok", 300),
      aborted,
    ]);
    expect(transcript.lastContextTokens).toBe(300);
  });

  it("defers the oldest reasoning once the page budget is spent", () => {
    const long = "x".repeat(15_000);
    const transcript = projectTranscript([
      assistantWith("a1", null, [{ type: "thinking", thinking: long }]),
      assistantWith("a2", "a1", [{ type: "thinking", thinking: long }]),
      assistantWith("a3", "a2", [{ type: "thinking", thinking: long }]),
    ]);
    deferThinking(transcript.items);
    const deferred = transcript.items.map((item) =>
      item.kind === "assistant" && item.blocks[0]?.kind === "thinking"
        ? item.blocks[0].deferred
        : null,
    );
    expect(deferred).toEqual([true, false, false]);
  });
});

describe("tool text helpers", () => {
  it("prefers the telling argument and caps the preview", () => {
    expect(toolPreview({ command: "ls  -la\n/tmp" })).toBe("ls -la /tmp");
    expect(toolPreview({ other: { a: 1 } })).toBe('{"a":1}');
    expect(toolPreview({ query: "y".repeat(200) })).toHaveLength(120);
  });

  it("reports the last non-blank line a running tool printed", () => {
    expect(
      toolProgress({ content: [{ type: "text", text: "one\n\n  two  \n" }] }),
    ).toBe("two");
    expect(toolProgress({ content: [] })).toBeUndefined();
    expect(toolProgress("nope")).toBeUndefined();
  });
});
