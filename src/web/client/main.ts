// The only script the browser runs besides htmx. Bundled to static/client.js.

import { abortTurn, setUpComposer } from "./composer.ts";
import { dialogOpen, setUpDialogs } from "./dialogs.ts";
import { setUpExtensions } from "./extensions.ts";
import { setUpNotifications } from "./notify.ts";
import { setUpPush } from "./push.ts";
import { setUpFolderMemory, setUpPreferences } from "./preferences.ts";
import { DARK_THEME, LIGHT_THEME, THEME_KEY } from "./theme.ts";
import { setUpFilePanel } from "./panel.ts";
import { setUpRail } from "./rail.ts";
import { setUpToasts } from "./toasts.ts";
import { setUpTranscript } from "./transcript.ts";

type Theme = "light" | "dark" | "system";

const darkQuery = matchMedia("(prefers-color-scheme: dark)");

function storedTheme(): Theme {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    // Storage can be blocked; the system theme is a fine fallback.
    return "system";
  }
}

function applyTheme(theme: Theme): void {
  const dark = theme === "dark" || (theme === "system" && darkQuery.matches);
  document.documentElement.setAttribute(
    "data-theme",
    dark ? DARK_THEME : LIGHT_THEME,
  );
}

function setUpTheme(): void {
  const select = document.querySelector<HTMLSelectElement>("#theme-select");
  if (select) {
    select.value = storedTheme();
    select.addEventListener("change", () => {
      const theme = select.value as Theme;
      try {
        localStorage.setItem(THEME_KEY, theme);
      } catch {
        // Without storage the choice lasts for this page only.
      }
      applyTheme(theme);
    });
  }
  darkQuery.addEventListener("change", () => {
    if (storedTheme() === "system") applyTheme("system");
  });
}

function inTextEntry(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLInputElement
  );
}

function setUpShortcuts(): void {
  document.addEventListener("keydown", (event) => {
    // Escape inside a field is the composer's: it closes a menu first, and
    // an open dialog owns it outright, or closing the picker would abort the
    // turn behind it.
    if (event.key === "Escape") {
      if (dialogOpen()) return;
      if (!event.defaultPrevented && !inTextEntry(event.target)) abortTurn();
      return;
    }
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) {
      return;
    }
    if (event.key === "k") {
      event.preventDefault();
      location.assign("/new");
      return;
    }
    // Digits pick the nth session, but they are ordinary typing in a field.
    if (inTextEntry(event.target)) return;
    const position = Number(event.key);
    if (!Number.isInteger(position) || position < 1 || position > 9) return;
    const links = document.querySelectorAll<HTMLAnchorElement>(
      "#sidebar a[href^='/sessions/']",
    );
    const link = links[position - 1];
    if (!link) return;
    event.preventDefault();
    location.assign(link.href);
  });
}

// Which sessions finished a turn while the reader was looking elsewhere, and
// the project each belongs to: the sidebar shows one project at a time, so a
// completion elsewhere can only show up as a badge on that project.
const UNREAD_KEY = "web-pi:unread";

function unreadIds(): Map<string, string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(UNREAD_KEY) ?? "{}");
    // Phase 3a stored a plain array of ids; those keep working, unattributed.
    if (Array.isArray(raw)) {
      return new Map((raw as string[]).map((id) => [id, ""]));
    }
    if (typeof raw !== "object" || raw === null) return new Map();
    return new Map(Object.entries(raw as Record<string, string>));
  } catch {
    return new Map();
  }
}

function storeUnread(ids: Map<string, string>): void {
  try {
    localStorage.setItem(UNREAD_KEY, JSON.stringify(Object.fromEntries(ids)));
  } catch {
    // Without storage the dots last for this page only.
  }
}

function currentSessionId(): string {
  return document.querySelector("main")?.getAttribute("data-session-id") ?? "";
}

