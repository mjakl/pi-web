import { CompactButton } from "@web/views/Status";
import { describe, expect, it, vi } from "vitest";
import { mount } from "./helpers.ts";

describe("compact button", () => {
  it("blocks duplicate activation while compacting and allows it again when idle", () => {
    for (const compacting of [false, true, false]) {
      mount(CompactButton({ sessionId: "s1", compacting }));
      const button =
        document.querySelector<HTMLButtonElement>("#context-compact");
      if (!button) throw new Error("No compact button");
      const activate = vi.fn();
      button.addEventListener("click", activate);
      button.click();
      expect(button.disabled).toBe(compacting);
      expect(activate).toHaveBeenCalledTimes(compacting ? 0 : 1);
      expect(button.getAttribute("aria-label")).toBe(
        compacting ? "Compacting context…" : "Compact context",
      );
    }
  });
});
