// The sidebar's browser half: which sessions finished while the reader was
// elsewhere, the project menu's filter, and the refresh button's check mark.

import { setUpFolderMemory } from "./preferences.ts";

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
    const dot = row.querySelector<HTMLElement>(".unread-dot");
    if (dot) dot.hidden = !unread;
  }
  const shown =
    document.getElementById("project-select")?.dataset["projectKey"] ?? "";
  // The project rows are only in the DOM once the menu has been opened, so
  // the dot on the closed pill comes from the unread map itself.
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
      badge.hidden = count === 0;
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
    if (target instanceof Element && target.closest("#sidebar")) paintUnread();
  });
}

/** The project menu's own filter, shown once there are many projects. */
function applyProjectFilter(): void {
  const input = document.querySelector<HTMLInputElement>("#project-filter");
  if (!input) return;
  const needle = input.value.trim().toLowerCase();
  let matches = 0;
  for (const row of document.querySelectorAll<HTMLElement>(
    "#sidebar-project-menu li[data-project-key]",
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
    document.getElementById("sidebar-project-menu")?.hidePopover();
  });
}

/** The refresh button says it worked: a check for two seconds. */
function setUpSidebarRefresh(): void {
  const button = document.getElementById("sidebar-refresh");
  if (!button) return;
  button.addEventListener("htmx:afterRequest", () => {
    button.classList.add("is-hover-locked");
    setTimeout(() => {
      button.classList.remove("is-hover-locked");
    }, 2000);
  });
}

export function setUpSidebar(): void {
  setUpFolderMemory();
  setUpUnread();
  setUpProjectFilter();
  setUpSidebarRefresh();
}
