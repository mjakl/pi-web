import type { AgentMessage, SessionContext, SessionInfo } from "./types";
import { userMessageKey } from "./prompt-recovery";
import { getPresetFromToolNames } from "./tool-presets";

export interface PersistedAuthority {
  acceptedSnapshotOrder: number;
  acceptedTranscriptOrder: number;
  sessionId: string;
  runId: number;
  observedActivityEpoch: number;
}

export interface PersistedSnapshotRequest {
  order: number;
  sessionId: string;
  runId: number;
  observedActivityEpoch: number;
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

export interface SelectedSessionMetadataAuthority {
  sessionId: string;
  fingerprint: string | null;
  inventoryFloor: number;
}

export interface SelectedSessionMetadataState {
  session: SessionInfo | null;
  authority: SelectedSessionMetadataAuthority | null;
}

export function sessionInfoFingerprint(
  session: Pick<SessionInfo, "fileSize" | "modified">,
): string | null {
  return session.fileSize === undefined ? null : `${session.modified}\0${session.fileSize}`;
}

export function hasSessionRowMetadata(session: SessionInfo): boolean {
  return typeof session.messageCount === "number" && typeof session.firstMessage === "string";
}

export function acceptSelectedSessionMetadata(
  current: SelectedSessionMetadataState,
  updated: SessionInfo,
  inventoryFloor: number,
): SelectedSessionMetadataState {
  if (current.session?.id !== updated.id) return current;
  return {
    session: updated,
    authority: {
      sessionId: updated.id,
      fingerprint: sessionInfoFingerprint(updated),
      inventoryFloor,
    },
  };
}

export function reconcileSelectedSessionInventory(
  current: SelectedSessionMetadataState,
  incoming: SessionInfo | undefined,
  inventoryAttempt: number,
): SelectedSessionMetadataState {
  const { session } = current;
  const fingerprint = session ? sessionInfoFingerprint(session) : null;
  const authority = current.authority
    && session
    && current.authority.sessionId === session.id
    && current.authority.fingerprint === fingerprint
    && (fingerprint !== null || session.transient)
    ? current.authority
    : null;

  if (authority && inventoryAttempt <= authority.inventoryFloor) {
    return { session, authority };
  }
  if (!session || !incoming) return { session, authority: null };

  const incomingFingerprint = sessionInfoFingerprint(incoming);
  const preserveMetadata = incomingFingerprint !== null && incomingFingerprint === fingerprint;
  const incomingHydrated = hasSessionRowMetadata(incoming);
  return {
    session: {
      ...session,
      ...incoming,
      fileSize: incoming.fileSize,
      name: incomingHydrated ? incoming.name : preserveMetadata ? session.name : undefined,
      messageCount: incomingHydrated
        ? incoming.messageCount
        : preserveMetadata ? session.messageCount : undefined,
      firstMessage: incomingHydrated
        ? incoming.firstMessage
        : preserveMetadata ? session.firstMessage : undefined,
    },
    authority: null,
  };
}

export function canAcceptInventoryResult(attempt: number, acceptedAttempt: number): boolean {
  return attempt > acceptedAttempt;
}

export function observedActivityEpochAfter(epoch: number, boundary: string): number {
  return boundary === "agent_start"
    || boundary === "bash_admission"
    || boundary === "compaction_admission"
    || boundary === "compaction_start"
    ? epoch + 1
    : epoch;
}

export function canAcceptPersistedSnapshot(
  request: PersistedSnapshotRequest,
  current: PersistedAuthority,
  latestRequestOrder: number,
): boolean {
  return request.order === latestRequestOrder
    && request.sessionId === current.sessionId
    && request.runId === current.runId
    && request.observedActivityEpoch === current.observedActivityEpoch
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

export async function runTranscriptNavigation(
  persistNavigation: () => Promise<unknown>,
  loadContext: () => Promise<void>,
): Promise<void> {
  await persistNavigation();
  await loadContext();
}

export async function runSessionLoadPhases<T>(
  loadTranscript: () => Promise<unknown>,
  loadState?: () => Promise<T>,
): Promise<T | null> {
  await loadTranscript();
  return loadState ? loadState() : null;
}
