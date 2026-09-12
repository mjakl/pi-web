import { slashQuery } from "@core/composer";
import { type MenuEndpoints, replaceRange } from "./editor.ts";
import { createMenu, type Menu } from "./menu.ts";

// Typing `/` opens the command menu. The list and its ranking are rendered by
// the server; the browser owns only which key does what.

const DEBOUNCE_MS = 80;

export type SlashMenu = {
  refresh(): void;
  close(): void;
  handleKey(event: KeyboardEvent): boolean;
};

export function setUpSlashMenu(
  endpoints: MenuEndpoints | null,
  owner: ParentNode = document,
  signal?: AbortSignal,
): SlashMenu {
  const textarea = () =>
    owner.querySelector<HTMLTextAreaElement>("#composer-text");
  const menu: Menu = createMenu(
    "slash-menu",
    (item) => {
      const area = textarea();
      const name = item.dataset["command"];
      if (!area || name === undefined) return;
      replaceRange(area, 0, area.value.length, `/${name} `, name.length + 2);
      menu.close();
    },
    owner,
    signal,
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: AbortController | undefined;

  signal?.addEventListener(
    "abort",
    () => {
      clearTimeout(timer);
      inFlight?.abort();
      menu.close();
    },
    { once: true },
  );

  const load = (query: string): void => {
    if (signal?.aborted || endpoints === null) return;
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;
    fetch(endpoints.commands(query), {
      signal: controller.signal,
    })
      .then((response) => response.text())
      .then((html) => {
        if (
          signal?.aborted ||
          controller.signal.aborted ||
          slashQuery(textarea()?.value ?? "") !== query
        )
          return;
        menu.render(html);
      })
      .catch(() => {
        // A slow or failed lookup just leaves the menu as it was.
      });
  };

  return {
    refresh() {
      if (signal?.aborted) return;
      clearTimeout(timer);
      inFlight?.abort();
      const query = slashQuery(textarea()?.value ?? "");
      if (query === null) {
        menu.close();
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        load(query);
      }, DEBOUNCE_MS);
    },
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
