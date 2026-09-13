// The sidebar's browser half: the state pi-web keeps in React and web-pi
// cannot render from the server — which sessions finished while the reader
// was elsewhere, where a row's fixed-position menu lands, whether a modifier
// is held, and which project group is open.

import { relativeTime } from "@core/sessions";
import { setUpRegion } from "./lifecycle.ts";
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

function paintSelection(): void {
  const active = currentSessionId();
  for (const row of document.querySelectorAll<HTMLElement>(
    ".session-row[data-session-id]",
  )) {
    const selected = row.dataset["sessionId"] === active;
    row.classList.toggle("is-selected", selected);
  }
}

/** The unread halo uses --info and adds “New activity” to the status title. */
function paintUnread(): void {
  paintSelection();
  const ids = unreadIds();
  for (const row of document.querySelectorAll<HTMLElement>(
    ".session-row[data-session-id]",
  )) {
    const unread = ids.has(row.dataset["sessionId"] ?? "");
    const indicator = row.querySelector<HTMLElement>(".session-indicator");
    if (!indicator) continue;
    indicator.classList.toggle("session-indicator-unread", unread);
    const status = indicator.dataset["status"] ?? "";
    const label = unread ? `${status} · New activity` : status;
    indicator.title = label;
    indicator.setAttribute("aria-label", label);
  }
  const shown =
    document.getElementById("project-select")?.dataset["projectKey"] ?? "";
  // The project rows are only in the DOM once the menu has been opened, so
  // the dot on the closed pill comes from the unread map itself.
  const dot = document.getElementById("project-activity");
  if (dot && [...ids.values()].some((key) => key !== "" && key !== shown)) {
    dot.hidden = false;
  }
  for (const group of document.querySelectorAll<HTMLElement>(
    ".project-folder-group[data-project-key]",
  )) {
    const key = group.dataset["projectKey"] ?? "";
    const count = [...ids.values()].filter((project) => project === key).length;
    const wrapper = group.querySelector<HTMLElement>(".project-activity");
    const badge = group.querySelector<HTMLElement>(".project-unread");
    const number = group.querySelector<HTMLElement>(".project-unread-count");
    if (!wrapper || !badge || !number) continue;
    // The wrapper is what the label's flex space is measured against, so it
    // stays out of the layout entirely while a project is quiet.
    const running = group.querySelector(".project-running") !== null;
    wrapper.hidden = !running && count === 0;
    badge.hidden = count === 0;
    if (count === 0) {
      number.textContent = "";
      badge.removeAttribute("aria-label");
      continue;
    }
    number.textContent = String(count);
    badge.setAttribute("aria-label", `New session activity (${String(count)})`);
  }
}

