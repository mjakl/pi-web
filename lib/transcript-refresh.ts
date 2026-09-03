import type { AgentMessage } from "./types";
import { userMessageKey } from "./prompt-recovery";

export interface TranscriptRefreshVersion {
  requestId: number;
  sessionId: string;
  runId: number;
  transcriptRevision: number;
}

export function isCurrentTranscriptRefresh(
  request: TranscriptRefreshVersion,
  current: TranscriptRefreshVersion,
): boolean {
  return request.requestId === current.requestId
    && request.sessionId === current.sessionId
    && request.runId === current.runId
    && request.transcriptRevision === current.transcriptRevision;
}

function sameMessage(left: AgentMessage, right: AgentMessage): boolean {
  if (left.role !== right.role) return false;
  if (left.role === "user") return userMessageKey(left) === userMessageKey(right);
  if (left.timestamp !== undefined && right.timestamp !== undefined) {
    return left.timestamp === right.timestamp;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

export function mergeTranscriptRefreshMessages(
  persisted: AgentMessage[],
  current: AgentMessage[],
  previousPersisted: AgentMessage[],
): AgentMessage[] {
  const liveTail = current.slice(previousPersisted.length);
  const previousLast = previousPersisted.at(-1);
  const previousBoundary = previousLast
    ? persisted.findLastIndex((message) => JSON.stringify(message) === JSON.stringify(previousLast))
    : -1;
  const refreshedTail = persisted.slice(previousBoundary + 1);
  const lastPersistedLiveIndex = liveTail.findLastIndex((liveMessage) => (
    refreshedTail.some((message) => sameMessage(message, liveMessage))
  ));
  return lastPersistedLiveIndex === liveTail.length - 1
    ? persisted
    : [...persisted, ...liveTail.slice(lastPersistedLiveIndex + 1)];
}
