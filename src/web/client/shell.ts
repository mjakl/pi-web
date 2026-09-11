// The application shell's browser half: the theme, the two panel columns and
// their drag handles, the top-bar panels, the keyboard shortcuts, and the
// document title. Everything here belongs to the shell area; the sidebar's
// own behaviour is in sidebar.ts.

import { abortTurn } from "./composer.ts";
import { dialogOpen, setUpDialogs } from "./dialogs.ts";
import { setUpExtensions } from "./extensions.ts";
import { setUpNotifications } from "./notify.ts";
import { setUpPreferences } from "./preferences.ts";
import { setUpPush } from "./push.ts";
import { setUpResize } from "./resize.ts";
import { setUpTheme } from "./theme.ts";
import { setUpToasts } from "./toasts.ts";
import { setUpViewport } from "./viewport.ts";

const SIDEBAR_WIDTH_KEY = "pi-sidebar-width";
const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 480;
const SIDEBAR_DEFAULT = 260;

function sidebar(): HTMLElement | null {
  return document.getElementById("session-sidebar");
}

/** pi-web's title: the folder on screen, then the product. */
function setUpTitle(): void {
  const cwd = document.querySelector("main")?.dataset["cwd"] ?? "";
  const name = cwd.split(/[\\/]/).filter(Boolean).pop();
  document.title = name === undefined ? "Pi Web" : `${name} - Pi Web`;
}

function setSidebarOpen(open: boolean): void {
  const element = sidebar();
  if (!element) return;
  element.classList.toggle("sidebar-open", open);
  element.classList.toggle("sidebar-closed", !open);
  const toggle = document.getElementById("sidebar-toggle");
  toggle?.setAttribute("aria-expanded", String(open));
  const openIcon = toggle?.querySelector<HTMLElement>(
    "[data-sidebar-open-icon]",
  );
  const closedIcon = toggle?.querySelector<HTMLElement>(
    "[data-sidebar-closed-icon]",
  );
  if (openIcon) openIcon.hidden = !open;
  if (closedIcon) closedIcon.hidden = open;
  const backdrop = document.querySelector<HTMLElement>(
    ".sidebar-overlay-backdrop",
  );
  if (backdrop) {
    backdrop.style.opacity = open ? "1" : "0";
    backdrop.style.pointerEvents = open ? "auto" : "none";
  }
  const handle = document.querySelector<HTMLElement>(".sidebar-resize-handle");
  if (handle) handle.hidden = !open;
}

/**
 * The drawer starts closed on a phone. `.sidebar-mobile-pending` holds it off
 * screen until this runs, so the first paint never slides it away.
 */
function setUpSidebar(): void {
  const element = sidebar();
  if (!element) return;
  const mobile = matchMedia("(max-width: 640px)").matches;
  setSidebarOpen(!mobile);
  element.classList.remove("sidebar-mobile-pending");
  document
    .querySelector(".sidebar-overlay-backdrop")
    ?.classList.remove("sidebar-mobile-pending");
  document.getElementById("sidebar-toggle")?.addEventListener("click", () => {
    setSidebarOpen(!(sidebar()?.classList.contains("sidebar-open") ?? false));
  });
  document
    .querySelector(".sidebar-overlay-backdrop")
    ?.addEventListener("click", () => {
      setSidebarOpen(false);
    });
  const handle = document.querySelector<HTMLElement>(".sidebar-resize-handle");
  if (!handle) return;
  setUpResize({
    handle,
    storageKey: SIDEBAR_WIDTH_KEY,
    property: "--sidebar-width",
    min: SIDEBAR_MIN,
    max: () => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, innerWidth - 320)),
    fallback: () => SIDEBAR_DEFAULT,
    // Anchored to the left edge: the width is the pointer's own x.
    widthAt: (clientX) => clientX,
  });
}

/**
 * System, Tools and Session info share one host under the top bar, and only
 * one is open at a time. A second click on the open button closes it, which
 * has to happen before htmx sees the click and fetches the panel again.
 */
function setUpTopPanels(): void {
  const host = document.getElementById("top-panel");
  if (!host) return;
  const buttons = [
    ...document.querySelectorAll<HTMLElement>("[data-top-panel]"),
  ];
  const paint = (open: string): void => {
    host.hidden = open === "";
    for (const button of buttons) {
      const active = button.dataset["topPanel"] === open;
      button.setAttribute("aria-expanded", String(active));
      button.style.background = active ? "var(--bg-selected)" : "none";
      button.style.borderTopColor = active ? "var(--accent)" : "transparent";
      button.style.color = active ? "var(--text)" : "var(--text-muted)";
    }
  };
  const close = (): void => {
    host.replaceChildren();
    paint("");
  };
  document.body.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLElement>("[data-top-panel]");
      if (!button) {
        // A click anywhere else dismisses the panel, as a popover would.
        if (!host.hidden && !host.contains(target)) close();
        return;
      }
      if (button.getAttribute("aria-expanded") === "true") {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      paint(button.dataset["topPanel"] ?? "");
    },
    true,
  );
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !host.hidden) close();
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
    // 1..9, and 0 for the tenth, as in a browser's own tab shortcuts.
    const position = event.key === "0" ? 10 : Number(event.key);
    if (!Number.isInteger(position) || position < 1 || position > 10) return;
    const links = document.querySelectorAll<HTMLAnchorElement>(
      "#session-list a[href^='/sessions/']",
    );
    const link = links[position - 1];
    if (!link) return;
    event.preventDefault();
    location.assign(link.href);
  });
}

export function setUpShell(): void {
  setUpTheme();
  setUpTitle();
  setUpPreferences();
  setUpDialogs();
  setUpSidebar();
  setUpTopPanels();
  setUpShortcuts();
  setUpToasts();
  setUpViewport();
  setUpExtensions();
  setUpNotifications();
  setUpPush();
  document.getElementById("page-refresh")?.addEventListener("click", () => {
    location.reload();
  });
}
