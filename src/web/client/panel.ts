import { buildAtInsertText } from "@core/composer";
import { replaceRange, textarea } from "./editor.ts";
import { setUpResize } from "./resize.ts";

// The file panel's browser half: how wide it is, which tabs are open, where
// each was scrolled, and the stream that tells the viewer its file moved.
// Everything the panel shows is rendered by the server; this decides what to
// ask for and keeps the reading position while it arrives.

const WIDTH_KEY = "web-pi:panel-width";
const MIN_WIDTH = 300;
const MAX_WIDTH = 1200;

type Htmx = {
  ajax(verb: string, path: string, context: unknown): Promise<void>;
  process(element: Element): void;
};

function htmx(): Htmx | undefined {
  return (globalThis as { htmx?: Htmx }).htmx;
}

function panel(): HTMLElement | null {
  return document.getElementById("file-panel");
}

function sessionId(): string {
  return panel()?.dataset["session"] ?? "";
}

/** Per-tab, in memory only: reopening web-pi starts with no tabs, as pi-web. */
type TabState = { mode: string; wrap: boolean; scrollTop: number };

const tabs = new Map<string, TabState>();
let active: string | null = null;
/** Discards a response that arrived after a newer one was asked for. */
let requestId = 0;

function defaultWidth(): number {
  return Math.min(640, Math.max(360, Math.round(innerWidth * 0.42)));
}

/**
 * The panel is a column beside the conversation at 960px and up, so it may
 * not grow past what leaves the transcript room to read; below that it
 * overlays and only the absolute cap applies.
 */
function maxWidth(): number {
  // The row the panel shares with the transcript, not the window: the
  // sidebar is a column of its own.
  const row =
    panel()?.parentElement?.getBoundingClientRect().width ?? innerWidth;
  const room = innerWidth >= 960 ? row - 420 : row;
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, room));
}

function isOpen(): boolean {
  return panel()?.hidden === false;
}

function setOpen(open: boolean): void {
  const element = panel();
  if (!element) return;
  element.hidden = !open;
  document.body.dataset["filePanel"] = open ? "open" : "closed";
  document
    .getElementById("file-panel-toggle")
    ?.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) connectWatch();
  else disconnectWatch();
}

// --- Tabs ----------------------------------------------------------------

function tabBar(): HTMLElement | null {
  return document.getElementById("file-tabs");
}

function renderTabs(): void {
  const bar = tabBar();
  if (!bar) return;
  bar.replaceChildren();
  bar.hidden = tabs.size === 0;
  for (const path of tabs.keys()) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "file-tab";
    tab.role = "tab";
    tab.title = path;
    tab.dataset["path"] = path;
    tab.setAttribute("aria-selected", path === active ? "true" : "false");
    const label = document.createElement("span");
    label.className = "file-tab-label";
    label.textContent = path.split("/").pop() ?? path;
    const close = document.createElement("span");
    close.className = "file-tab-close";
    close.textContent = "✕";
    close.dataset["close"] = "1";
    tab.append(label, close);
    bar.append(tab);
  }
}

function viewer(): HTMLElement | null {
  return document.querySelector("#file-view .viewer");
}

function saveActiveState(): void {
  if (active === null) return;
  const element = viewer();
  const state = tabs.get(active);
  if (!element || !state) return;
  state.mode = element.dataset["mode"] ?? state.mode;
  const body = element.querySelector<HTMLElement>(".viewer-body");
  if (body) state.scrollTop = body.scrollTop;
}

function loadViewer(path: string, mode?: string): void {
  const state = tabs.get(path);
  const query = new URLSearchParams({ path, session: sessionId() });
  const wanted = mode ?? state?.mode;
  if (wanted !== undefined) query.set("mode", wanted);
  const target = document.getElementById("file-view");
  const id = (requestId += 1);
  void htmx()
    ?.ajax("GET", `/files/view?${query.toString()}`, {
      target,
      swap: "innerHTML",
    })
    .then(() => {
      if (id !== requestId) return;
      restoreViewer();
      connectWatch();
    });
}

