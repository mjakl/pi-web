import type {
  AssistantItem,
  ToolCallView,
  TranscriptItem,
} from "@core/transcript";

// One item of every kind the transcript renders, with the branches each view
// takes: skill commands, images, deferred thinking, split and unparseable
// diffs, cut results, subagents, extension notes with and without details,
// truncated and pending shell runs, errors and aborts. The rendered HTML is
// pinned in transcript-items.html so a refactor of the views cannot move a
// class, an attribute or an inline style.

/**
 * A patch that overruns the 200-row budget of a settled card: the first file
 * is cut short, the second does not fit at all.
 */
function longPatch(): string {
  const lines = Array.from(
    { length: 210 },
    (_, index) => `+new line ${String(index + 1)}`,
  );
  return [
    "--- a/src/big.ts",
    "+++ b/src/big.ts",
    "@@ -0,0 +1,210 @@",
    ...lines,
    "--- a/src/tail.ts",
    "+++ b/src/tail.ts",
    "@@ -1 +1 @@",
    "-a",
    "+b",
  ].join("\n");
}

const readCall: ToolCallView = {
  id: "call-read",
  name: "read",
  arguments: { path: "src/app.ts" },
  preview: "src/app.ts",
  result: {
    entryId: "r1",
    text: "export const app = 1;\n",
    isError: false,
    images: [],
    seconds: 2,
  },
};

const editCall: ToolCallView = {
  id: "call-edit",
  name: "edit",
  arguments: { file_path: "src/app.ts", old_string: "1", new_string: "2" },
  preview: "src/app.ts",
  result: {
    entryId: "r2",
    text: "ok",
    isError: false,
    images: [],
    patch:
      "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,2 +1,2 @@\n-export const app = 1;\n+export const app = 2;\n context\n" +
      "--- a/src/other.ts\n+++ b/src/other.ts\n@@ -1 +1 @@\n-a\n+b\n",
    seconds: 1,
  },
};

const brokenPatchCall: ToolCallView = {
  id: "call-broken",
  name: "write",
  arguments: { path: "notes.md", content: "hello" },
  preview: "notes.md",
  result: {
    entryId: "r3",
    text: "written",
    isError: false,
    images: [],
    patch: "not a patch\n+added\n-removed\n",
  },
};

const longDiffCall: ToolCallView = {
  id: "call-long",
  name: "edit",
  arguments: { file_path: "src/big.ts" },
  preview: "src/big.ts",
  result: {
    entryId: "r4",
    text: "ok",
    isError: false,
    images: [],
    patch: longPatch(),
  },
};

const failedCall: ToolCallView = {
  id: "call-bash",
  name: "bash",
  arguments: { command: "false" },
  preview: "false",
  result: {
    entryId: "r5",
    text: "exit 1 <b>",
    isError: true,
    images: [],
    seconds: 0,
  },
};

const imageCall: ToolCallView = {
  id: "call-shot",
  name: "screenshot",
  arguments: { url: "https://example.test" },
  preview: "https://example.test",
  result: { entryId: "r6", text: "(no output)", isError: false, images: [0] },
};

const longTextCall: ToolCallView = {
  id: "call-cat",
  name: "bash",
  arguments: { command: "cat big.log" },
  preview: "cat big.log",
  result: {
    entryId: "r7",
    text: "x".repeat(17 * 1024),
    isError: false,
    images: [],
  },
};

const emptyCall: ToolCallView = {
  id: "call-empty",
  name: "ls",
  arguments: { path: "*.ts" },
  preview: "*.ts",
  result: { entryId: "r8", text: "   ", isError: false, images: [] },
};

const runningCall: ToolCallView = {
  id: "call-running",
  name: "grep",
  arguments: { pattern: "todo" },
  preview: "todo",
};

const partialCall: ToolCallView = {
  id: "call-partial",
  name: "write",
  arguments: {},
  preview: "",
  partialArguments: '{"path": "src/ne',
};

