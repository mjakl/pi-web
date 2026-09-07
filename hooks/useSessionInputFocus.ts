"use client";

import { useEffect, useRef, type RefObject } from "react";

/** One focus request per selected session; intervening interaction cancels it. */
export function useSessionInputFocus(
  sessionKey: string | null | undefined,
  ready: boolean,
  input: RefObject<{ focusAtEnd: () => void } | null>,
) {
  const pending = useRef(false);

  useEffect(() => {
    pending.current = !window.matchMedia(
      "(max-width: 640px), (pointer: coarse)",
    ).matches;
    const cancel = () => {
      pending.current = false;
    };
    document.addEventListener("pointerdown", cancel, true);
    document.addEventListener("keydown", cancel, true);
    document.addEventListener("focusin", cancel, true);
    window.addEventListener("blur", cancel);
    return () => {
      cancel();
      document.removeEventListener("pointerdown", cancel, true);
      document.removeEventListener("keydown", cancel, true);
      document.removeEventListener("focusin", cancel, true);
      window.removeEventListener("blur", cancel);
    };
  }, [sessionKey]);

  useEffect(() => {
    if (!ready) return;
    const frame = requestAnimationFrame(() => {
      if (!pending.current || !input.current) return;
      pending.current = false;
      input.current.focusAtEnd();
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [sessionKey, ready, input]);
}