function restoreViewer(): void {
  const element = viewer();
  if (!element) return;
  describeMedia(element);
  if (active === null) return;
  const state = tabs.get(active);
  if (!state) return;
  state.mode = element.dataset["mode"] ?? state.mode;
  const source = element.querySelector<HTMLElement>(".file-source");
  if (source) source.dataset["wrap"] = state.wrap ? "on" : "off";
  element
    .querySelector("[data-wrap-toggle]")
    ?.setAttribute("aria-pressed", state.wrap ? "true" : "false");
  const body = element.querySelector<HTMLElement>(".viewer-body");
  if (body && state.scrollTop > 0) body.scrollTop = state.scrollTop;
  // Every mode switch and every change replaces the toolbar, so the live
  // indicator has to be re-lit from the stream that is already open.
  const indicator = element.querySelector<HTMLElement>(".viewer-live");
  if (indicator) indicator.hidden = stream === null || watching !== active;
}

export function openFile(path: string, mode?: string): void {
  saveActiveState();
  const existing = tabs.get(path);
  if (!existing) {
    tabs.set(path, { mode: mode ?? "", wrap: false, scrollTop: 0 });
  } else if (mode !== undefined && mode !== existing.mode) {
    // A hint ("open this at its diff") resets the position but keeps wrap.
    existing.mode = mode;
    existing.scrollTop = 0;
  }
  active = path;
  setOpen(true);
  renderTabs();
  loadViewer(path, mode);
}

function closeTab(path: string): void {
  const wasActive = active === path;
  tabs.delete(path);
  if (!wasActive) {
    renderTabs();
    return;
  }
  const last = [...tabs.keys()].at(-1);
  active = last ?? null;
  renderTabs();
  if (last === undefined) {
    document.getElementById("file-view")?.replaceChildren();
    disconnectWatch();
    setOpen(false);
    return;
  }
  loadViewer(last);
}

// --- Live watch ----------------------------------------------------------

let stream: EventSource | null = null;
let watching: string | null = null;

function disconnectWatch(): void {
  stream?.close();
  stream = null;
  watching = null;
}

function connectWatch(): void {
  if (!isOpen() || active === null) {
    disconnectWatch();
    return;
  }
  if (watching === active && stream !== null) return;
  disconnectWatch();
  watching = active;
  const query = new URLSearchParams({ path: active, session: sessionId() });
  const source = new EventSource(`/files/watch?${query.toString()}`);
  stream = source;
  const dot = () => viewer()?.querySelector<HTMLElement>(".viewer-live");
  source.addEventListener("connected", () => {
    const indicator = dot();
    if (indicator) indicator.hidden = false;
  });
  source.addEventListener("change", () => {
    if (active !== null) {
      saveActiveState();
      loadViewer(active);
    }
  });
  source.addEventListener("error", () => {
    const indicator = dot();
    if (indicator) indicator.hidden = true;
  });
}

// --- Line ranges ---------------------------------------------------------

function lineOf(node: Node | null): number | null {
  const element =
    node instanceof Element ? node : (node?.parentElement ?? null);
  const row = element?.closest<HTMLElement>(".file-line");
  const value = Number(row?.dataset["line"]);
  return Number.isInteger(value) ? value : null;
}

/** The lines the reader actually selected, trimmed to what is highlighted. */
function selectedRange(): { start: number; end: number } | null {
  const selection = getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const source = viewer()?.querySelector(".file-source");
  if (!source || !source.contains(range.commonAncestorContainer)) return null;
  const first = lineOf(range.startContainer);
  const last = lineOf(range.endContainer);
  if (first === null || last === null) return null;
  // A selection that ends at offset 0 of a row never covered that row.
  const end = range.endOffset === 0 && last > first ? last - 1 : last;
  return { start: Math.min(first, end), end: Math.max(first, end) };
}

