"use client";

import { useEffect, useState, type RefObject } from "react";
import { isScrollAtTail } from "@/lib/chat-lazy-load";
import { useI18n } from "@/hooks/useI18n";

/**
 * Jump back to the newest message. A chat-level control rather than part of
 * the minimap rail, because the rail is desktop-only and this is wanted most
 * on a phone.
 */
export function ChatJumpToLatest({ scrollContainer }: { scrollContainer: RefObject<HTMLDivElement | null> }) {
  const { t } = useI18n();
  const [atTail, setAtTail] = useState(true);

  useEffect(() => {
    const el = scrollContainer.current;
    if (!el) return;
    const sync = () => setAtTail(isScrollAtTail(el.scrollTop, el.clientHeight, el.scrollHeight));
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    // The transcript grows while streaming, which moves the tail out from
    // under a reader who is already at the bottom.
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", sync);
      observer.disconnect();
    };
  }, [scrollContainer]);

  if (atTail) return null;

  return (
    <button
      type="button"
      className="chat-jump-to-latest"
      title={t("chat.jumpToLatest")}
      aria-label={t("chat.jumpToLatest")}
      onClick={() => {
        const el = scrollContainer.current;
        if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      }}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 4v13" />
        <path d="m6 12 6 6 6-6" />
      </svg>
    </button>
  );
}
