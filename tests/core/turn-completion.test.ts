import { createCompletionTracker } from "@core/turn-completion";
import { describe, expect, it } from "vitest";

describe("turn completion", () => {
  it("only fires for a run that started", () => {
    const tracker = createCompletionTracker();
    expect(tracker.settled(false)).toBe(false);
    tracker.start();
    expect(tracker.settled(false)).toBe(true);
    // One notification per run, not one per settle.
    expect(tracker.settled(false)).toBe(false);
  });

  it("keeps the run open while the session is still busy", () => {
    const tracker = createCompletionTracker();
    tracker.start();
    expect(tracker.settled(true)).toBe(false);
    expect(tracker.settled(false)).toBe(true);
  });

  it("drops the run when the session is stopped", () => {
    const tracker = createCompletionTracker();
    tracker.start();
    tracker.cancel();
    expect(tracker.settled(false)).toBe(false);
  });
});
