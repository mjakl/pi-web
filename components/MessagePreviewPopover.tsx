"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function MessagePreviewPopover({
  id,
  text,
  anchor,
  immediate,
}: {
  id: string;
  text: string;
  anchor: HTMLElement;
  immediate: boolean;
}) {
  const [visible, setVisible] = useState(immediate);
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    arrow: number;
  } | null>(null);

  useEffect(() => {
    const timer = setTimeout(
      () => {
        setVisible(true);
      },
      immediate ? 0 : 180,
    );
    return () => {
      clearTimeout(timer);
    };
  }, [immediate]);

  useLayoutEffect(() => {
    if (!visible) return;
    const place = () => {
      const tip = ref.current;
      if (!tip) return;
      const target = anchor.getBoundingClientRect();
      const bounds = tip.getBoundingClientRect();
      const center = target.top + target.height / 2;
      const top = Math.max(
        8,
        Math.min(
          center - bounds.height / 2,
          window.innerHeight - bounds.height - 8,
        ),
      );
      setPosition({
        left: Math.max(
          8,
          Math.min(
            target.left - bounds.width - 10,
            window.innerWidth - bounds.width - 8,
          ),
        ),
        top,
        arrow: Math.max(8, Math.min(center - top, bounds.height - 8)),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [visible, anchor, text]);

  if (!visible) return null;
  return createPortal(
    <div
      id={id}
      ref={ref}
      role="tooltip"
      className="message-preview-popover"
      style={{
        left: position?.left,
        top: position?.top,
        visibility: position ? "visible" : "hidden",
      }}
    >
      {text}
      <span
        aria-hidden="true"
        className="message-preview-arrow"
        style={{ top: position?.arrow }}
      />
    </div>,
    document.body,
  );
}
