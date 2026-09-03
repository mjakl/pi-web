"use client";

import { useRef, type RefObject } from "react";

/** One ref slot per rendered message, resized in place so slots survive rerenders. */
export function useMessageRefs(count: number): RefObject<(HTMLDivElement | null)[]> {
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  refs.current = Array(count).fill(null).map((_, i) => refs.current[i] ?? null);
  return refs;
}
