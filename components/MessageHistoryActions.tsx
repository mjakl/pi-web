"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";

export interface MessageHistoryActions {
  onFork: (entryId: string) => void;
  onBranch: (entryId: string) => void;
  branchDisabledReason?: string;
  pending: boolean;
}

export function HistoryActionButtons({
  entryId,
  actions,
}: {
  entryId?: string;
  actions?: MessageHistoryActions;
}) {
  const { t } = useI18n();
  if (!entryId || !actions) return null;
  return (
    <>
      <span title={actions.branchDisabledReason ?? t("i18n.editFromHereTitle")}>
        <button
          type="button"
          className="history-action"
          disabled={actions.pending || Boolean(actions.branchDisabledReason)}
          onClick={() => {
            actions.onBranch(entryId);
          }}
          aria-label={t("i18n.editFromHere")}
          title={actions.branchDisabledReason ?? t("i18n.editFromHereTitle")}
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <polyline points="15 10 20 15 15 20" />
            <path d="M4 4v7a4 4 0 0 0 4 4h12" />
          </svg>
          {t("i18n.editFromHere")}
        </button>
      </span>
      <button
        type="button"
        className="history-action"
        disabled={actions.pending}
        title={t("i18n.newSessionTitle")}
        onClick={() => {
          actions.onFork(entryId);
        }}
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path d="M6 3v12M18 9a9 9 0 0 1-9 9" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
        </svg>
        {t("i18n.newSession")}
      </button>
    </>
  );
}

export function HistoryActionFrame({
  entryId,
  actions,
  children,
}: {
  entryId?: string;
  actions?: MessageHistoryActions;
  children: ReactNode;
}) {
  if (!entryId || !actions) return children;
  return (
    <div className="history-action-host">
      {children}
      <div className="history-actions">
        <HistoryActionButtons entryId={entryId} actions={actions} />
      </div>
    </div>
  );
}
