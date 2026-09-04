"use client";

import { useI18n } from "@/hooks/useI18n";

export function ChatJumpToLatest({ visible, onClick }: { visible: boolean; onClick: () => void }) {
  const { t } = useI18n();
  if (!visible) return null;

  return (
    <button
      type="button"
      className="chat-jump-to-latest"
      title={t("chat.jumpToLatest")}
      aria-label={t("chat.jumpToLatest")}
      onClick={onClick}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 4v13" />
        <path d="m6 12 6 6 6-6" />
      </svg>
    </button>
  );
}
