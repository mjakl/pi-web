import type { SubagentSessionStatus } from "./types";

export const SESSION_METADATA_BATCH_SIZE = 10;
export const SESSION_TITLE_MAX_CHARS = 512;

export interface SessionMetadataFingerprint {
  fileSize: number;
  modified: string;
}

export interface SessionRowMetadata extends SessionMetadataFingerprint {
  id: string;
  name?: string;
  messageCount: number;
  firstMessage: string;
  subagentStatus?: SubagentSessionStatus;
}
