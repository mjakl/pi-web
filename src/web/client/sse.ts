import { requestContext } from "./htmx.ts";
import { showToast } from "./toasts.ts";

const START = "web-pi:sse-start";
const OWNERS = "[hx-sse\\:connect]";
const RETRY_DELAYS = [500, 1000, 2000, 4000, 8000];

/** hx-sse only reconnects after its first SSE response, not a failed fetch. */
export function setUpSseStartup(): void {
  const pending = new WeakMap<
    Element,
    {
      attempts: number;
      ctx: ReturnType<typeof requestContext>;
      ready: boolean;
      done: boolean;
      timer?: ReturnType<typeof setTimeout>;
    }
  >();

  const forget = (owner: Element) => {
    clearTimeout(pending.get(owner)?.timer);
    pending.delete(owner);
  };
  const startIn = (root: Element) => {
    for (const owner of [root, ...root.querySelectorAll(OWNERS)]) {
      if (owner.matches(OWNERS) && owner.isConnected && !pending.has(owner)) {
        owner.dispatchEvent(new Event(START));
      }
    }
  };

  document.body.addEventListener("htmx:before:request", (event) => {
    const ctx = requestContext(event);
    const owner = ctx.sourceElement;
    if (!owner.matches(OWNERS)) return;
    const state = pending.get(owner);
    // Reprocessing a pending owner can register its native trigger twice.
    // Only the first attempt or our scheduled retry may issue a request.
    if (state && !state.ready) {
      event.preventDefault();
      return;
    }
    pending.set(owner, {
      ctx,
      attempts: (state?.attempts ?? 0) + 1,
      ready: false,
      done: false,
    });
  });
  document.body.addEventListener("htmx:finally:request", (event) => {
    const ctx = requestContext(event);
    const owner = ctx.sourceElement;
    const state = pending.get(owner);
    if (!state || state.ctx !== ctx || state.done) return;
    if (!owner.isConnected || ctx.request.signal.aborted) {
      forget(owner);
      return;
    }
    const status = ctx.response?.status;
    const transient =
      status === undefined || [408, 429, 500, 502, 503, 504].includes(status);
    const delay = RETRY_DELAYS[state.attempts - 1];
    if (transient && delay !== undefined) {
      state.timer = setTimeout(() => {
        if (owner.isConnected && pending.get(owner) === state) {
          state.ready = true;
          owner.dispatchEvent(new Event(START));
        }
      }, delay);
    } else {
      // Retain the terminal state until cleanup; processing another fragment
      // must not silently restart exhausted or permanently rejected requests.
      state.done = true;
      showToast(
        "Live updates could not connect. Reload this page to reconnect.",
        "error",
      );
    }
  });
  document.body.addEventListener("htmx:sse:after:connection", (event) => {
    if (!(event.target instanceof Element)) return;
    const state = pending.get(event.target);
    if (state) {
      clearTimeout(state.timer);
      state.done = true;
      state.ready = false;
    }
  });
  document.body.addEventListener("htmx:before:cleanup", (event) => {
    if (!(event.target instanceof Element)) return;
    const state = pending.get(event.target);
    forget(event.target);
    state?.ctx.request.abort();
  });
  document.body.addEventListener("htmx:after:process", (event) => {
    const root = event.target;
    // Extension processing follows DOM event dispatch, so start only after it
    // has installed the owner's native trigger, including on replacement bodies.
    if (root instanceof Element)
      queueMicrotask(() => {
        startIn(root);
      });
  });
  // The deferred client bundle can arrive before or after HTMX's first process.
  // Explicit startup triggers ensure failures cannot precede these listeners.
  startIn(document.body);
}
