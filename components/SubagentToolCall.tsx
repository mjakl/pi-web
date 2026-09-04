"use client";

import { useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { formatDuration } from "@/lib/i18n/format";
import { getSubagentResults, subagentResultFailed, type SubagentCall, type SubagentResult, type SubagentStatus } from "@/lib/subagent-display";
import type { ToolCallContent, ToolResultMessage } from "@/lib/types";
import { SafeMarkdownBody } from "./SafeMarkdownBody";

function Disclosure({ label, children, className = "" }: { label: ReactNode; children: () => ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details className={className} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{label}</summary>
      {open && children()}
    </details>
  );
}

function Status({ status }: { status: SubagentStatus | "running" }) {
  const { t } = useI18n();
  return <span className={`subagent-status subagent-status-${status}`}>
    <span aria-hidden="true">{status === "completed" ? "✓" : status === "failed" ? "!" : status === "running" ? "◌" : "—"}</span>
    {t(`chat.subagent.${status}`)}
  </span>;
}

export function SubagentToolCall({ block, calls, result, duration, activity, cwd, onOpenFile, sessionId, images }: {
  block: ToolCallContent;
  calls: SubagentCall[];
  result?: ToolResultMessage;
  duration?: number;
  activity?: { progress?: string };
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  sessionId?: string;
  images?: ReactNode;
}) {
  const { t } = useI18n();
  const rows = getSubagentResults(calls, result);
  const rawOutput = result?.content.filter((part) => part.type === "text").map((part) => part.text).join("\n") ?? "";
  const running = !result && activity !== undefined;
  const failed = subagentResultFailed(result) || rows?.some((row) => row.status === "failed");
  const status = running ? "running" : failed ? "failed"
    : rows?.some((row) => row.status === "cancelled") ? "cancelled"
    : rows?.some((row) => row.status === "unknown") ? "unknown"
    : result ? "completed" : "unknown";
  const counts = rows && calls.length > 1
    ? (["completed", "failed", "cancelled", "unknown"] as const).flatMap((state) => {
      const count = rows.filter((row) => row.status === state).length;
      return count ? [t(`chat.subagent.count.${state}`, { count: count.toLocaleString("en") })] : [];
    }).join(" · ") : null;

  function renderCall(call: SubagentCall, row?: SubagentResult) {
    const agentCwd = row?.cwd ?? call.cwd ?? cwd;
    const model = row?.model ?? call.model;
    return <div className="subagent-body">
      <div className="subagent-meta">
        {model && <span title={model}>{model}</span>}
        {agentCwd && <span title={agentCwd}>{agentCwd.split(/[\\/]/).filter(Boolean).pop() || agentCwd}</span>}
      </div>
      {row && <div className="subagent-result">
        <div className="subagent-section-label">{t("chat.subagent.result")}</div>
        {row.output && <SafeMarkdownBody cwd={agentCwd} onOpenFile={onOpenFile} sessionId={sessionId}>{row.output}</SafeMarkdownBody>}
        {row.error && <p className="subagent-error">{row.error}</p>}
        {!row.output && !row.error && <p>{t(row.handledWithoutAgent ? "chat.subagent.handled" : "chat.subagent.noOutput")}</p>}
        {row.captureTruncated && <p className="subagent-notice">{t("chat.subagent.captureTruncated")}</p>}
      </div>}
      <Disclosure className="subagent-disclosure" label={t("chat.subagent.prompt")}>
        {() => <pre className="subagent-plain">{call.prompt}</pre>}
      </Disclosure>
      <Disclosure className="subagent-disclosure" label={t("chat.subagent.runDetails")}>
        {() => <dl className="subagent-settings">
          <dt>{t("chat.subagent.agent")}</dt><dd>{call.agent}</dd>
          {model && <><dt>{t("chat.subagent.model")}</dt><dd>{model}</dd></>}
          {agentCwd && <><dt>{t("chat.subagent.cwd")}</dt><dd>{agentCwd}</dd></>}
          {call.initialContext && <><dt>{t("chat.subagent.initialContext")}</dt><dd>{call.initialContext}</dd></>}
          {call.session && <><dt>{t("chat.subagent.session")}</dt><dd>{call.session}</dd></>}
        </dl>}
      </Disclosure>
    </div>;
  }

  return <Disclosure className="subagent-card" label={<span className="subagent-header">
    <span className="subagent-name">{t("chat.subagent.title")} · {calls.length === 1 ? calls[0].agent : t("chat.subagent.agents", { count: calls.length.toLocaleString("en") })}</span>
    {counts ? <span className="subagent-counts">{counts}</span> : <Status status={status} />}
    {duration !== undefined && <span className="subagent-duration">{formatDuration(duration)}</span>}
    {running && activity?.progress && <span className="subagent-progress">{activity.progress}</span>}
  </span>}>
    {() => <>
      {result && !rows && <div className="subagent-body subagent-result">
        <div className="subagent-section-label">{t("chat.subagent.result")}</div>
        <SafeMarkdownBody cwd={cwd} onOpenFile={onOpenFile} sessionId={sessionId}>{rawOutput || t("chat.subagent.noOutput")}</SafeMarkdownBody>
      </div>}
      {calls.length === 1 ? renderCall(calls[0], rows?.[0]) : calls.map((call, index) => <Disclosure key={index} className="subagent-agent" label={<span className="subagent-header">
        <span className="subagent-name">{call.agent}</span>
        <Status status={rows?.[index]?.status ?? "unknown"} />
      </span>}>
        {() => renderCall(call, rows?.[index])}
      </Disclosure>)}
      {images}
      <div className="subagent-raw">
        <Disclosure className="subagent-disclosure" label={t("chat.subagent.rawInput")}>
          {() => <pre className="subagent-plain">{JSON.stringify(block.input, null, 2)}</pre>}
        </Disclosure>
        {result && <Disclosure className="subagent-disclosure" label={t("chat.subagent.rawOutput")}>
          {() => <pre className="subagent-plain">{rawOutput}</pre>}
        </Disclosure>}
      </div>
    </>}
  </Disclosure>;
}
