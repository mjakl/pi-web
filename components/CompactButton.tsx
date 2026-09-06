"use client";

import { useI18n } from "@/hooks/useI18n";
import { CompactIcon } from "./CompactIcon";

export interface CompactionControl {
  disabled: boolean;
  compacting: boolean;
  onClick: () => void;
}

export function CompactButton({ control, warning = false, hidden = false }: { control: CompactionControl | null; warning?: boolean; hidden?: boolean }) {
  const { t } = useI18n();
  if (!control || hidden) return null;
  const label = t(control.compacting ? "chat.stopCompaction" : "chat.compactContext");
  return (
    <button
      type="button"
      className="context-compact-button"
      data-compacting={control.compacting || undefined}
      data-warning={warning || undefined}
      disabled={control.disabled}
      onClick={control.onClick}
      aria-label={label}
      title={label}
    >
      {control.compacting ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="7" y="7" width="10" height="10" rx="1" fill="currentColor" />
        </svg>
      ) : <CompactIcon />}
    </button>
  );
}
