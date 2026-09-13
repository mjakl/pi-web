/** Bind state to a DOM owner, not to the first page the module happened to see. */
export function setUpRegion(
  selector: string,
  mount: (owner: HTMLElement, signal: AbortSignal) => void,
): void {
  const mounted = new Map<HTMLElement, AbortController>();
  const dispose = (owner: HTMLElement, controller: AbortController) => {
    mounted.delete(owner);
    controller.abort();
  };
  const process = (root: Element) => {
    // HTMX only emits cleanup for powered elements. Plain owner wrappers can
    // disappear without their own cleanup event, so also reconcile on process.
    for (const [owner, controller] of mounted) {
      if (!owner.isConnected) dispose(owner, controller);
    }
    for (const owner of [root, ...root.querySelectorAll(selector)]) {
      if (
        !(owner instanceof HTMLElement) ||
        !owner.matches(selector) ||
        !owner.isConnected ||
        mounted.has(owner)
      )
        continue;
      const controller = new AbortController();
      mounted.set(owner, controller);
      mount(owner, controller.signal);
    }
  };
  document.addEventListener("htmx:before:cleanup", (event) => {
    if (!(event.target instanceof Element)) return;
    for (const [owner, controller] of mounted) {
      if (event.target.contains(owner)) dispose(owner, controller);
    }
  });
  document.addEventListener("htmx:after:process", (event) => {
    if (event.target instanceof Element) process(event.target);
  });
  document.addEventListener("htmx:after:settle", () => {
    // A deletion or an empty body has no inserted root to process.
    for (const [owner, controller] of mounted) {
      if (!owner.isConnected) dispose(owner, controller);
    }
  });
  process(document.body);
}