function setUpUnread(): void {
  setUpRegion("main", () => {
    const ids = unreadIds();
    if (ids.delete(currentSessionId())) storeUnread(ids);
    paintUnread();
  });
  // The global stream announces the id and project of each finished session.
  document.addEventListener("finished", (event) => {
    const text = (event as CustomEvent<{ data?: unknown }>).detail?.data;
    if (typeof text !== "string") return;
    let finished: { id?: string; project?: string } = {};
    try {
      finished = JSON.parse(text) as typeof finished;
    } catch {
      return;
    }
    if (!finished || typeof finished.id !== "string") return;
    const id = finished.id;
    if (!id || id === currentSessionId()) return;
    const pending = unreadIds();
    pending.set(id, finished.project ?? "");
    storeUnread(pending);
    paintUnread();
  });
  // Rows arrive lazily and out of band; a streaming turn swaps ten times a
  // second and must not drag the whole sidebar through this.
  document.addEventListener("htmx:after:settle", (event) => {
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
  for (const group of document.querySelectorAll<HTMLElement>(
    "#sidebar-project-menu .project-folder-group[data-project-key]",
  )) {
    const key = (group.dataset["projectKey"] ?? "").toLowerCase();
    group.hidden = needle !== "" && !key.includes(needle);
    if (!group.hidden) matches += 1;
  }
  const empty = document.getElementById("project-empty");
  if (empty) empty.hidden = matches > 0 || needle === "";
}

function setUpProjectFilter(): void {
  document.addEventListener("input", (event) => {
    if ((event.target as HTMLElement).id === "project-filter") {
      applyProjectFilter();
    }
  });
  document.addEventListener("keydown", (event) => {
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

/**
 * A project with more than one working folder opens and closes in place
 * (§3.3). The folders are already in the page, so this only flips the
 * disclosure; `areas/sidebar.css` turns aria-expanded into the chevron.
 */
function setUpFolderGroups(): void {
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const row = target.closest<HTMLElement>(
      ".project-folder-row[aria-expanded]",
    );
    if (!row) return;
    const open = row.getAttribute("aria-expanded") !== "true";
    row.setAttribute("aria-expanded", open ? "true" : "false");
    const folders = document.getElementById(
      row.getAttribute("aria-controls") ?? "",
    );
    if (folders) folders.hidden = !open;
  });
}

/** pi-web's key, so a reader's choice survives the switch between the two. */
const EXPLORER_OPEN_KEY = "pi-web:file-explorer:open";

/**
 * The explorer folds to its header row (§3.5). pi-web keeps `explorerOpen`
 * in React and reads the stored value after hydration, so a collapsed
 * explorer opens for a frame there too; here aria-expanded on the toggle is
 * the state and areas/sidebar.css paints both states from it. Storage is
 * best-effort, as in pi-web: without it the choice lasts for this page.
 */
function mountExplorerFold(button: HTMLElement, signal: AbortSignal): void {
  let open = true;
  try {
    open = localStorage.getItem(EXPLORER_OPEN_KEY) !== "false";
  } catch {
    // A private window: the explorer starts open.
  }
  const paint = () => {
    button.setAttribute("aria-expanded", String(open));
  };
  paint();
  button.addEventListener(
    "click",
    () => {
      open = !open;
      try {
        localStorage.setItem(EXPLORER_OPEN_KEY, String(open));
      } catch {
        // Without storage the choice lasts for this page only.
      }
      paint();
    },
    { signal },
  );
}

/** The refresh button says it worked: a check for two seconds (§3.1). */
function mountSidebarRefresh(button: HTMLElement, signal: AbortSignal): void {
  button.removeAttribute("data-done");
  let timer: ReturnType<typeof setTimeout> | undefined;
  signal.addEventListener(
    "abort",
    () => {
      clearTimeout(timer);
    },
    { once: true },
  );
  button.addEventListener(
    "htmx:after:request",
    () => {
      button.setAttribute("data-done", "");
      clearTimeout(timer);
      timer = setTimeout(() => {
        button.removeAttribute("data-done");
      }, 2000);
    },
    { signal },
  );
}

/**
 * Where a row's action menu lands (SessionItem.tsx `menuPositionFor`): a
 * fixed box under the trigger, 144px wide, clamped to the viewport and
 * flipped above the row when it would not fit below. Popover toggle events
 * do not bubble, so this listens in the capture phase.
 */
function placeRowMenu(menu: HTMLElement): void {
  const trigger = menu
    .closest(".session-row")
    ?.querySelector<HTMLElement>(".session-menu-trigger");
  if (!trigger) return;
  const rect = trigger.getBoundingClientRect();
  const width = 144;
  const rowHeight = matchMedia("(pointer: coarse)").matches ? 44 : 34;
  const height = menu.querySelectorAll(".menu-item").length * rowHeight + 10;
  menu.style.left = `${String(
    Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
  )}px`;
  menu.style.top = `${String(
    rect.bottom + 4 + height <= window.innerHeight
      ? rect.bottom + 4
      : Math.max(8, rect.top - height - 4),
  )}px`;
}

function setUpRowMenus(): void {
  document.addEventListener(
    "beforetoggle",
    (event) => {
      const menu = event.target;
      if (
        !(menu instanceof HTMLElement) ||
        !menu.matches(".session-row > .menu-surface") ||
        event.newState !== "open"
      ) {
        return;
      }
      placeRowMenu(menu);
    },
    true,
  );
}

/**
 * pi-web puts a ⌘1…⌘0 badge where a row's menu trigger is while a modifier
 * is held, and jumps to that session on the matching digit (§3.4). The
 * modifier decides the label, so it is written here rather than server-side.
 */
function setUpShortcuts(): void {
  let modifier: "ctrl" | "meta" | null = null;

  const swap = (
    badge: HTMLElement,
    other: HTMLElement | null,
    text: string,
  ) => {
    const shown = modifier !== null && text !== "";
    badge.textContent = text;
    badge.hidden = !shown;
    if (other) other.hidden = shown;
  };

  const paint = () => {
    const label = modifier === "meta" ? "⌘" : "Ctrl+";
    const newSession = document.querySelector<HTMLElement>(
      ".new-session-shortcut",
    );
    if (newSession) {
      swap(
        newSession,
        document.querySelector<HTMLElement>(".new-session-plus"),
        `${label}K`,
      );
    }
    const rows = document.querySelectorAll<HTMLElement>(
      "#session-list .session-row",
    );
    rows.forEach((row, index) => {
      const badge = row.querySelector<HTMLElement>(".session-shortcut");
      if (!badge) return;
      swap(
        badge,
        row.querySelector<HTMLElement>(".session-menu-trigger"),
        index < 10 ? `${label}${index === 9 ? "0" : String(index + 1)}` : "",
      );
    });
  };

  const update = (event: KeyboardEvent) => {
    const next = event.metaKey ? "meta" : event.ctrlKey ? "ctrl" : null;
    if (next === modifier) return;
    modifier = next;
    paint();
  };

  window.addEventListener("keydown", (event) => {
    update(event);
    if (
      event.repeat ||
      event.altKey ||
      event.shiftKey ||
      (!event.ctrlKey && !event.metaKey) ||
      !/^[0-9]$/.test(event.key)
    ) {
      return;
    }
    const index = event.key === "0" ? 9 : Number(event.key) - 1;
    const row = document.querySelectorAll<HTMLElement>(
      "#session-list .session-row",
    )[index];
    const link = row?.querySelector<HTMLAnchorElement>("a[href]");
    if (!link) return;
    event.preventDefault();
    link.click();
  });
  window.addEventListener("keyup", update);
  window.addEventListener("blur", () => {
    if (modifier === null) return;
    modifier = null;
    paint();
  });
  // A row swapped in while the modifier is held arrives with its badge
  // hidden and unnumbered, and the rows after it have all moved down one.
  setUpRegion("#sidebar", paint);
  document.addEventListener("htmx:after:settle", (event) => {
    const target = event.target;
    if (modifier === null || !(target instanceof Element)) return;
    if (target.closest("#sidebar")) paint();
  });
}

function mountRelativeTimes(sidebar: HTMLElement, signal: AbortSignal): void {
  const paint = () => {
    if (document.hidden) return;
    const now = Date.now();
    for (const age of sidebar.querySelectorAll<HTMLElement>(
      "[data-session-modified-at]",
    )) {
      const text = relativeTime(age.dataset["sessionModifiedAt"] ?? "", now);
      if (age.textContent !== text) age.textContent = text;
    }
  };
  paint();
  // Query current rows, not a snapshot: pagination and SSE replace them.
  const timer = setInterval(paint, 1000);
  signal.addEventListener(
    "abort",
    () => {
      clearInterval(timer);
    },
    { once: true },
  );
  sidebar.addEventListener("htmx:after:process", paint, { signal });
  document.addEventListener("visibilitychange", paint, { signal });
  window.addEventListener("pageshow", paint, { signal });
}

/** pi-web's whole row is the click target, not just its title (§3.4). */
function setUpRowSelection(): void {
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const row = target.closest<HTMLElement>(".session-row");
    if (!row || target.closest("a, button, input, .menu-surface")) return;
    row.querySelector<HTMLAnchorElement>("a[href]")?.click();
  });
}

export function setUpSidebar(): void {
  setUpRegion("#sidebar", mountRelativeTimes);
  setUpFolderMemory();
  setUpUnread();
  setUpProjectFilter();
  setUpFolderGroups();
  setUpRegion("#explorer-toggle", mountExplorerFold);
  setUpRegion("#sidebar-refresh", mountSidebarRefresh);
  setUpRowMenus();
  setUpShortcuts();
  setUpRowSelection();
}
