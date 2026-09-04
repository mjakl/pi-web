import { isRecord } from "./types";

const MAX_PROGRESS_LENGTH = 500;

export function getToolExecutionProgress(partialResult: unknown): string | null {
  if (!isRecord(partialResult)) return null;

  const content = partialResult.content;
  if (!Array.isArray(content)) return null;

  const text = content
    .filter((block) => isRecord(block) && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n");
  const latest = text.split(/\r?\n/).findLast((line) => line.trim())?.trim();
  if (!latest) return null;

  const normalized = latest.replace(/\s+/g, " ");
  return normalized.length <= MAX_PROGRESS_LENGTH
    ? normalized
    : `...${normalized.slice(-(MAX_PROGRESS_LENGTH - 3))}`;
}
