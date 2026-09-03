import type { AgentMessage, SessionContext, SessionInfo } from "./types";
import { userMessageKey } from "./prompt-recovery";
import { getPresetFromToolNames } from "./tool-presets";

export interface PersistedAuthority {
  acceptedSnapshotOrder: number;
  acceptedTranscriptOrder: number;
  sessionId: string;
  runId: number;
}

export interface PersistedSnapshotRequest {
  order: number;
  sessionId: string;
  runId: number;
}

export interface PaginationRequest {
  order: number;
  sessionId: string;
  transcriptBaseline: number;
  refreshOrder: number;
}

export interface BranchContextRequest {
  intentOrder: number;
  sessionId: string;
  runId: number;
}

export function canAcceptPersistedSnapshot(
  request: PersistedSnapshotRequest,
  current: PersistedAuthority,
  latestRequestOrder: number,
): boolean {
  return request.order === latestRequestOrder
    && request.sessionId === current.sessionId
    && request.runId === current.runId
    && request.order >= current.acceptedSnapshotOrder
    && request.order >= current.acceptedTranscriptOrder;
}

export function canAcceptPagination(
  request: PaginationRequest,
  current: Pick<PersistedAuthority, "sessionId" | "acceptedTranscriptOrder"> & { latestRefreshOrder: number },
): boolean {
  return request.sessionId === current.sessionId
    && request.transcriptBaseline === current.acceptedTranscriptOrder
    && request.refreshOrder === current.latestRefreshOrder;
}

export function canAcceptBranchContext(
  request: BranchContextRequest,
  current: PersistedAuthority,
): boolean {
  return request.sessionId === current.sessionId
    && request.runId === current.runId
    && request.intentOrder === current.acceptedTranscriptOrder;
}

export function enqueuePersistedWrite<T>(
  previous: Promise<void>,
  write: () => Promise<T>,
): { result: Promise<T>; settled: Promise<void> } {
  const result = previous.then(write);
  return { result, settled: result.then(() => undefined, () => undefined) };
}

function sameExactMessage(left: AgentMessage, right: AgentMessage): boolean {
  if (left.role !== right.role) return false;
  if (left.timestamp !== undefined && right.timestamp !== undefined) {
    return left.timestamp === right.timestamp;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameMessage(left: AgentMessage, right: AgentMessage): boolean {
  return sameExactMessage(left, right)
    || (left.role === "user" && right.role === "user" && userMessageKey(left) === userMessageKey(right));
}

export function mergeTranscriptRefreshMessages(
  persisted: AgentMessage[],
  current: AgentMessage[],
  previousPersisted: AgentMessage[],
): AgentMessage[] {
  const liveTail = current.slice(previousPersisted.length);
  const previousLast = previousPersisted.at(-1);
  const previousBoundary = previousLast
    ? persisted.findLastIndex((message) => sameExactMessage(message, previousLast))
    : -1;
  const refreshedTail = persisted.slice(previousBoundary + 1);
  let liveIndex = previousBoundary >= 0
    ? 0
    : liveTail.findIndex((liveMessage) => (
      refreshedTail.some((message) => sameExactMessage(message, liveMessage))
    ));
  if (liveIndex < 0) {
    liveIndex = liveTail.findIndex((liveMessage) => (
      refreshedTail.some((message) => sameMessage(message, liveMessage))
    ));
  }
  if (liveIndex < 0) return [...persisted, ...liveTail];

  let refreshedIndex = 0;
  while (liveIndex < liveTail.length) {
    const matchIndex = refreshedTail.findIndex((message, index) => (
      index >= refreshedIndex && sameMessage(message, liveTail[liveIndex])
    ));
    if (matchIndex < 0) break;
    refreshedIndex = matchIndex + 1;
    liveIndex += 1;
  }
  return liveIndex === liveTail.length
    ? persisted
    : [...persisted, ...liveTail.slice(liveIndex)];
}

export function getPersistedThinkingLevel(level: string | null): string {
  return level ?? "auto";
}

export function projectPersistedSnapshot<T extends {
  info?: SessionInfo | null;
  leafId: string | null;
  toolNames?: string[];
  context: SessionContext;
}>(data: T) {
  return {
    data,
    activeLeafId: data.leafId,
    persistedMessages: data.context.messages,
    entryIds: data.context.entryIds,
    historyCursor: data.context.oldestEntryId,
    hasEarlierMessages: data.context.hasMore,
    toolPreset: data.toolNames === undefined ? "default" as const : getPresetFromToolNames(data.toolNames),
    thinkingLevel: getPersistedThinkingLevel(data.context.thinkingLevel),
    sessionStatsOverride: null,
    error: null,
    metadata: data.info ?? null,
  };
}

export async function runSessionLoadPhases<T>(
  loadTranscript: () => Promise<boolean>,
  loadState?: () => Promise<T>,
): Promise<T | null> {
  if (!await loadTranscript() || !loadState) return null;
  return loadState();
}
