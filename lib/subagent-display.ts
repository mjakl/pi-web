import type { ToolCallContent, ToolResultMessage } from "./types";

export interface SubagentCall {
  agent: string;
  prompt: string;
  model?: string;
  cwd?: string;
  initialContext?: string;
  session?: string;
}

export type SubagentStatus = "completed" | "failed" | "cancelled" | "unknown";

export interface SubagentResult {
  status: SubagentStatus;
  output: string;
  error?: string;
  model?: string;
  cwd?: string;
  captureTruncated: boolean;
  handledWithoutAgent: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Recognize the calls API, leaving other extension contracts on the generic renderer. */
export function getSubagentCalls(block: ToolCallContent): SubagentCall[] | null {
  if (block.toolName !== "subagent" || block.rawInput !== undefined) return null;
  const calls = block.input?.calls;
  if (!Array.isArray(calls) || calls.length === 0) return null;
  if (!calls.every((call) => isRecord(call)
    && typeof call.agent === "string" && call.agent.trim()
    && typeof call.prompt === "string")) return null;
  return calls.map((call) => ({
    agent: call.agent,
    prompt: call.prompt,
    model: text(call.model),
    cwd: text(call.cwd),
    initialContext: text(call.initialContext),
    session: text(call.session),
  }));
}

function finalAssistantText(messages: unknown[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (!isRecord(message) || message.role !== "assistant" || !Array.isArray(message.content)) continue;
    const output = message.content
      .filter((part) => isRecord(part) && part.type === "text" && typeof part.text === "string")
      .map((part) => part.text).join("");
    if (output) return output;
  }
  return "";
}

/** Only pair verified pi-subagent results; never assign an ambiguous result to a child. */
export function getSubagentResults(calls: SubagentCall[], result?: ToolResultMessage): SubagentResult[] | null {
  const details = result?.details;
  if (!isRecord(details) || details.kind !== "pi-subagent"
    || !Array.isArray(details.results) || details.results.length !== calls.length) return null;
  const rows: SubagentResult[] = new Array(calls.length);
  for (const [position, item] of details.results.entries()) {
    if (!isRecord(item)) return null;
    const index = item.callIndex ?? position;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= calls.length
      || rows[index] || item.agent !== calls[index].agent
      || !Array.isArray(item.messages) || typeof item.exitCode !== "number" || !Number.isFinite(item.exitCode)) return null;
    // The extension normalizes terminal exit codes before returning its result.
    const status: SubagentStatus = item.stopReason === "aborted" ? "cancelled"
      : item.processError === true || item.exitCode > 0 ? "failed"
      : item.exitCode === 0 ? "completed" : "unknown";
    const session = isRecord(item.session) ? item.session : undefined;
    rows[index] = {
      status,
      output: finalAssistantText(item.messages),
      error: status === "failed" || status === "cancelled" ? text(item.errorMessage) || text(item.stderr) : undefined,
      model: text(item.model),
      cwd: text(session?.cwd),
      captureTruncated: item.captureTruncated === true,
      handledWithoutAgent: item.handledWithoutAgent === true,
    };
  }
  return rows;
}

export function subagentResultFailed(result?: ToolResultMessage): boolean {
  return result?.isError === true || (isRecord(result?.details)
    && result.details.kind === "pi-subagent" && result.details.failed === true);
}
