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
  return JSON.stringify(left) === JSON.stringify(right);
}

export function mergeTranscriptRefreshMessages(
  persisted: AgentMessage[],
  current: AgentMessage[],
  previousPersistedCount: number,
): AgentMessage[] {
  const liveTail = current.slice(previousPersistedCount);
  let overlap = Math.min(persisted.length, liveTail.length);
  while (overlap > 0) {
    const persistedStart = persisted.length - overlap;
    if (liveTail.slice(0, overlap).every((message, index) => (
      sameMessage(persisted[persistedStart + index], message)
    ))) break;
    overlap -= 1;
  }
  return overlap === liveTail.length
    ? persisted
    : [...persisted, ...liveTail.slice(overlap)];
}
