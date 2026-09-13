import {
  type AtQuery,
  buildAtInsertText,
  buildEntriesFromFiles,
  extractAtQuery,
  type FileEntry,
  filterFileEntries,
  isFilePathQuery,
} from "@core/composer";
import { catppuccinIcon } from "@core/file-types";
import { escapeHtml } from "@core/html";
import { type MenuEndpoints, replaceRange } from "./editor.ts";
import { createMenu, handleMenuKey, type Menu } from "./menu.ts";

// `@` completion. Plain names are matched against a cached index of the whole
// folder in the browser, so typing costs nothing; only path-like queries
// (`@./`, `@~/`) and a truncated index need the server.

const INDEX_TTL_MS = 10_000;
const SEARCH_DEBOUNCE_MS = 150;

/** pi-web's Catppuccin mask, built here because the rows are (§6.4). */
function icon(entry: FileEntry): string {
  const name = entry.isDir ? "_folder" : catppuccinIcon(entry.path);
  const root = "/static/icons/catppuccin";
  return `<span aria-hidden="true" class="catppuccin-file-icon" style="width: 14px; height: 14px; --catppuccin-icon-light: url(${root}/latte/${name}.svg); --catppuccin-icon-dark: url(${root}/mocha/${name}.svg)"></span>`;
}

/** One row: the directory prefix dim, the name plain, "/" dim for folders. */
function row(entry: FileEntry, index: number): string {
  const name = entry.path.split(/[\\/]/).pop() ?? entry.path;
  const prefix = entry.path.slice(0, entry.path.length - name.length);
  const dim = (text: string) =>
    `<span style="color:var(--text-dim)">${escapeHtml(text)}</span>`;
  return (
    `<button type="button" class="menu-item" style="font-family:var(--font-mono)"` +
    ` data-index="${String(index)}" data-path="${escapeHtml(entry.path)}" data-dir="${entry.isDir ? "1" : ""}">` +
    `<span style="flex-shrink:0; display:flex; align-items:center">${icon(entry)}</span>` +
    `<span style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">` +
    `${prefix === "" ? "" : dim(prefix)}${escapeHtml(name)}${entry.isDir ? dim("/") : ""}` +
    `</span></button>`
  );
}

/** Mirrors `MENU_HEADER` in views/Composer.tsx: the slash menu's own header. */
const MENU_HEADER =
  "padding:8px 10px; border-bottom:1px solid var(--border); display:flex;" +
  " align-items:center; justify-content:space-between; gap:8px;" +
  " font-size:11px; color:var(--text-dim); flex-shrink:0";

/** pi-web's `@` panel: the count header, then the matches (§6.4). */
function panel(title: string, body: string): string {
  return (
    `<div style="${MENU_HEADER}"><span>${escapeHtml(title)}</span>` +
    `<span style="font-family:var(--font-mono)">Tab / Enter</span></div>` +
    `<div style="max-height:calc(min(48vh, 400px) - 34px); overflow-y:auto; padding:4px">${body}</div>`
  );
}

function note(text: string): string {
  return `<div style="padding:6px 8px; font-size:12px; color:var(--text-dim)">${escapeHtml(text)}</div>`;
}

function renderEntries(entries: FileEntry[], hint = ""): string {
  const label =
    entries.length === 1 ? "1 match" : `${String(entries.length)} matches`;
  return panel(
    `Files · ${label}${hint}`,
    entries.length === 0
      ? note("No matching files")
      : entries.map((entry, index) => row(entry, index)).join(""),
  );
}

export type AtMenu = {
  refresh(): void;
  close(): void;
  handleKey(event: KeyboardEvent, completeOnEnter: boolean): boolean;
};

