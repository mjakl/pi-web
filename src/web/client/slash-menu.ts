import { slashQuery } from "@core/composer";
import { type MenuEndpoints, replaceRange, textarea } from "./editor.ts";
import { createMenu, type Menu } from "./menu.ts";

// Typing `/` opens the command menu. The list and its ranking are rendered by
// the server; the browser owns only which key does what.

const DEBOUNCE_MS = 80;

export type SlashMenu = {
  refresh(): void;
  close(): void;
  handleKey(event: KeyboardEvent): boolean;
};

export function setUpSlashMenu(endpoints: MenuEndpoints | null): SlashMenu {
  const menu: Menu = createMenu("slash-menu", (item) => {
    const area = textarea();
    const name = item.dataset["command"];
    if (!area || name === undefined) return;
    replaceRange(area, 0, area.value.length, `/${name} `, name.length + 2);
    menu.close();
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: AbortController | undefined;

  const load = (query: string): void => {
    if (endpoints === null) return;
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;
    fetch(endpoints.commands(query), {
      signal: controller.signal,
    })
      .then((response) => response.text())
      .then((html) => {
        if (slashQuery(textarea()?.value ?? "") === null) return;
        menu.render(html);
      })
      .catch(() => {
        // A slow or failed lookup just leaves the menu as it was.
      });
  };

  return {
    refresh() {
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
        default:
          return false;
      }
    },
  };
}
