import { highlightIn } from "./highlight.ts";
import { setUpMermaid } from "./mermaid.ts";

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

async function copyText(button: HTMLElement, text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return;
  }
  const previous = button.textContent;
  button.textContent = "Copied";
  setTimeout(() => {
    button.textContent = previous;
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
    const block = code.closest(".code-block")?.querySelector("code");
    void copyText(code, block?.textContent ?? "");
  });
}

export function setUpTranscript(): void {
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
    if (anchor !== null) {
      view.scrollTop = Math.max(0, view.scrollHeight - anchor);
      anchor = null;
    } else if (follow) {
      view.scrollTop = view.scrollHeight;
    }
    const target = event.target;
    if (target instanceof Element) highlightIn(target);
    sync();
  });

  view.scrollTop = view.scrollHeight;
  sync();
  highlightIn(document);
  setUpCopy();
  setUpMermaid();
}