function mentionActiveFile(): void {
  const element = viewer();
  const area = textarea();
  if (!element || !area) return;
  const relative = element.dataset["relative"] ?? element.dataset["path"] ?? "";
  if (relative === "") return;
  const range = selectedRange();
  const insert = buildAtInsertText(
    { path: relative, isDir: false },
    false,
    range ?? undefined,
  );
  replaceRange(
    area,
    area.selectionStart,
    area.selectionEnd,
    insert.text,
    insert.caret,
  );
}

// --- Tree keyboard navigation -------------------------------------------

function treeItems(): HTMLElement[] {
  return [
    ...document.querySelectorAll<HTMLElement>("#file-tree .tree-item"),
  ].filter((item) => item.offsetParent !== null);
}

function focusItem(item: HTMLElement | undefined): void {
  if (!item) return;
  for (const other of treeItems()) other.tabIndex = -1;
  item.tabIndex = 0;
  item.focus();
}

function expand(item: HTMLElement, open: boolean): void {
  if (item.dataset["dir"] !== "1") return;
  item.setAttribute("aria-expanded", open ? "true" : "false");
  const children = item.querySelector<HTMLElement>(":scope > ul");
  if (children) children.hidden = !open;
  if (open) item.dispatchEvent(new CustomEvent("expand"));
}

function activate(item: HTMLElement): void {
  const path = item.dataset["path"];
  if (path === undefined) return;
  if (item.dataset["dir"] === "1") {
    expand(item, item.getAttribute("aria-expanded") !== "true");
    return;
  }
  openFile(path);
}

function onTreeKey(event: KeyboardEvent): void {
  const item = (event.target as HTMLElement | null)?.closest<HTMLElement>(
    ".tree-item",
  );
  if (!item) return;
  const items = treeItems();
  const index = items.indexOf(item);
  switch (event.key) {
    case "ArrowDown":
      focusItem(items[index + 1]);
      break;
    case "ArrowUp":
      focusItem(items[index - 1]);
      break;
    case "ArrowRight":
      if (item.dataset["dir"] !== "1") return;
      if (item.getAttribute("aria-expanded") === "true") {
        focusItem(items[index + 1]);
      } else expand(item, true);
      break;
    case "ArrowLeft":
      if (item.getAttribute("aria-expanded") === "true") expand(item, false);
      else {
        focusItem(
          item.parentElement?.closest<HTMLElement>(".tree-item") ?? undefined,
        );
      }
      break;
    case "Home":
      focusItem(items[0]);
      break;
    case "End":
      focusItem(items.at(-1));
      break;
    case "Enter":
    case " ":
      activate(item);
      break;
    default:
      return;
  }
  event.preventDefault();
}

// --- Resizing ------------------------------------------------------------

function setUpPanelResize(): void {
  const handle = document.querySelector<HTMLElement>(".panel-resize");
  if (!handle) return;
  setUpResize({
    handle,
    storageKey: WIDTH_KEY,
    property: "--file-panel-width",
    min: MIN_WIDTH,
    max: maxWidth,
    fallback: defaultWidth,
    // Anchored to the right edge: the width is the distance to it.
    widthAt: (clientX) => innerWidth - clientX,
  });
}

/**
 * What only the browser can measure: an image's pixels and an audio file's
 * length. Both land next to the size the server already rendered.
 */
function describeMedia(root: ParentNode): void {
  const meta = root.querySelector<HTMLElement>(".viewer-meta");
  if (!meta) return;
  const append = (text: string): void => {
    if (meta.textContent?.includes(text) ?? false) return;
    meta.textContent = `${meta.textContent ?? ""} · ${text}`;
  };
  const image = root.querySelector("img");
  if (image) {
    const size = () => {
      if (image.naturalWidth > 0) {
        append(
          `${String(image.naturalWidth)} × ${String(image.naturalHeight)}`,
        );
      }
    };
    if (image.complete) size();
    else image.addEventListener("load", size, { once: true });
  }
  const audio = root.querySelector("audio");
  if (audio) {
    const length = () => {
      if (!Number.isFinite(audio.duration)) return;
      const seconds = Math.round(audio.duration);
      const minutes = Math.floor(seconds / 60);
      append(`${String(minutes)}:${String(seconds % 60).padStart(2, "0")}`);
    };
    if (audio.readyState > 0) length();
    else audio.addEventListener("loadedmetadata", length, { once: true });
  }
}