const subagentSingle: ToolCallView = {
  id: "call-sub1",
  name: "subagent",
  arguments: { agent: "reviewer", prompt: "Review the diff" },
  preview: "reviewer",
  result: {
    entryId: "r9",
    text: "Looks fine.",
    isError: false,
    images: [],
    seconds: 95,
  },
  subagent: {
    calls: [
      {
        agent: "reviewer",
        prompt: "Review the diff",
        model: "fake/model",
        cwd: "/repo/one",
        initialContext: "diff",
        session: "sub.1",
      },
    ],
    runs: [
      {
        status: "completed",
        output: "Looks **fine**.",
        model: "fake/model",
        cwd: "/repo/one",
        captureTruncated: true,
        handledWithoutAgent: false,
      },
    ],
    failed: false,
  },
};

const subagentMulti: ToolCallView = {
  id: "call-sub2",
  name: "subagent",
  arguments: { agents: ["a", "b", "c"] },
  preview: "3 agents",
  result: {
    entryId: "r10",
    text: "mixed",
    isError: false,
    images: [],
    seconds: 3725,
  },
  subagent: {
    calls: [
      { agent: "a", prompt: "one" },
      { agent: "b", prompt: "two", model: "m" },
      { agent: "c", prompt: "three" },
    ],
    runs: [
      {
        status: "completed",
        output: "",
        captureTruncated: false,
        handledWithoutAgent: true,
      },
      {
        status: "failed",
        output: "",
        error: "boom",
        captureTruncated: false,
        handledWithoutAgent: false,
      },
      {
        status: "cancelled",
        output: "",
        captureTruncated: false,
        handledWithoutAgent: false,
      },
    ],
    failed: false,
  },
};

const subagentUnmatched: ToolCallView = {
  id: "call-sub3",
  name: "subagent",
  arguments: { agent: "x" },
  preview: "x",
  result: { entryId: "r11", text: "", isError: false, images: [] },
  subagent: { calls: [{ agent: "x", prompt: "p" }], runs: null, failed: true },
};

const subagentRunning: ToolCallView = {
  id: "call-sub4",
  name: "subagent",
  arguments: { agent: "worker" },
  preview: "worker",
  subagent: {
    calls: [{ agent: "worker", prompt: "work" }],
    runs: null,
    failed: false,
  },
};

/** The answer of the first turn: text, usage, a star, a visible time. */
export const answerItem: AssistantItem = {
  kind: "assistant",
  entryId: "a2",
  model: "fake-model",
  provider: "fake",
  blocks: [
    { kind: "text", text: "Done. See `app.ts`.\n\n```ts\nconst x = 1;\n```" },
  ],
  stopReason: "stop",
  usage: {
    input: 1200,
    output: 34,
    cacheRead: 500,
    cacheWrite: 0,
    total: 1734,
  },
  timestamp: "2026-01-05T13:09:00.000Z",
};

