import {
  bashCommand,
  buildAtInsertText,
  cycleHistory,
  exactBuiltin,
  inputHistory,
} from "@core/composer";
import { setUpAtCompletion } from "./at-complete.ts";
import { setUpDrafts } from "./drafts.ts";
import {
  composerForm,
  replaceRange,
  setComposerValue,
  textarea,
} from "./editor.ts";
import { setUpImages } from "./images.ts";
import { setUpSlashMenu } from "./slash-menu.ts";
import { showToast } from "./toasts.ts";

// Everything the composer cannot ask the server for: which key does what, the
// attachment previews, the local file index, and the draft in localStorage.

const COMPOSITION_GRACE_MS = 100;

export function abortTurn(): void {
  const id = document.querySelector("main")?.getAttribute("data-session-id");
  if (id) void fetch(`/sessions/${id}/abort`, { method: "POST" });
}

function narrowScreen(): boolean {
  return matchMedia("(max-width: 640px)").matches;
}

/** Enter sends on a desktop; a phone keyboard needs a modifier. */
function isSendShortcut(event: KeyboardEvent): boolean {
  if (event.key !== "Enter" || event.shiftKey) return false;
  return event.ctrlKey || event.metaKey || event.altKey || !narrowScreen();
}

function lastAnswer(): string {
  const answers = document.querySelectorAll<HTMLElement>(
    '[data-role="assistant"] .prose',
  );
  return answers[answers.length - 1]?.textContent?.trim() ?? "";
}

export function setUpComposer(): void {
  const form = composerForm();
  if (!form) return;
  const sessionId = form.dataset["sessionId"] ?? null;
  const cwd = form.dataset["cwd"] ?? null;

  // The file panel's `@` buttons put a path into the composer.
  document.body.addEventListener("click", (event) => {
    const chip = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-mention]",
    );
    const area = textarea();
    if (!chip || !area) return;
    const path = chip.dataset["mention"] ?? "";
    if (path === "") return;
    const isDir = chip.dataset["mentionDir"] === "1";
    const insert = buildAtInsertText({ path, isDir }, false);
    const caret = area.selectionStart;
    replaceRange(area, caret, area.selectionEnd, insert.text, insert.caret);
  });

  const slash = setUpSlashMenu(sessionId);
  const at = setUpAtCompletion(sessionId);
  const images = setUpImages();
  const drafts = setUpDrafts(sessionId, cwd, textarea);

  let cycle: number | null = null;
  let compositionEndedAt = 0;
  let composing = false;

  function history(): string[] {
    return inputHistory(
      [...document.querySelectorAll<HTMLElement>("[data-user-text]")].map(
        (element) => element.textContent ?? "",
      ),
    );
  }

  function shellHint(value: string): void {
    const hint = document.querySelector<HTMLElement>("#shell-hint");
    if (!hint) return;
    const shell = images.count() === 0 ? bashCommand(value) : null;
    hint.hidden = shell === null;
    hint.textContent = shell
      ? shell.excluded
        ? "Shell · output stays local"
        : "Shell · output sent to model"
      : "";
  }

  function onInput(): void {
    const area = textarea();
    if (!area) return;
    cycle = null;
    slash.refresh();
    at.refresh();
    shellHint(area.value);
    drafts.save(area.value);
  }

  function clearComposer(): void {
    const area = textarea();
    if (area) setComposerValue(area, "");
    images.clear();
    drafts.clear();
    slash.close();
    at.close();
    cycle = null;
    shellHint("");
  }

  /** `/session` and `/copy` never leave the browser. */
  function runLocalBuiltin(value: string): boolean {
    if (images.count() > 0) return false;
    if (value === "/session") {
      document.querySelector<HTMLElement>("#stats-trigger")?.click();
      clearComposer();
      return true;
    }
    if (value === "/copy") {
      const text = lastAnswer();
      if (text === "") showToast("No answer to copy yet.", "warning");
      else {
        void navigator.clipboard
          .writeText(text)
          .then(() => {
            showToast("Answer copied.", "info");
          })
          .catch(() => {
            showToast("Could not reach the clipboard.");
          });
      }
      clearComposer();
      return true;
    }
    return false;
  }

  const setBehavior = (behavior: "steer" | "followUp"): void => {
    const field = form.querySelector<HTMLInputElement>("#composer-behavior");
    if (field) field.value = behavior;
  };

  const submit = (behavior: "steer" | "followUp"): void => {
    const area = textarea();
    if (!area) return;
    if (runLocalBuiltin(area.value.trim())) return;
    setBehavior(behavior);
    slash.close();
    at.close();
    // Drop the stored draft now: a new session redirects before the response
    // is handled, and the sent text must not come back as a draft there.
    drafts.clear();
    form.requestSubmit();
  };

  form.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-behavior]",
    );
    const behavior = button?.dataset["behavior"];
    if (behavior === "steer" || behavior === "followUp") setBehavior(behavior);
  });
  form.addEventListener("input", onInput);
  form.addEventListener("compositionstart", () => {
    composing = true;
  });
  form.addEventListener("compositionend", () => {
    composing = false;
    compositionEndedAt = Date.now();
  });

  form.addEventListener("keydown", (event) => {
    const area = textarea();
    if (!area || event.target !== area) return;
    if (composing || event.isComposing) return;

    const empty = area.value.trim() === "";
    if (
      (event.key === "ArrowUp" || event.key === "ArrowDown") &&
      (cycle !== null || (event.key === "ArrowUp" && empty))
    ) {
      const past = history();
      if (past.length > 0) {
        event.preventDefault();
        slash.close();
        at.close();
        const step = cycleHistory(
          past,
          cycle,
          event.key === "ArrowUp" ? "up" : "down",
        );
        cycle = step.cycle;
        setComposerValue(area, step.text);
        cycle = step.cycle;
        return;
      }
    }

    // A fully typed built-in runs on Enter instead of completing the menu.
    const sendNow = isSendShortcut(event);
    if (sendNow && exactBuiltin(area.value) !== undefined) {
      event.preventDefault();
      submit(event.altKey ? "followUp" : "steer");
      return;
    }
    if (slash.handleKey(event)) return;
    if (at.handleKey(event)) return;
    if (sendNow) {
      if (Date.now() - compositionEndedAt < COMPOSITION_GRACE_MS) return;
      event.preventDefault();
      submit(event.altKey ? "followUp" : "steer");
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      abortTurn();
    }
  });

  form.addEventListener("htmx:afterRequest", (event) => {
    const detail = (event as CustomEvent<{ successful?: boolean }>).detail;
    // A rejected submission keeps its text: the reader retries or edits it.
    if (detail.successful === true) clearComposer();
  });

  // The primary button reads "Steer" while a turn runs, and a second button
  // offers the follow-up queue, because a modifier key is invisible on touch.
  const mirrorRunning = (): void => {
    const status = document.querySelector("#status > div");
    form.toggleAttribute(
      "data-running",
      status?.hasAttribute("data-running") === true,
    );
  };
  document.body.addEventListener("htmx:afterSwap", (swap) => {
    const target = swap.target;
    if (target instanceof Element && target.closest("#status")) mirrorRunning();
  });
  mirrorRunning();
  onInput();
}