export function setUpAtCompletion(
  endpoints: MenuEndpoints | null,
  owner: ParentNode = document,
  signal?: AbortSignal,
): AtMenu {
  const textarea = () =>
    owner.querySelector<HTMLTextAreaElement>("#composer-text");
  let token: AtQuery | null = null;
  let index: { files: string[]; truncated: boolean; loadedAt: number } | null =
    null;
  let indexInFlight = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let search: AbortController | undefined;
  const indexController = new AbortController();
  signal?.addEventListener(
    "abort",
    () => {
      clearTimeout(timer);
      search?.abort();
      indexController.abort();
      token = null;
      menu.close();
    },
    { once: true },
  );

  const menu: Menu = createMenu(
    "at-menu",
    (item) => {
      const area = textarea();
      const path = item.dataset["path"];
      if (!area || !token || path === undefined) return;
      const insert = buildAtInsertText(
        { path, isDir: item.dataset["dir"] === "1" },
        token.quoted,
      );
      // Completing inside a quoted token swallows the closing quote.
      const caret = area.selectionStart;
      const end = token.quoted && area.value[caret] === '"' ? caret + 1 : caret;
      replaceRange(area, token.start, end, insert.text, insert.caret);
      if (item.dataset["dir"] === "1") refresh();
      else menu.close();
    },
    owner,
    signal,
  );

  function showLocal(query: string): void {
    if (!index) return;
    // A truncated index answers from what it has while the server searches
    // the rest, and pi-web says so in the header.
    const hint = !index.truncated
      ? ""
      : query === ""
        ? " · index truncated"
        : " · searching all files…";
    menu.render(
      renderEntries(
        filterFileEntries(buildEntriesFromFiles(index.files), query),
        hint,
      ),
    );
  }

  async function loadIndex(): Promise<void> {
    if (signal?.aborted || endpoints === null || indexInFlight) return;
    if (index && Date.now() - index.loadedAt < INDEX_TTL_MS) return;
    indexInFlight = true;
    try {
      const response = await fetch(endpoints.index(""), {
        signal: indexController.signal,
      });
      if (!response.ok) return;
      const body = (await response.json()) as {
        files?: string[];
        truncated?: boolean;
      };
      index = {
        files: body.files ?? [],
        truncated: body.truncated ?? false,
        loadedAt: Date.now(),
      };
    } catch {
      // Keep whatever index we had; the menu degrades to server search.
    } finally {
      indexInFlight = false;
    }
  }

  async function serverSearch(query: string, path: boolean): Promise<void> {
    if (signal?.aborted || endpoints === null) return;
    search?.abort();
    const controller = new AbortController();
    search = controller;
    const url = path ? endpoints.completion(query) : endpoints.index(query);
    try {
      const response = await fetch(url, { signal: controller.signal });
      const body = (await response.json()) as { matches?: FileEntry[] };
      if (controller.signal.aborted) return;
      if (signal?.aborted || token?.query !== query) return;
      if (!response.ok) {
        menu.render(panel("Files", note("Cannot list this directory")));
        return;
      }
      menu.render(renderEntries(body.matches ?? []));
    } catch {
      if (!signal?.aborted && !controller.signal.aborted && !path)
        showLocal(query);
    }
  }

  function refresh(): void {
    if (signal?.aborted) return;
    clearTimeout(timer);
    search?.abort();
    const area = textarea();
    if (!area) return;
    token = extractAtQuery(area.value.slice(0, area.selectionStart));
    if (!token || endpoints === null) {
      menu.close();
      return;
    }
    const { query } = token;
    if (timer) clearTimeout(timer);
    if (isFilePathQuery(query)) {
      if (!menu.isOpen()) menu.render(panel("Loading files...", ""));
      timer = setTimeout(
        () => void serverSearch(query, true),
        SEARCH_DEBOUNCE_MS,
      );
      return;
    }
    void loadIndex().then(() => {
      if (signal?.aborted || token?.query !== query) return;
      showLocal(query);
      if (index?.truncated && query !== "") {
        timer = setTimeout(
          () => void serverSearch(query, false),
          SEARCH_DEBOUNCE_MS,
        );
      }
    });
  }

  return {
    refresh,
    close: () => {
      menu.close();
    },
    handleKey(event, completeOnEnter) {
      return handleMenuKey(menu, event, completeOnEnter);
    },
  };
}
