import {
  type AtQuery,
  buildAtInsertText,
  buildEntriesFromFiles,
  extractAtQuery,
  type FileEntry,
  filterFileEntries,
  isFilePathQuery,
} from "@core/composer";
import { escapeHtml } from "@core/html";
import { type MenuEndpoints, replaceRange, textarea } from "./editor.ts";
import { createMenu, type Menu } from "./menu.ts";

// `@` completion. Plain names are matched against a cached index of the whole
// folder in the browser, so typing costs nothing; only path-like queries
// (`@./`, `@~/`) and a truncated index need the server.

const INDEX_TTL_MS = 10_000;
const SEARCH_DEBOUNCE_MS = 150;

function renderEntries(entries: FileEntry[]): string {
  if (entries.length === 0) {
    return "<div>No files</div>";
  }
  const rows = entries
    .map(
      (entry, index) =>
        `<li><button type="button" role="option" data-index="${String(index)}" data-path="${escapeHtml(entry.path)}" data-dir="${entry.isDir ? "1" : ""}">${escapeHtml(entry.path)}${entry.isDir ? "/" : ""}</button></li>`,
    )
    .join("");
  return `<ul role="listbox">${rows}</ul>`;
}

export type AtMenu = {
  refresh(): void;
  close(): void;
  handleKey(event: KeyboardEvent): boolean;
};

export function setUpAtCompletion(endpoints: MenuEndpoints | null): AtMenu {
  let token: AtQuery | null = null;
  let index: { files: string[]; truncated: boolean; loadedAt: number } | null =
    null;
  let indexInFlight = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let search: AbortController | undefined;

  const menu: Menu = createMenu("at-menu", (item) => {
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
  });

  function showLocal(query: string): void {
    if (!index) return;
    menu.render(
      renderEntries(
        filterFileEntries(buildEntriesFromFiles(index.files), query),
      ),
    );
  }

  async function loadIndex(): Promise<void> {
    if (endpoints === null || indexInFlight) return;
    if (index && Date.now() - index.loadedAt < INDEX_TTL_MS) return;
    indexInFlight = true;
    try {
      const response = await fetch(endpoints.index(""));
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
    if (endpoints === null) return;
    search?.abort();
    const controller = new AbortController();
    search = controller;
    const url = path ? endpoints.completion(query) : endpoints.index(query);
    try {
      const response = await fetch(url, { signal: controller.signal });
      const body = (await response.json()) as { matches?: FileEntry[] };
      if (token?.query !== query) return;
      if (!response.ok) {
        menu.render("<div>Cannot list this directory</div>");
        return;
      }
      menu.render(renderEntries(body.matches ?? []));
    } catch {
      if (!path) showLocal(query);
    }
  }

  function refresh(): void {
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
      timer = setTimeout(
        () => void serverSearch(query, true),
        SEARCH_DEBOUNCE_MS,
      );
      return;
    }
    void loadIndex().then(() => {
      if (token?.query !== query) return;
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
    handleKey(event) {
      if (!menu.isOpen()) return false;
      switch (event.key) {
        case "ArrowDown":
        case "ArrowUp":
          event.preventDefault();
          menu.move(event.key === "ArrowDown" ? 1 : -1);
          return true;
        case "Escape":
          event.preventDefault();
          menu.close();
          return true;
        case "Tab":
          event.preventDefault();
          menu.applyActive();
          return true;
        case "Enter": {
          // Enter completes the highlighted entry; with nothing to complete
          // it falls through and sends, and Shift+Enter is a newline.
          if (event.shiftKey || !menu.applyActive()) return false;
          event.preventDefault();
          return true;
        }
        default:
          return false;
      }
    },
  };
}
