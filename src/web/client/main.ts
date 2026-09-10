// The only script the browser runs besides htmx. Bundled to static/client.js.

import { abortTurn, setUpComposer } from "./composer.ts";
import { DARK_THEME, LIGHT_THEME, THEME_KEY } from "./theme.ts";
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
    // Escape inside a field is the composer's: it closes a menu first.
    if (event.key === "Escape") {
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

// Which sessions finished a turn while the reader was looking elsewhere.
const UNREAD_KEY = "web-pi:unread";

function unreadIds(): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(UNREAD_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? (raw as string[]) : []);
  } catch {
    return new Set();
  }
}

function storeUnread(ids: Set<string>): void {
  try {
    localStorage.setItem(UNREAD_KEY, JSON.stringify([...ids]));
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
}

function setUpUnread(): void {
  const ids = unreadIds();
  if (ids.delete(currentSessionId())) storeUnread(ids);
  paintUnread();
  // The global stream drops the id of every session whose turn just ended.
  document
    .getElementById("session-finished")
    ?.addEventListener("htmx:afterSwap", (event) => {
      const id = (event.target as HTMLElement).textContent?.trim() ?? "";
      if (!id || id === currentSessionId()) return;
      const pending = unreadIds();
      pending.add(id);
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
  for (const group of document.querySelectorAll<HTMLElement>(
    "#session-list section",
  )) {
    // Only session rows count; a row's action menu has list items too.
    group.hidden = !group.querySelector("li[data-session-id]:not([hidden])");
  }
}

function setUpFilter(): void {
  document
    .querySelector<HTMLInputElement>("#session-filter")
    ?.addEventListener("input", applyFilter);
}

applyTheme(storedTheme());
setUpTheme();
setUpTranscript();
setUpShortcuts();
setUpFilter();
setUpUnread();
setUpToasts();
setUpComposer();
