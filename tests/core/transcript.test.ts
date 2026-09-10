import { assistantEntry, userEntry } from "@adapters/fake/index";
import { projectTranscript, transcriptTitle } from "@core/transcript";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

const toolCallAssistant: SessionEntry = {
  type: "message",
  id: "a1",
  parentId: "u1",
  timestamp: "2026-09-10T00:00:00.000Z",
  message: {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "let me look" },
      {
        type: "toolCall",
        id: "call-1",
        name: "read",
        arguments: { path: "x" },
      },
    ],
    api: "openai-responses",
    provider: "fake",
    model: "fake-1",
    usage: {
      input: 90,
      output: 10,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 100,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "toolUse",
    timestamp: 0,
  },
};

const toolResult: SessionEntry = {
  type: "message",
  id: "t1",
  parentId: "a1",
  timestamp: "2026-09-10T00:00:00.000Z",
  message: {
    role: "toolResult",
    toolCallId: "call-1",
    toolName: "read",
    content: [{ type: "text", text: "file contents" }],
    isError: false,
    timestamp: 0,
  },
};

describe("projectTranscript", () => {
  it("folds tool results into the assistant message that called them", () => {
    const transcript = projectTranscript([
      userEntry("u1", null, "read x"),
      toolCallAssistant,
      toolResult,
      assistantEntry("a2", "t1", "done", 250),
    ]);
    expect(transcript.items.map((item) => item.kind)).toEqual([
      "user",
      "assistant",
      "assistant",
    ]);
    const first = transcript.items[1];
    expect(first?.kind === "assistant" && first.thinking).toBe("let me look");
    expect(first?.kind === "assistant" && first.toolCalls[0]?.result).toEqual({
      text: "file contents",
      isError: false,
    });
    expect(transcript.lastContextTokens).toBe(250);
    expect(transcript.lastModel).toEqual({ provider: "fake", id: "fake-1" });
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
});