function paintUnread(): void {
  const ids = unreadIds();
  for (const row of document.querySelectorAll<HTMLElement>(
    "[data-session-id]",
  )) {
    const unread = ids.has(row.dataset["sessionId"] ?? "");
    row.querySelector(".unread-dot")?.classList.toggle("hidden", !unread);
  }
  const shown =
    document.getElementById("project-select")?.dataset["projectKey"] ?? "";
  // The project rows are only in the DOM once the selector has been opened,
  // so the dot on the closed selector comes from the unread map itself.
  const dot = document.getElementById("project-activity");
  if (dot && [...ids.values()].some((key) => key !== "" && key !== shown)) {
    dot.hidden = false;
  }
  for (const row of document.querySelectorAll<HTMLElement>(
    "li[data-project-key]",
  )) {
    const key = row.dataset["projectKey"] ?? "";
    const count = [...ids.values()].filter((project) => project === key).length;
    const badge = row.querySelector<HTMLElement>(".project-unread");
    if (badge) {
      badge.textContent = String(count);
      badge.classList.toggle("hidden", count === 0);
    }
  }
}

function setUpUnread(): void {
  const ids = unreadIds();
  if (ids.delete(currentSessionId())) storeUnread(ids);
  paintUnread();
  // The global stream drops the id and project of every session whose turn
  // just ended.
  document
    .getElementById("session-finished")
    ?.addEventListener("htmx:afterSwap", (event) => {
      const text = (event.target as HTMLElement).textContent?.trim() ?? "";
      let finished: { id?: string; project?: string } = {};
      try {
        finished = JSON.parse(text) as typeof finished;
      } catch {
        return;
      }
      const id = finished.id ?? "";
      if (!id || id === currentSessionId()) return;
      const pending = unreadIds();
      pending.set(id, finished.project ?? "");
      storeUnread(pending);
      paintUnread();
    });
  // Rows arrive lazily and out of band; a streaming turn swaps ten times a
  // second and must not drag the whole sidebar through this.
  document.body.addEventListener("htmx:afterSwap", (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest("#sidebar")) {
      paintUnread();
      applyFilter();
    }
  });
}

// Sidebar text filter. Rows carry their title in `data-title`, so filtering
// never needs the server.
function applyFilter(): void {
  const input = document.querySelector<HTMLInputElement>("#session-filter");
  const needle = (input?.value ?? "").trim().toLowerCase();
  for (const row of document.querySelectorAll<HTMLElement>(
    "#session-list li[data-session-id]",
  )) {
    const id = row.dataset["sessionId"] ?? "";
    const title = row.dataset["title"] ?? "";
    row.hidden =
      needle !== "" && !title.includes(needle) && !id.includes(needle);
  }
}

/** The workspace selector's own filter, shown once there are many projects. */
function applyProjectFilter(): void {
  const input = document.querySelector<HTMLInputElement>("#project-filter");
  if (!input) return;
  const needle = input.value.trim().toLowerCase();
  let matches = 0;
  for (const row of document.querySelectorAll<HTMLElement>(
    "#project-select li[data-project-key]",
  )) {
    const key = (row.dataset["projectKey"] ?? "").toLowerCase();
    row.hidden = needle !== "" && !key.includes(needle);
    if (!row.hidden) matches += 1;
  }
  const empty = document.getElementById("project-empty");
  if (empty) empty.hidden = matches > 0;
}

function setUpProjectFilter(): void {
  document.body.addEventListener("input", (event) => {
    if ((event.target as HTMLElement).id === "project-filter") {
      applyProjectFilter();
    }
  });
  document.body.addEventListener("keydown", (event) => {
    const input = event.target;
    if (
      event.key !== "Escape" ||
      !(input instanceof HTMLInputElement) ||
      input.id !== "project-filter"
    ) {
      return;
    }
    input.value = "";
    applyProjectFilter();
    input.closest("details")?.removeAttribute("open");
  });
}

function setUpFilter(): void {
  document
    .querySelector<HTMLInputElement>("#session-filter")
    ?.addEventListener("input", applyFilter);
}

applyTheme(storedTheme());
setUpTheme();
setUpPreferences();
setUpDialogs();
setUpFolderMemory();
setUpTranscript();
setUpRail();
setUpShortcuts();
setUpFilter();
setUpProjectFilter();
setUpUnread();
setUpToasts();
setUpComposer();
setUpFilePanel();
setUpExtensions();
setUpNotifications();
setUpPush();
