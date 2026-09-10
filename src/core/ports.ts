import type {
  AgentMessage,
  ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { SessionSummary } from "./sessions.ts";

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

/** Persisted sessions, read without starting an agent. */
export type SessionCatalog = {
  list(): Promise<SessionSummary[]>;
  /** Active-branch entries, root first. Undefined when the id is unknown. */
  read(
    id: string,
  ): Promise<{ summary: SessionSummary; branch: SessionEntry[] } | undefined>;
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
  subscribe(listener: (event: LiveEvent) => void): () => void;
  stop(): Promise<void>;
};

export type AgentRuntime = {
  get(sessionId: string): LiveSession | undefined;
  /** Resume a persisted session, or create a new one in `cwd`. */
  open(target: { sessionId: string } | { cwd: string }): Promise<LiveSession>;
};

export type ModelCatalog = {
  list(cwd: string): Promise<ModelOption[]>;
};
