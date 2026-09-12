import { BUILTIN_COMMANDS, rankCommands } from "@core/composer";
import { CommandMenu, Composer } from "@web/views/Composer";
import { describe, expect, it, vi } from "vitest";
import {
  area,
  byId,
  flush,
  json,
  keydown,
  mockFetch,
  mount,
  render,
  text,
  type,
} from "./helpers.ts";

type MenuKind = "slash" | "at" | "builtin";

async function setup(menu: MenuKind, width: number) {
  window.innerWidth = width;
  mockFetch((url) => {
    if (url.includes("/commands")) {
      const query = new URL(url, "http://x").searchParams.get("q") ?? "";
      return text(
        render(
          CommandMenu({
            commands: rankCommands(BUILTIN_COMMANDS, query),
            query,
          }),
        ),
      );
    }
    return json({ files: ["file.ts", "file2.ts"] });
  });
  mount(
    `<main data-session-id="s1"><div id="toasts"></div>${render(Composer({ sessionId: "s1", cwd: "/repo" }))}</main>`,
  );
  const submits = vi.fn((event: Event) => {
    event.preventDefault();
  });
  byId("composer").addEventListener("submit", submits);
  const { setUpComposer } = await import("@web/client/composer");
  setUpComposer();
  area().focus();
  const initial =
    menu === "at" ? "look @fi" : menu === "builtin" ? "/compact" : "/co";
  type(area(), initial);
  await vi.advanceTimersByTimeAsync(80);
  await flush();
  const menuElement = byId(menu === "at" ? "at-menu" : "slash-menu");
  expect(menuElement.hidden).toBe(false);
  return { submits, initial, menuElement };
}

const keys: {
  name: string;
  key: string;
  init: KeyboardEventInit;
  sends: boolean | "desktop";
}[] = [
  { name: "plain Enter", key: "Enter", init: {}, sends: "desktop" },
  { name: "Shift+Enter", key: "Enter", init: { shiftKey: true }, sends: false },
  { name: "Ctrl+Enter", key: "Enter", init: { ctrlKey: true }, sends: true },
  { name: "Meta+Enter", key: "Enter", init: { metaKey: true }, sends: true },
  { name: "Alt+Enter", key: "Enter", init: { altKey: true }, sends: true },
  {
    name: "Ctrl+Shift+Enter",
    key: "Enter",
    init: { ctrlKey: true, shiftKey: true },
    sends: false,
  },
  {
    name: "Meta+Shift+Enter",
    key: "Enter",
    init: { metaKey: true, shiftKey: true },
    sends: false,
  },
  {
    name: "Alt+Shift+Enter",
    key: "Enter",
    init: { altKey: true, shiftKey: true },
    sends: false,
  },
  { name: "Tab", key: "Tab", init: {}, sends: false },
];

for (const menu of ["slash", "at", "builtin"] as const) {
  describe(`${menu} keyboard dispatch`, () => {
    for (const width of [641, 640, 390]) {
      it.each(keys)(
        `at ${String(width)}px, $name follows the composer policy`,
        async ({ key, init, sends }) => {
          const { submits, initial, menuElement } = await setup(menu, width);
          const send = sends === "desktop" ? width > 640 : sends;
          const complete = key === "Tab" || (send && menu !== "builtin");
          const event = keydown(area(), key, init);
          expect(event.defaultPrevented).toBe(send || complete);
          expect(submits).toHaveBeenCalledTimes(
            send && menu === "builtin" ? 1 : 0,
          );
          expect(area().value).toBe(
            complete
              ? menu === "at"
                ? "look @file.ts "
                : "/compact "
              : initial,
          );
          expect(menuElement.hidden).toBe(send || complete);
          expect(document.activeElement).toBe(area());
          // happy-dom does not insert native newlines; Chromium covers that default.
        },
      );
    }

    for (const width of [641, 640]) {
      it.each(["composition flag", "isComposing", "keyCode 229"])(
        `at ${String(width)}px, ignores %s before completing or submitting`,
        async (mode) => {
          const { submits, initial, menuElement } = await setup(menu, width);
          if (mode === "composition flag")
            area().dispatchEvent(
              new Event("compositionstart", { bubbles: true }),
            );
          const event = new KeyboardEvent("keydown", {
            key: "Enter",
            ctrlKey: true,
            isComposing: mode === "isComposing",
            bubbles: true,
            cancelable: true,
          });
          if (mode === "keyCode 229")
            Object.defineProperty(event, "keyCode", { value: 229 });
          area().dispatchEvent(event);
          expect(event.defaultPrevented).toBe(false);
          expect(area().value).toBe(initial);
          expect(menuElement.hidden).toBe(false);
          expect(submits).not.toHaveBeenCalled();
        },
      );

      it.each([0, 99, 100, 101])(
        `at ${String(width)}px, applies the exact 100ms composition grace at %ims`,
        async (elapsed) => {
          const { submits, initial, menuElement } = await setup(menu, width);
          area().dispatchEvent(new Event("compositionend", { bubbles: true }));
          vi.advanceTimersByTime(elapsed);
          const event = keydown(area(), "Enter", { ctrlKey: true });
          expect(event.defaultPrevented).toBe(true);
          const active = elapsed >= 100;
          expect(submits).toHaveBeenCalledTimes(
            active && menu === "builtin" ? 1 : 0,
          );
          expect(area().value).toBe(
            active && menu !== "builtin"
              ? menu === "at"
                ? "look @file.ts "
                : "/compact "
              : initial,
          );
          expect(menuElement.hidden).toBe(active);
        },
      );
    }

    it("keeps arrows, Escape and Tab focused on the open menu", async () => {
      const { submits, menuElement } = await setup(menu, 640);
      expect(keydown(area(), "ArrowDown").defaultPrevented).toBe(true);
      expect(keydown(area(), "ArrowUp").defaultPrevented).toBe(true);
      expect(
        menuElement
          .querySelector('[data-index="0"]')
          ?.getAttribute("data-active"),
      ).toBe("true");
      expect(keydown(area(), "Escape").defaultPrevented).toBe(true);
      expect(menuElement.hidden).toBe(true);
      expect(submits).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(area());
    });
  });
}
