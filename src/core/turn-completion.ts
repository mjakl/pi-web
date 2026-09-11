/**
 * When a session finished work worth telling the reader about. Pi settles
 * after every kind of activity, so "the turn ended" is not enough: a run has
 * to have started, and the session has to be idle when it settles. A stop, an
 * abort before the model answered, or a shell command on its own never
 * notifies. This is pi-web's `notifyAgentRunCompleteIfIdle`, and both the Pi
 * adapter and the fake world drive push and the completion tone through it.
 */
export function createCompletionTracker() {
  let started = false;
  return {
    /** The agent began a run. */
    start(): void {
      started = true;
    },
    /**
     * The agent settled. True when this is the end of that run; false while
     * the session is still busy, which keeps the run open for the next settle.
     */
    settled(busy: boolean): boolean {
      if (!started || busy) return false;
      started = false;
      return true;
    },
    /** Stopping the session drops the run: no notification for a kill. */
    cancel(): void {
      started = false;
    },
  };
}
