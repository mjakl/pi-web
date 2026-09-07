"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  INITIAL_STREAMING_STATE,
  streamReducer,
  type StreamAction,
} from "@/lib/streaming-message";

export function useStreamingState() {
  const [state, setState] = useState(INITIAL_STREAMING_STATE);
  const latest = useRef(INITIAL_STREAMING_STATE);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPending = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => cancelPending, [cancelPending]);

  const dispatch = useCallback(
    (action: StreamAction) => {
      // Apply every event in order, but publish token bursts at most every 50 ms.
      // Only the latest state is retained; no growing queue or replay is needed.
      latest.current = streamReducer(latest.current, action);
      if (
        action.type === "delta" &&
        (action.event.type === "text_delta" ||
          action.event.type === "thinking_delta" ||
          action.event.type === "toolcall_delta")
      ) {
        timer.current ??= setTimeout(() => {
          timer.current = null;
          setState(latest.current);
        }, 50);
        return;
      }
      // Starts, snapshots, block endings and settlement replace pending text now.
      cancelPending();
      setState(latest.current);
    },
    [cancelPending],
  );

  return [state, dispatch] as const;
}
