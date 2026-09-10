// The notice shelf. Fragments arrive from the session stream (`sse-swap`),
// client-side failures arrive as a `web-pi:toast` HX-Trigger event, and both
// land in the same list: at most five visible, five seconds each, paused
// while the pointer rests on one.

const VISIBLE = 5;
const LIFETIME_MS = 5000;

const LEVEL_CLASS: Record<string, string> = {
  info: "alert-info",
  warning: "alert-warning",
  error: "alert-error",
};

function shelf(): HTMLElement | null {
  return document.getElementById("toasts");
}

function schedule(toast: HTMLElement): void {
  let timer = setTimeout(() => {
    toast.remove();
  }, LIFETIME_MS);
  toast.classList.add("pointer-events-auto");
  toast.addEventListener("mouseenter", () => {
    clearTimeout(timer);
  });
  toast.addEventListener("mouseleave", () => {
    timer = setTimeout(() => {
      toast.remove();
    }, LIFETIME_MS);
  });
  toast.addEventListener("click", () => {
    toast.remove();
  });
}

function trim(list: HTMLElement): void {
  while (list.children.length > VISIBLE) list.firstElementChild?.remove();
}

export function showToast(
  message: string,
  level: "info" | "warning" | "error" = "error",
): void {
  const list = shelf();
  if (!list) return;
  const toast = document.createElement("div");
  toast.className = `alert py-2 text-sm ${LEVEL_CLASS[level] ?? "alert-error"}`;
  toast.textContent = message;
  list.append(toast);
  schedule(toast);
  trim(list);
}

export function setUpToasts(): void {
  document.body.addEventListener("web-pi:toast", (event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (typeof detail !== "object" || detail === null) return;
    const { message, level } = detail as {
      message?: unknown;
      level?: unknown;
    };
    if (typeof message !== "string") return;
    showToast(
      message,
      level === "info" || level === "warning" ? level : "error",
    );
  });
  // Server-rendered toasts are appended by htmx; give them the same timers.
  document.body.addEventListener("htmx:afterSwap", (event) => {
    const list = shelf();
    if (!list || event.target !== list) return;
    for (const child of [...list.children]) {
      const toast = child as HTMLElement;
      if (toast.dataset["timed"] === undefined) {
        toast.dataset["timed"] = "1";
        schedule(toast);
      }
    }
    trim(list);
  });
}