/** The sidebar drags the same way the panel does, from the other side. */
export function setUpSidebarResize(): void {
  const handle = document.querySelector<HTMLElement>(".sidebar-resize");
  if (!handle) return;
  setUpResize({
    handle,
    storageKey: "web-pi:sidebar-width",
    property: "--sidebar-width",
    min: 180,
    max: () => Math.min(480, Math.max(180, innerWidth - 320)),
    fallback: () => 260,
    // Anchored to the left edge: the width is the pointer's own x.
    widthAt: (clientX) => clientX,
  });
}

export function setUpFilePanel(): void {
  if (!panel()) return;
  setUpPanelResize();
  document.body.dataset["filePanel"] = "closed";

  document
    .getElementById("file-panel-toggle")
    ?.addEventListener("click", () => {
      setOpen(!isOpen());
    });
  document.getElementById("file-panel-close")?.addEventListener("click", () => {
    setOpen(false);
  });

  // Anything carrying a path opens the viewer: a transcript link, a
  // written-file chip, a tool call's path, a changes row, a tree row.
  document.body.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const tab = target.closest<HTMLElement>(".file-tab");
    if (tab) {
      const path = tab.dataset["path"] ?? "";
      if (target.closest("[data-close]")) closeTab(path);
      else if (path !== active) openFile(path);
      return;
    }
    if (target.closest("[data-wrap-toggle]")) {
      const state = active === null ? undefined : tabs.get(active);
      const source = viewer()?.querySelector<HTMLElement>(".file-source");
      if (!state || !source) return;
      state.wrap = !state.wrap;
      source.dataset["wrap"] = state.wrap ? "on" : "off";
      target
        .closest("[data-wrap-toggle]")
        ?.setAttribute("aria-pressed", state.wrap ? "true" : "false");
      return;
    }
    if (target.closest("[data-mention-file]")) {
      mentionActiveFile();
      return;
    }
    const holder = target.closest<HTMLElement>("[data-file-path]");
    if (holder) {
      event.preventDefault();
      openFile(
        holder.dataset["filePath"] ?? "",
        holder.dataset["fileMode"] ?? undefined,
      );
      return;
    }
    const item = target.closest<HTMLElement>(".tree-item");
    if (item && !target.closest(".tree-actions")) {
      focusItem(item);
      activate(item);
    }
  });

  // The mention button must not steal the selection it is about to quote.
  document.body.addEventListener("pointerdown", (event) => {
    if ((event.target as Element | null)?.closest("[data-mention-file]")) {
      event.preventDefault();
    }
  });

  // Middle click closes a tab, as it does in a browser.
  document.body.addEventListener("auxclick", (event) => {
    if (event.button !== 1) return;
    const tab = (event.target as Element | null)?.closest<HTMLElement>(
      ".file-tab",
    );
    if (!tab) return;
    event.preventDefault();
    closeTab(tab.dataset["path"] ?? "");
  });

  document.body.addEventListener("keydown", (event) => {
    const search = document.getElementById("file-search");
    if (event.key === "Escape" && event.target === search) {
      if (search instanceof HTMLInputElement) {
        search.value = "";
        // htmx listens for `search`, which is what clearing the field fires.
        search.dispatchEvent(new Event("search", { bubbles: true }));
      }
      event.preventDefault();
      return;
    }
    onTreeKey(event);
  });

  // A refreshed tree loses focus positions; the first row becomes the entry.
  document.body.addEventListener("htmx:afterSwap", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.id === "file-explorer" || target.id === "file-tree") {
      const first = treeItems()[0];
      if (first) first.tabIndex = 0;
    }
    if (target.id === "file-view") restoreViewer();
  });

  // A viewer that scrolls records where it is, so switching tabs comes back.
  document.body.addEventListener(
    "scroll",
    (event) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.classList.contains("viewer-body")
      ) {
        saveActiveState();
      }
    },
    true,
  );

  addEventListener("pagehide", disconnectWatch);
}
