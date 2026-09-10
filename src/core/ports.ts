import type {
  AgentMessage,
  ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
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

export type LiveStatus = {
  running: boolean;
  compacting: boolean;
  model: ModelOption | null;
  thinkingLevel: ThinkingLevel;
  thinkingLevels: ThinkingLevel[];
  /** Tokens in context as Pi reports them; null right after compaction. */
  contextTokens: number | null;
  queued: number;
  /** Extension status texts keyed by extension-chosen key. */
  statuses: Record<string, string>;
  /** Notices raised by extensions or failures since the last snapshot. */
  notices: { level: "info" | "warning" | "error"; message: string }[];
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
  status: LiveStatus;
};

export type LiveEvent =
  | { type: "activity" }
  | { type: "turn_done" }
  | { type: "stopped" };

/** One running Pi agent session. A deep module: callers only read
 *  snapshots and send commands; SDK event choreography stays inside. */
export type LiveSession = {
  readonly id: string;
  snapshot(): LiveSnapshot;
  prompt(text: string): Promise<void>;
  abort(): Promise<void>;
  setModel(provider: string, modelId: string): Promise<void>;
  setThinkingLevel(level: ThinkingLevel): void;
  setName(name: string): void;
  setStar(targetId: string, starred: boolean): void;
  /** Move the leaf to another entry. Returns the user text to re-edit, if any. */
  navigateTree(targetId: string): Promise<string | undefined>;
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

export type ModelCatalog = {
  list(cwd: string): Promise<ModelOption[]>;
};
