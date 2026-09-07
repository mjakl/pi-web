"use client";

import { useCallback, useEffect, useRef } from "react";

/** Coalesce layout work from events and observers into the next browser frame. */
export function useAnimationFrameCallback(callback: () => void) {
  const latest = useRef(callback);
  latest.current = callback;
  const frame = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
      frame.current = null;
    },
    [],
  );
  return useCallback(() => {
    frame.current ??= window.requestAnimationFrame(() => {
      frame.current = null;
      latest.current();
    });
  }, []);
}
