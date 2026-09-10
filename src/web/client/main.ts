// The only script the browser runs besides htmx. Bundled to static/client.js.

import { DARK_THEME, LIGHT_THEME, THEME_KEY } from "./theme.ts";

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

// Keep the reader at the end of the conversation while a turn streams in,
// unless they scrolled up to read something earlier.
function setUpScrollFollow(): void {
  const log = document.getElementById("log");
  if (!log) return;
  let stick = true;
  log.addEventListener("scroll", () => {
    stick = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  });
  document.body.addEventListener("htmx:afterSwap", () => {
    if (stick) log.scrollTop = log.scrollHeight;
  });
  log.scrollTop = log.scrollHeight;
}

function abortTurn(): void {
  const id = document.querySelector("main")?.getAttribute("data-session-id");
  if (id) void fetch(`/sessions/${id}/abort`, { method: "POST" });
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
    if (event.key === "Escape") {
      abortTurn();
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

applyTheme(storedTheme());
setUpTheme();
setUpScrollFollow();
setUpShortcuts();
