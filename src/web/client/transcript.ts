import { codeText, highlightIn } from "./highlight.ts";
import { setUpMermaid } from "./mermaid.ts";
import { setUpRail } from "./rail.ts";

// Everything the transcript needs from the browser: staying at the tail while
// a turn streams, keeping the reading position when an older page is
// prepended, colouring settled code, and the copy buttons.

/** Within this many pixels of the bottom counts as "at the end". */
const TAIL_TOLERANCE = 8;
const COPIED_MS = 1500;

function atTail(view: HTMLElement): boolean {
  return (
    view.scrollHeight - view.scrollTop - view.clientHeight <= TAIL_TOLERANCE
  );
}

/**
 * pi-web swaps the label and the icon for 1.5s and turns the button accent.
 * The message button carries both states in the markup, a code-block button
 * only a label; `data-copied` is what the stylesheet keys the colour on.
 */
async function copyText(button: HTMLElement, text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return;
  }
  const label = button.querySelector("[data-copy-idle]") === null;
  const previous = button.textContent;
  if (label) button.textContent = "Copied";
  button.dataset["copied"] = "1";
  setTimeout(() => {
    if (label) button.textContent = previous;
    delete button.dataset["copied"];
  }, COPIED_MS);
}

function setUpCopy(): void {
  document.body.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const message = target.closest<HTMLElement>("[data-copy]");
    if (message) {
      const source =
        message.parentElement?.querySelector<HTMLElement>("[data-copy-source]");
      void copyText(message, source?.textContent ?? "");
      return;
    }
    const code = target.closest<HTMLElement>("[data-copy-code]");
    if (!code) return;
    void copyText(code, codeText(code.closest(".markdown-code-block")));
  });
}

export function setUpTranscript(): void {
  setUpRail();
  const view = document.getElementById("log");
  if (!view) {
    setUpCopy();
    return;
  }
  const jump = document.getElementById("jump-to-latest");
  let follow = true;
  const sync = () => {
    follow = atTail(view);
    if (jump) jump.hidden = follow;
  };
  view.addEventListener("scroll", sync, { passive: true });
  jump?.addEventListener("click", () => {
    view.scrollTo({
      top: view.scrollHeight,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  });

  // A prepended page must not move the text under the reader's eyes: keep the
  // distance to the bottom, which the new content does not change.
  let anchor: number | null = null;
  document.body.addEventListener("htmx:beforeSwap", (event) => {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.classList.contains("load-earlier")
    ) {
      anchor = view.scrollHeight - view.scrollTop;
    }
  });
  document.body.addEventListener("htmx:afterSwap", (event) => {
    const target = event.target;
    // Only the log and the running turn move the reader to the tail. A tool
    // card fetching its own body must leave the scroll position alone.
    const appended =
      target instanceof Element &&
      (target.id === "messages" || target.id === "turn");
    if (anchor !== null) {
      view.scrollTop = Math.max(0, view.scrollHeight - anchor);
      anchor = null;
    } else if (follow && appended) {
      view.scrollTop = view.scrollHeight;
    }
    if (target instanceof Element) highlightIn(target);
    sync();
  });

  view.scrollTop = view.scrollHeight;
  sync();
  highlightIn(document);
  setUpCopy();
  setUpMermaid();
}
