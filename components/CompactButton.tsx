"use client";

import { useI18n } from "@/hooks/useI18n";

export interface CompactionControl {
  disabled: boolean;
  compacting: boolean;
  onClick: () => void;
}

export function CompactButton({ control, warning = false }: { control: CompactionControl | null; warning?: boolean }) {
  const { t } = useI18n();
  if (!control) return null;
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
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {control.compacting
          ? <rect x="7" y="7" width="10" height="10" rx="1" fill="currentColor" />
          : <><polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="10" y1="14" x2="3" y2="21" /><line x1="21" y1="3" x2="14" y2="10" /></>}
      </svg>
    </button>
  );
}
