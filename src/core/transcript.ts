import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

// The conversation as the UI shows it: one item per visible entry on the
// active branch. Tool results are folded into the assistant message that
// requested them, so a turn renders as one block.

export type ToolCallView = {
  id: string;
  name: string;
  arguments: unknown;
  result?: { text: string; isError: boolean };
};

export type TranscriptItem =
  | { kind: "user"; entryId: string; text: string; imageCount: number }
  | {
      kind: "assistant";
      entryId: string;
      model: string;
      thinking: string;
      text: string;
      toolCalls: ToolCallView[];
      stopReason: string;
      errorMessage?: string;
      usage?: { input: number; output: number; total: number };
    }
  | {
      kind: "compaction";
      entryId: string;
      summary: string;
      tokensBefore: number;
    }
  | { kind: "branch_summary"; entryId: string; summary: string }
  | {
      kind: "note";
      entryId: string;
      customType: string;
      text: string;
      /** Capture file holding the full output of a truncated shell run. */
      outputPath?: string;
      /** A `!!` shell run: its output never reached the model. */
      excluded?: boolean;
    };

export type Transcript = {
  items: TranscriptItem[];
  /** Tokens the last completed model call reported for its whole context. */
  lastContextTokens: number | null;
  lastModel: { provider: string; id: string } | null;
};

function contentText(
  content: string | readonly { type: string; text?: string }[],
): string {
  if (typeof content === "string") return content;
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("");
}

function imageCount(content: string | readonly { type: string }[]): number {
  if (typeof content === "string") return 0;
  return content.filter((part) => part.type === "image").length;
}

/** Context tokens as Pi's compaction code counts them for one model call. */
function contextTokensOf(message: AgentMessage): number | undefined {
  if (message.role !== "assistant") return undefined;
  if (message.stopReason === "aborted" || message.stopReason === "error") {
    return undefined;
  }
  const { usage } = message;
  const total =
    usage.totalTokens ||
    usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
  return total > 0 ? total : undefined;
}

/** Live-turn rendering reuses this for the partial assistant message. */
export function assistantItem(
  entryId: string,
  message: Extract<AgentMessage, { role: "assistant" }>,
): Extract<TranscriptItem, { kind: "assistant" }> {
  const toolCalls: ToolCallView[] = [];
  let thinking = "";
  let text = "";
  for (const part of message.content) {
    if (part.type === "text") text += part.text;
    else if (part.type === "thinking") thinking += part.thinking;
    else if (part.type === "toolCall") {
      toolCalls.push({
        id: part.id,
        name: part.name,
        arguments: part.arguments,
      });
    }
  }
  const total = contextTokensOf(message);
  return {
    kind: "assistant",
    entryId,
    model: message.model,
    thinking,
    text,
    toolCalls,
    stopReason: message.stopReason,
    ...(message.errorMessage ? { errorMessage: message.errorMessage } : {}),
    ...(total !== undefined
      ? {
          usage: {
            input: message.usage.input,
            output: message.usage.output,
            total,
          },
        }
      : {}),
  };
}

/**
 * Project the entries of one branch (root first) into transcript items.
 * Entries with no visible representation (model changes, labels, hidden
 * custom messages) are skipped.
 */
export function projectTranscript(branch: readonly SessionEntry[]): Transcript {
  const items: TranscriptItem[] = [];
  const openToolCalls = new Map<string, ToolCallView>();
  let lastContextTokens: number | null = null;
  let lastModel: Transcript["lastModel"] = null;

  for (const entry of branch) {
    switch (entry.type) {
      case "message": {
        const { message } = entry;
        if (message.role === "user") {
          items.push({
            kind: "user",
            entryId: entry.id,
            text: contentText(message.content),
            imageCount: imageCount(message.content),
          });
        } else if (message.role === "assistant") {
          const item = assistantItem(entry.id, message);
          for (const call of item.toolCalls) openToolCalls.set(call.id, call);
          const tokens = contextTokensOf(message);
          if (tokens !== undefined) lastContextTokens = tokens;
          lastModel = { provider: message.provider, id: message.model };
          items.push(item);
        } else if (message.role === "toolResult") {
          const call = openToolCalls.get(message.toolCallId);
          if (call) {
            call.result = {
              text: contentText(message.content),
              isError: (message as { isError?: boolean }).isError ?? false,
            };
          }
        } else if (message.role === "bashExecution") {
          items.push({
            kind: "note",
            entryId: entry.id,
            customType: "bash",
            text: `$ ${message.command}\n${message.output}`,
            ...(message.fullOutputPath
              ? { outputPath: message.fullOutputPath }
              : {}),
            ...(message.excludeFromContext ? { excluded: true } : {}),
          });
        }
        break;
      }
      case "compaction":
        items.push({
          kind: "compaction",
          entryId: entry.id,
          summary: entry.summary,
          tokensBefore: entry.tokensBefore,
        });
        break;
      case "branch_summary":
        items.push({
          kind: "branch_summary",
          entryId: entry.id,
          summary: entry.summary,
        });
        break;
      case "custom_message":
        if (entry.display) {
          items.push({
            kind: "note",
            entryId: entry.id,
            customType: entry.customType,
            text: contentText(entry.content),
          });
        }
        break;
      default:
        break;
    }
  }
  return { items, lastContextTokens, lastModel };
}

/** Plain text of the first user message, for titles and previews. */
export function transcriptTitle(
  transcript: Transcript,
  maxLength = 80,
): string {
  const first = transcript.items.find((item) => item.kind === "user");
  if (!first || first.kind !== "user") return "";
  const line = first.text.replaceAll(/\s+/g, " ").trim();
  return line.length > maxLength ? `${line.slice(0, maxLength - 1)}…` : line;
}
