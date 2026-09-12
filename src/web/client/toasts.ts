// The notice shelf. Fragments arrive from the session stream (`hx-partial`),
// client-side failures arrive as a `web-pi:toast` HX-Trigger event, and both
// land in the same list: at most five visible, five seconds each, paused
// while the pointer rests on one.

const VISIBLE = 5;
const LIFETIME_MS = 5000;

const LEVEL_COLOUR: Record<string, string> = {
  info: "var(--accent)",
  warning: "var(--warning)",
  error: "var(--danger)",
};

/**
 * pi-web's `NoticeShelf` card, which the server also renders for a notice
 * that arrives on the stream (`views/Composer.tsx`). Kept as a string so a
 * client-side failure and a server notice are the same card.
 */
const ITEM_STYLE =
  "display:flex; align-items:flex-start; gap:10px; min-height:60px;" +
  " height:auto; max-height:500px; pointer-events:auto; overflow:hidden;" +
  " border-radius:14px;" +
  " border:1px solid color-mix(in srgb, var(--border) 70%, transparent);" +
  " background:var(--bg); color:var(--text-muted); width:fit-content;" +
  " max-width:min(100%, 620px);" +
  " box-shadow:0 1px 2px rgba(15,23,42,0.05), 0 10px 28px -14px rgba(15,23,42,0.24);" +
  " font-size:14px; line-height:1.5; transform-origin:top right;" +
  " animation:notice-shelf-in 0.18s ease-out backwards; padding:0 12px";

const TEXT_STYLE =
  "padding:14px 0; min-width:0; max-width:100%; max-height:470px;" +
  " overflow-y:auto; scrollbar-width:thin; white-space:pre-line;" +
  " word-break:break-word";

function shelf(): HTMLElement | null {
  return document.getElementById("toasts");
}

function schedule(toast: HTMLElement): void {
  let timer = setTimeout(() => {
    toast.remove();
  }, LIFETIME_MS);
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
  toast.className = "notice-shelf-item";
  toast.setAttribute("role", level === "error" ? "alert" : "status");
  toast.setAttribute("style", ITEM_STYLE);
  const dot = document.createElement("span");
  dot.setAttribute(
    "style",
    `width:7px; height:7px; border-radius:50%; background:${
      LEVEL_COLOUR[level] ?? "var(--danger)"
    }; flex-shrink:0; margin-top:21px`,
  );
  const text = document.createElement("span");
  text.tabIndex = 0;
  text.setAttribute("style", TEXT_STYLE);
  text.textContent = message;
  toast.append(dot, text);
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
  document.body.addEventListener("htmx:after:settle", (event) => {
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
