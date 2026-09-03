import type { ReactNode } from "react";

export function DockedComposer({ children }: { children: ReactNode }) {
  return (
    <div style={{ position: "relative", borderTop: "1px solid var(--border)" }}>
      {children}
    </div>
  );
}
