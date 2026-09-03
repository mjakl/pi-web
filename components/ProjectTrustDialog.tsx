"use client";

import { useEffect, useRef } from "react";

import { useI18n } from "@/hooks/useI18n";

export function ProjectTrustDialog({
  cwd,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  cwd: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);

  // showModal() supplies the backdrop, the focus trap, and focus restoration
  // that this dialog previously had none of.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="project-trust-dialog"
      aria-labelledby="project-trust-title"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        // Own the key so the global Esc shortcut cannot abort the turn
        // running behind this dialog.
        event.preventDefault();
        if (!busy) onCancel();
      }}
      onCancel={(event) => event.preventDefault()}
      onClick={(event) => {
        if (!busy && event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="project-trust-panel">
        <div style={{ display: "flex", gap: 12, padding: "18px 18px 14px" }}>
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#f59e0b"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ flexShrink: 0, marginTop: 1 }}
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
            <path d="m9 12 2 2 4-4" />
          </svg>
          <div style={{ minWidth: 0 }}>
            <div id="project-trust-title" style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
              {t("trust.dialogTitle")}
            </div>
            <div style={{ marginTop: 7, fontSize: 12, lineHeight: 1.6, color: "var(--text-muted)" }}>
              {t("trust.dialogBody")}
            </div>
            <code
              style={{
                display: "block",
                marginTop: 10,
                padding: "8px 10px",
                border: "1px solid var(--border)",
                borderRadius: 5,
                background: "var(--bg)",
                color: "var(--text)",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                overflowWrap: "anywhere",
              }}
            >
              {cwd}
            </code>
            {error && (
              <div role="alert" style={{ marginTop: 10, color: "#ef4444", fontSize: 12, lineHeight: 1.5 }}>
                {error}
              </div>
            )}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            padding: "10px 18px",
            borderTop: "1px solid var(--border)",
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={{
              height: 32,
              padding: "0 12px",
              border: "1px solid var(--border)",
              borderRadius: 5,
              background: "transparent",
              color: "var(--text-muted)",
              cursor: busy ? "not-allowed" : "pointer",
              fontSize: 12,
            }}
          >
            {t("trust.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            style={{
              height: 32,
              padding: "0 12px",
              border: "1px solid var(--accent)",
              borderRadius: 5,
              background: "var(--accent)",
              color: "white",
              cursor: busy ? "wait" : "pointer",
              opacity: busy ? 0.7 : 1,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {busy ? t("trust.trusting") : t("trust.trustProject")}
          </button>
        </div>
      </div>
    </dialog>
  );
}
