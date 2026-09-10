import type {
  AgentMessage,
  ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { FileEntry, SlashCommand } from "./composer.ts";
import type { SessionRowMetadata, SessionSummary } from "./sessions.ts";

// Outbound ports. The core describes what it needs from Pi and the file
// system; adapters in src/adapters implement them. Everything here is an
// Internal interface: all consumers live in this repository.

export type ModelOption = {
  provider: string;
  id: string;
  name: string;
  contextWindow: number;
  reasoning: boolean;
};

export type { ThinkingLevel };

export type SessionRead = {
  summary: SessionSummary;
  /** Entries of the requested branch (the active one by default), root first. */
  branch: SessionEntry[];
  /** Every entry in the file, all branches, for stars, stats, and leaves. */
  entries: SessionEntry[];
  leafId: string | null;
};

/** Pi's session files: read without starting an agent, and edited in place. */
export type SessionCatalog = {
  /** Headers only, so a store with thousands of sessions stays cheap. */
  list(): Promise<SessionSummary[]>;
  /** Undefined when the id is unknown. */
  read(id: string, leafId?: string): Promise<SessionRead | undefined>;
  /**
   * One sidebar row: the header summary plus the counts a full pass over the
   * file yields. Cached by size and mtime, so a second visit is free.
   */
  rowMetadata(
    id: string,
  ): Promise<
    { summary: SessionSummary; metadata: SessionRowMetadata } | undefined
  >;
  rename(id: string, name: string): Promise<void>;
  /** Deletes the file and re-attaches its children to its own parent. */
  remove(id: string): Promise<void>;
  setStar(id: string, targetId: string, starred: boolean): Promise<void>;
  /** New session file holding the path from root to `entryId`. */
  fork(id: string, entryId: string): Promise<{ id: string; text: string }>;
  /** New session file holding the path from root to a branch tip. */
  clone(id: string, leafId?: string): Promise<string>;
  /** Removes a user message and everything after it. Returns its text. */
  rewind(id: string, entryId: string): Promise<string>;
  exportHtml(id: string): Promise<{ html: string; filename: string }>;
};

/** Where a working folder belongs: its git top level and checked-out branch. */
export type ProjectResolver = {
  resolve(cwd: string): Promise<{ root: string; branch: string | null }>;
};

export type Notice = { level: "info" | "warning" | "error"; message: string };

export type ImageAttachment = { data: string; mimeType: string };

export type QueuedMessage = { text: string; behavior: "steer" | "followUp" };

/** A thinking level plus the label the model gives it. */
export type ThinkingChoice = { level: ThinkingLevel; label: string };

export type CompactionSummary = {
  tokensBefore: number;
  tokensAfter: number | null;
  reason: string;
};

/** A tool executing right now, with the last line it reported. */
export type RunningTool = { name: string; progress?: string };

/** Pi is retrying a failed provider call by itself. */
export type RetryState = {
  attempt: number;
  maxAttempts: number;
  message: string;
};

export type LiveStatus = {
  running: boolean;
  compacting: boolean;
  bashRunning: boolean;
  model: ModelOption | null;
  thinkingLevel: ThinkingLevel;
  thinkingLevels: ThinkingChoice[];
  /** Tokens in context as Pi reports them; null right after compaction. */
  contextTokens: number | null;
  queue: QueuedMessage[];
  /** The last compaction that finished, for the success strip. */
  compaction: CompactionSummary | null;
  /** Tools running right now, for the activity line. */
  tools: RunningTool[];
  /** Set while Pi retries a failed provider call. */
  retry: RetryState | null;
  /** Extension status texts keyed by extension-chosen key. */
  statuses: Record<string, string>;
  /** Notices raised by extensions or failures since the last snapshot. */
  notices: Notice[];
};

export type LiveSnapshot = {
  summary: SessionSummary;
  /** Every entry on the active branch, root first. */
  branch: SessionEntry[];
  /** Every entry of the session, all branches. */
  entries: SessionEntry[];
  /** Index into `branch` where the current or last turn began. */
  turnStart: number;
  /** In-progress assistant message while streaming. */
  partial?: Extract<AgentMessage, { role: "assistant" }>;
  /** Shell command running right now, with the output collected so far. */
  bash?: { command: string; output: string };
  status: LiveStatus;
};

export type LiveEvent =
  | { type: "activity" }
  | { type: "turn_done" }
  | { type: "stopped" };

export type PromptInput = {
  images?: ImageAttachment[];
  /** How to deliver the message while a turn runs. Default: steer. */
  behavior?: "steer" | "followUp";
};

/** One running Pi agent session. A deep module: callers only read
 *  snapshots and send commands; SDK event choreography stays inside. */
export type LiveSession = {
  readonly id: string;
  snapshot(): LiveSnapshot;
  prompt(text: string, input?: PromptInput): Promise<void>;
  abort(): Promise<void>;
  setModel(provider: string, modelId: string): Promise<void>;
  setThinkingLevel(level: ThinkingLevel): void;
  setName(name: string): void;
  setStar(targetId: string, starred: boolean): void;
  /** Move the leaf to another entry. Returns the user text to re-edit, if any. */
  navigateTree(targetId: string): Promise<string | undefined>;
  /** Extension commands, prompt templates, and skills this session knows. */
  commands(): SlashCommand[];
  compact(instructions?: string): Promise<void>;
  abortCompaction(): void;
  reload(): Promise<void>;
  /** Empties the queue and hands the messages back for the composer. */
  clearQueue(): QueuedMessage[];
  runBash(command: string, excludeFromContext: boolean): Promise<void>;
  abortBash(): void;
  subscribe(listener: (event: LiveEvent) => void): () => void;
  stop(): Promise<void>;
};

/** Lifecycle of every live session in this process, for the sidebar. */
export type RuntimeEvent = {
  type: "opened" | "finished" | "stopped";
  sessionId: string;
};

export type AgentRuntime = {
  get(sessionId: string): LiveSession | undefined;
  /** Resume a persisted session, or create a new one in `cwd`. */
  open(target: { sessionId: string } | { cwd: string }): Promise<LiveSession>;
  subscribeAll(listener: (event: RuntimeEvent) => void): () => void;
};

/** Models in scope for a folder, plus what `enabledModels` could not resolve. */
export type ModelListing = { models: ModelOption[]; warnings: string[] };

export type ModelCatalog = {
  list(cwd: string): Promise<ModelListing>;
};

/**
 * Prompt templates and skills a folder offers, read without starting an
 * agent. Project extensions are never loaded here: listing commands must not
 * run an untrusted repository's code.
 */
export type ProjectResources = {
  commands(cwd: string): Promise<SlashCommand[]>;
};

/** Files under a working folder, for `@` completion and shell output. */
export type Files = {
  /** Every tracked and untracked file, cwd-relative; capped. */
  index(cwd: string): Promise<{ files: string[]; truncated: boolean }>;
  /**
   * Immediate children matching a path-like query (`~/pro`, `./src/co`),
   * resolved against `cwd`. Absolute paths, capped; the caller decides which
   * of them the requester may see.
   */
  children(query: string, cwd: string): Promise<FileEntry[]>;
  /** A shell-output capture file, capped; throws when it cannot be read. */
  readOutput(path: string): Promise<string>;
};