/** A settled conversation: several turns, every card kind among them. */
export const settledItems: TranscriptItem[] = [
  {
    kind: "user",
    entryId: "u1",
    text: "Fix the <b>bug</b> in `app.ts`",
    images: [0, 1],
    timestamp: "2026-01-05T13:07:00.000Z",
  },
  {
    kind: "assistant",
    entryId: "a1",
    model: "fake-model",
    provider: "fake",
    processHalf: true,
    blocks: [
      {
        kind: "thinking",
        index: 0,
        text: "Let me *look*.",
        deferred: false,
        seconds: 4,
      },
      { kind: "thinking", index: 1, text: "", deferred: true },
      { kind: "tool", call: readCall },
      { kind: "tool", call: editCall },
      { kind: "tool", call: brokenPatchCall },
      { kind: "tool", call: failedCall },
      { kind: "tool", call: imageCall },
      { kind: "tool", call: emptyCall },
      { kind: "image", index: 0 },
    ],
    stopReason: "toolUse",
    timestamp: "2026-01-05T13:08:00.000Z",
  },
  answerItem,
  {
    kind: "compaction",
    entryId: "c1",
    summary: "## Summary\n\nEverything before this.",
    readFiles: ["src/app.ts", "README.md"],
    modifiedFiles: ["src/app.ts"],
    tokensBefore: 84_000,
    tokensAfter: 12_000,
    timestamp: "2026-01-05T13:10:00.000Z",
  },
  {
    kind: "branch_summary",
    entryId: "b1",
    summary: "Tried another approach and *came back*.",
    timestamp: "2026-01-05T13:11:00.000Z",
  },
  {
    kind: "note",
    entryId: "n1",
    customType: "my-ext",
    text: "Extension says **hi**",
    preview: "Extension says hi",
    images: [0],
    details: "raw <details> payload",
    timestamp: "2026-01-05T13:12:00.000Z",
  },
  {
    kind: "note",
    entryId: "n2",
    customType: "",
    text: "",
    preview: "",
    images: [],
    timestamp: "not a date",
  },
  {
    kind: "bash",
    entryId: "sh1",
    command: "ls -la",
    output: "total 0\n",
    exitCode: 0,
    cancelled: false,
    truncated: true,
    outputPath: "/tmp/pi-bash-1.log",
    excluded: false,
    pending: false,
    timestamp: "2026-01-05T13:13:00.000Z",
  },
  {
    kind: "bash",
    entryId: "sh2",
    command: "make",
    output: "error",
    exitCode: 2,
    cancelled: false,
    truncated: false,
    excluded: true,
    pending: false,
    timestamp: "2026-01-05T13:14:00.000Z",
  },
  {
    kind: "user",
    entryId: "u2",
    text: "# Skill body\n\nexpanded",
    images: [],
    command: "/skill:deploy staging now",
    timestamp: "2026-01-04T23:30:00.000Z",
  },
  {
    kind: "assistant",
    entryId: "a3",
    model: "fake-model",
    provider: "fake",
    blocks: [
      { kind: "tool", call: subagentSingle },
      { kind: "tool", call: subagentMulti },
      { kind: "tool", call: subagentUnmatched },
    ],
    stopReason: "error",
    errorMessage: "Provider <failed>",
    timestamp: "2025-12-31T09:00:00.000Z",
  },
  {
    kind: "user",
    entryId: "u3",
    text: "/skill:solo",
    images: [],
    command: "/skill:solo",
    timestamp: "2026-01-05T13:16:00.000Z",
  },
  {
    kind: "assistant",
    entryId: "a4",
    model: "fake-model",
    provider: "fake",
    blocks: [],
    stopReason: "aborted",
    timestamp: "2026-01-05T13:17:00.000Z",
  },
  {
    kind: "assistant",
    entryId: "a5",
    model: "fake-model",
    provider: "fake",
    blocks: [],
    stopReason: "stop",
    timestamp: "2026-01-05T13:18:00.000Z",
  },
];

/** The running turn: a question, a streaming answer, a pending shell run. */
export const liveItems: TranscriptItem[] = [
  {
    kind: "user",
    entryId: "u9",
    text: "Keep going",
    images: [],
    timestamp: "2026-01-05T14:00:00.000Z",
  },
  {
    kind: "assistant",
    entryId: "partial",
    model: "fake-model",
    provider: "fake",
    blocks: [
      { kind: "text", text: "Working on it" },
      { kind: "tool", call: runningCall },
      { kind: "tool", call: partialCall },
      { kind: "tool", call: subagentRunning },
      { kind: "thinking", index: 0, text: "hmm", deferred: false },
    ],
    stopReason: "",
    timestamp: "2026-01-05T14:00:30.000Z",
  },
  {
    kind: "bash",
    entryId: "bash-pending",
    command: "sleep 5",
    output: "",
    exitCode: null,
    cancelled: false,
    truncated: false,
    excluded: false,
    pending: true,
    timestamp: "2026-01-05T14:00:40.000Z",
  },
];

export const fixtureCalls = { longTextCall, longDiffCall, editCall };
