import type { RunningTool } from "./ports.ts";
import type {
  AssistantBlock,
  AssistantItem,
  TranscriptItem,
} from "./transcript.ts";

// How a settled transcript is grouped for reading, and what the live turn
// says while it runs. Both are pure rules over projected items.

/** Entries shown on first load; the rest arrives when the reader scrolls up. */
export const PAGE_SIZE = 50;
const PAGE_MAX = 1000;

/** A user message, a compaction, or a branch summary starts a new turn. */
export function isTurnBoundary(item: TranscriptItem): boolean {
  return (
    item.kind === "user" ||
    item.kind === "compaction" ||
    item.kind === "branch_summary"
  );
}

export type Turn = {
  boundary?: TranscriptItem;
  /** Thinking, tool calls, and intermediate messages, behind a disclosure. */
  process: TranscriptItem[];
  /** The trailing text of the last assistant message: the answer itself. */
  answer?: AssistantItem;
  /** Anything after the answer, up to the next boundary. */
  trailing: TranscriptItem[];
  processMessages: number;
  processToolCalls: number;
  /** Open the disclosure without being asked. */
  expanded: boolean;
};

function isAnswerBlock(block: AssistantBlock): boolean {
  return block.kind === "text" || block.kind === "image";
}

function isEmptyBlock(block: AssistantBlock): boolean {
  if (block.kind === "text") return block.text.trim() === "";
  if (block.kind === "thinking") return !block.deferred && block.text === "";
  return false;
}

function withBlocks(
  item: AssistantItem,
  blocks: AssistantBlock[],
): AssistantItem {
  return { ...item, blocks };
}

/** Drop blocks a settled message would render as blank. */
function cleaned(item: TranscriptItem): TranscriptItem {
  if (item.kind !== "assistant") return item;
  return withBlocks(
    item,
    item.blocks.filter((block) => !isEmptyBlock(block)),
  );
}

function hasAnswerContent(item: TranscriptItem): boolean {
  return item.kind === "assistant" && item.blocks.some(isAnswerBlock);
}

function countToolCalls(items: readonly TranscriptItem[]): number {
  let total = 0;
  for (const item of items) {
    if (item.kind !== "assistant") continue;
    total += item.blocks.filter((block) => block.kind === "tool").length;
  }
  return total;
}

function buildTurn(
  boundary: TranscriptItem | undefined,
  rest: readonly TranscriptItem[],
): Turn {
  const items = rest.map(cleaned);
  const assistants = items
    .map((item, index) => ({ item, index }))
    .filter((entry) => entry.item.kind === "assistant");
  const finalIndex =
    assistants.findLast((entry) => hasAnswerContent(entry.item))?.index ??
    assistants.at(-1)?.index;

  if (finalIndex === undefined) {
    return {
      ...(boundary ? { boundary } : {}),
      process: items,
      trailing: [],
      processMessages: items.length,
      processToolCalls: countToolCalls(items),
      expanded: true,
    };
  }

  const final = items[finalIndex];
  if (final?.kind !== "assistant") throw new Error("unreachable");
  const lastProcess = final.blocks.findLastIndex(
    (block) => !isAnswerBlock(block),
  );
  const answerBlocks =
    lastProcess === -1 ? final.blocks : final.blocks.slice(lastProcess + 1);
  const processBlocks =
    lastProcess === -1 ? [] : final.blocks.slice(0, lastProcess + 1);

  const process = [...items.slice(0, finalIndex)];
  if (processBlocks.length > 0) process.push(withBlocks(final, processBlocks));
  const answer =
    answerBlocks.length > 0 ? withBlocks(final, answerBlocks) : undefined;

  return {
    ...(boundary ? { boundary } : {}),
    process,
    ...(answer ? { answer } : {}),
    trailing: items.slice(finalIndex + 1),
    processMessages: process.length,
    processToolCalls: countToolCalls(process),
    // Nothing to fold into, or the reader would lose prose by folding it.
    expanded: answer === undefined || process.some(hasAnswerContent),
  };
}

/** Group a settled transcript into turns: boundary, process, answer, rest. */
export function groupTurns(items: readonly TranscriptItem[]): Turn[] {
  const turns: Turn[] = [];
  let boundary: TranscriptItem | undefined;
  let rest: TranscriptItem[] = [];
  let started = false;
  for (const item of items) {
    if (isTurnBoundary(item)) {
      if (started) turns.push(buildTurn(boundary, rest));
      boundary = item;
      rest = [];
      started = true;
      continue;
    }
    rest.push(item);
  }
  if (started || rest.length > 0) turns.push(buildTurn(boundary, rest));
  return turns;
}

/**
 * Which answers carry a visible time: the last one before every question, and
 * the last one of the conversation. Timestamps everywhere are noise.
 */
export function timestampedEntries(
  items: readonly TranscriptItem[],
): Set<string> {
  const marked = new Set<string>();
  let pending: string | undefined;
  for (const item of items) {
    if (item.kind === "assistant") pending = item.entryId;
    else if (item.kind === "user" && pending !== undefined) {
      marked.add(pending);
      pending = undefined;
    }
  }
  if (pending !== undefined) marked.add(pending);
  return marked;
}

/**
 * The window of a branch a page shows. `before` pages backwards from an entry
 * already on screen, `through` widens the page until a target entry is in it.
 * Both ends are pulled back to a turn boundary so a page never opens in the
 * middle of a turn.
 */
export function pageItems(
  items: readonly TranscriptItem[],
  options: { tail?: number; before?: string; through?: string } = {},
): { items: TranscriptItem[]; hasMore: boolean; oldestId: string | undefined } {
  const tail = Math.min(Math.max(options.tail ?? PAGE_SIZE, 1), PAGE_MAX);
  let end = items.length;
  if (options.before !== undefined) {
    const index = items.findIndex((item) => item.entryId === options.before);
    if (index === -1) throw new RangeError("Unknown entry for this branch");
    end = index;
  }
  let start = Math.max(0, end - tail);
  if (options.through !== undefined) {
    const index = items.findIndex((item) => item.entryId === options.through);
    if (index === -1 || index >= end) {
      throw new RangeError("Unknown entry for this branch");
    }
    start = Math.min(start, index);
  }
  while (start > 0) {
    const first = items[start];
    if (first && isTurnBoundary(first)) break;
    start -= 1;
  }
  const page = items.slice(start, end);
  return {
    items: page,
    hasMore: start > 0,
    oldestId: page[0]?.entryId,
  };
}

/**
 * The pulsing line while a turn runs and nothing has streamed yet. Null keeps
 * the status bar's own spinner as the only sign of work.
 */
export function activityLabel(status: {
  bashRunning: boolean;
  tools: readonly RunningTool[];
}): string | null {
  if (status.bashRunning) return "Running command...";
  const names = status.tools.map((tool) => tool.name);
  if (names.length === 0) return null;
  if (names.length === 1) {
    const only = status.tools[0];
    if (!only) return null;
    return only.progress
      ? `Running ${only.name}... ${only.progress}`
      : `Running ${only.name}...`;
  }
  if (names.length <= 3) return `Running ${names.join(", ")}...`;
  return `Running ${names.slice(0, 2).join(", ")} (+${String(names.length - 2)})...`;
}
