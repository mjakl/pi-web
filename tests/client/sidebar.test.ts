import type { SessionSummary } from "@core/sessions";
import { SessionRow } from "@web/views/Sidebar";
import { describe, expect, it, vi } from "vitest";
import {
  byId,
  click,
  field,
  htmxEvent,
  keydown,
  keyup,
  mount,
  query,
  render,
  setRect,
  type,
} from "./helpers.ts";

// The sidebar's browser half against the rows views/Sidebar.tsx renders:
// unread dots in localStorage, the project filter, the modifier badges and
// digit shortcuts, and where a row's menu lands.

function load() {
  return import("@web/client/sidebar");
}

function summary(
  id: string,
  extra: Partial<SessionSummary> = {},
): SessionSummary {
  return {
    id,
    cwd: "/repo/one",
    createdAt: "2026-09-01T00:00:00.000Z",
    modifiedAt: "2026-09-02T00:00:00.000Z",
    fileSize: 10,
    ...extra,
  };
}

function row(id: string, extra: Partial<SessionSummary> = {}): string {
  return render(
    SessionRow({
      summary: summary(id, extra),
      metadata: {
        firstMessage: `Prompt ${id}`,
        messageCount: 2,
        starCount: 0,
        modifiedAt: "2026-09-02T00:00:00.000Z",
        fileSize: 10,
      },
    }),
  );
}

function page(
  options: { current?: string; rows?: string[]; project?: string } = {},
): void {
  const rows = (options.rows ?? ["s1", "s2"]).map((id) => row(id)).join("");
  mount(
    `<main data-session-id="${options.current ?? ""}"></main>` +
      `<aside id="sidebar">` +
      `<button type="button" class="new-session-shortcut" style="display:none"></button>` +
      `<span class="new-session-plus" style="display:flex">+</span>` +
      `<button type="button" id="project-select" data-project-key="${options.project ?? "/repo/one"}">` +
      `<span id="project-activity" hidden></span></button>` +
      `<div id="sidebar-project-menu"></div>` +
      `<div id="session-list">${rows}</div>` +
      `<div id="session-finished" hidden></div>` +
      `</aside>`,
  );
}

function indicator(id: string): HTMLElement {
  return query(`#row-${id} .session-indicator`);
}

function finished(id: string, project: string): void {
  const target = byId("session-finished");
  target.textContent = JSON.stringify({ id, project });
  htmxEvent(target, "htmx:afterSwap");
}

describe("unread sessions", () => {
  it("marks a session that finished elsewhere and stores it", async () => {
    page({ current: "s1" });
    const { setUpSidebar } = await load();
    setUpSidebar();
    finished("s2", "/repo/one");
    expect(indicator("s2").classList.contains("session-indicator-unread")).toBe(
      true,
    );
    expect(indicator("s2").title).toBe("Session stopped · New activity");
    expect(indicator("s2").style.color).toBe("var(--info)");
    expect(indicator("s1").classList.contains("session-indicator-unread")).toBe(
      false,
    );
    expect(JSON.parse(localStorage.getItem("web-pi:unread") ?? "{}")).toEqual({
      s2: "/repo/one",
    });
  });

  it("never marks the session on screen", async () => {
    page({ current: "s1" });
    const { setUpSidebar } = await load();
    setUpSidebar();
    finished("s1", "/repo/one");
    expect(localStorage.getItem("web-pi:unread")).toBeNull();
  });

  it("clears the mark when the session is opened", async () => {
    localStorage.setItem("web-pi:unread", JSON.stringify({ s1: "/repo/one" }));
    page({ current: "s1" });
    const { setUpSidebar } = await load();
    setUpSidebar();
    expect(JSON.parse(localStorage.getItem("web-pi:unread") ?? "")).toEqual({});
    expect(indicator("s1").classList.contains("session-indicator-unread")).toBe(
      false,
    );
    expect(indicator("s1").style.color).toBe("var(--text-dim)");
  });

  it("reads the old array shape and paints rows that arrive later", async () => {
    localStorage.setItem("web-pi:unread", JSON.stringify(["s2"]));
    page({ current: "" });
    const { setUpSidebar } = await load();
    setUpSidebar();
    expect(indicator("s2").classList.contains("session-indicator-unread")).toBe(
      true,
    );
    byId("session-list").insertAdjacentHTML("beforeend", row("s3"));
    localStorage.setItem("web-pi:unread", JSON.stringify({ s2: "", s3: "" }));
    htmxEvent(byId("row-s3"), "htmx:afterSwap");
    expect(indicator("s3").classList.contains("session-indicator-unread")).toBe(
      true,
    );
  });

  it("lights the project dot for activity in another project", async () => {
    page({ project: "/repo/one" });
    const { setUpSidebar } = await load();
    setUpSidebar();
    finished("elsewhere", "/repo/two");
    expect(byId("project-activity").hidden).toBe(false);
  });

  it("counts unread sessions on the project rows", async () => {
    localStorage.setItem(
      "web-pi:unread",
      JSON.stringify({ a: "/repo/two", b: "/repo/two", c: "/repo/one" }),
    );
    page({ project: "/repo/one" });
    byId("sidebar-project-menu").innerHTML =
      '<div class="project-folder-group" data-project-key="/repo/two">' +
      '<span class="project-activity" style="display:none"><span class="project-unread" style="display:none"><span class="project-unread-count"></span></span></span></div>' +
      '<div class="project-folder-group" data-project-key="/repo/three">' +
      '<span class="project-activity" style="display:none"><span class="project-unread" style="display:none"><span class="project-unread-count"></span></span></span></div>';
    const { setUpSidebar } = await load();
    setUpSidebar();
    const two = query('[data-project-key="/repo/two"]');
    expect(
      two.querySelector<HTMLElement>(".project-unread-count")?.textContent,
    ).toBe("2");
    expect(
      two.querySelector<HTMLElement>(".project-unread")?.style.display,
    ).toBe("inline-flex");
    expect(
      two
        .querySelector<HTMLElement>(".project-unread")
        ?.getAttribute("aria-label"),
    ).toBe("New session activity (2)");
    const three = query('[data-project-key="/repo/three"]');
    expect(
      three.querySelector<HTMLElement>(".project-activity")?.style.display,
    ).toBe("none");
  });
});

describe("the project menu", () => {
  const MENU =
    '<input id="project-filter">' +
    '<div class="project-folder-group" data-project-key="/home/me/alpha"></div>' +
    '<div class="project-folder-group" data-project-key="/home/me/beta"></div>' +
    '<div id="project-empty" hidden>No matching projects</div>';

  it("filters project rows and says when nothing matches", async () => {
    page();
    byId("sidebar-project-menu").innerHTML = MENU;
    const { setUpSidebar } = await load();
    setUpSidebar();
    type(field("#project-filter"), "ALPHA");
    expect(query('[data-project-key="/home/me/alpha"]').hidden).toBe(false);
    expect(query('[data-project-key="/home/me/beta"]').hidden).toBe(true);
    expect(byId("project-empty").hidden).toBe(true);
    type(field("#project-filter"), "zzz");
    expect(byId("project-empty").hidden).toBe(false);
    type(field("#project-filter"), "");
    expect(query('[data-project-key="/home/me/beta"]').hidden).toBe(false);
    expect(byId("project-empty").hidden).toBe(true);
  });

  it("clears the filter and closes the menu on Escape", async () => {
    page();
    byId("sidebar-project-menu").innerHTML = MENU;
    const { setUpSidebar } = await load();
    setUpSidebar();
    const menu = byId("sidebar-project-menu");
    menu.showPopover();
    let closed = false;
    menu.addEventListener("toggle", (event) => {
      closed = (event as unknown as { newState: string }).newState === "closed";
    });
    type(field("#project-filter"), "beta");
    keydown(field("#project-filter"), "Escape");
    expect(field("#project-filter").value).toBe("");
    expect(query('[data-project-key="/home/me/alpha"]').hidden).toBe(false);
    expect(closed).toBe(true);
  });

  it("opens and closes a folder group in place", async () => {
    page();
    byId("sidebar-project-menu").innerHTML =
      '<button type="button" class="project-folder-row" aria-expanded="false" aria-controls="folders-1">alpha</button>' +
      '<div id="folders-1" hidden></div>';
    const { setUpSidebar } = await load();
    setUpSidebar();
    click(query(".project-folder-row"));
    expect(query(".project-folder-row").getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(byId("folders-1").hidden).toBe(false);
    click(query(".project-folder-row"));
    expect(byId("folders-1").hidden).toBe(true);
  });
});

describe("shortcuts", () => {
  it("shows ⌘ badges while Meta is held and Ctrl+ while Ctrl is", async () => {
    page();
    const { setUpSidebar } = await load();
    setUpSidebar();
    keydown(document.body, "Meta", { metaKey: true });
    expect(query("#row-s1 .session-shortcut").textContent).toBe("⌘1");
    expect(query("#row-s2 .session-shortcut").textContent).toBe("⌘2");
    expect(query("#row-s1 .session-shortcut").style.display).toBe("flex");
    expect(query("#row-s1 .session-menu-trigger").style.display).toBe("none");
    expect(query(".new-session-shortcut").textContent).toBe("⌘K");
    expect(query(".new-session-plus").style.display).toBe("none");
    keyup(document.body, "Meta");
    expect(query("#row-s1 .session-shortcut").style.display).toBe("none");
    expect(query("#row-s1 .session-menu-trigger").style.display).toBe("flex");
    keydown(document.body, "Control", { ctrlKey: true });
    expect(query("#row-s1 .session-shortcut").textContent).toBe("Ctrl+1");
    window.dispatchEvent(new Event("blur"));
    expect(query("#row-s1 .session-shortcut").style.display).toBe("none");
  });

  it("numbers a row swapped in while the modifier is held", async () => {
    page();
    const { setUpSidebar } = await load();
    setUpSidebar();
    keydown(document.body, "Meta", { metaKey: true });
    byId("row-s1").outerHTML = row("s1");
    htmxEvent(byId("session-list"), "htmx:afterSwap");
    expect(query("#row-s1 .session-shortcut").textContent).toBe("⌘1");
  });

  it("opens the nth session on Ctrl/Cmd+digit, 0 being the tenth", async () => {
    const ids = Array.from(
      { length: 11 },
      (_, index) => `s${String(index + 1)}`,
    );
    page({ rows: ids });
    const { setUpSidebar } = await load();
    setUpSidebar();
    const opened: string[] = [];
    for (const link of document.querySelectorAll<HTMLAnchorElement>(
      "#session-list a[href]",
    )) {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        opened.push(link.getAttribute("href") ?? "");
      });
    }
    expect(
      keydown(document.body, "2", { ctrlKey: true }).defaultPrevented,
    ).toBe(true);
    keydown(document.body, "0", { metaKey: true });
    keydown(document.body, "3", { ctrlKey: true, shiftKey: true });
    keydown(document.body, "4", { ctrlKey: true, repeat: true });
    keydown(document.body, "5");
    expect(opened).toEqual(["/sessions/s2", "/sessions/s10"]);
  });

  it("opens a row from a click anywhere on it but its controls", async () => {
    page();
    const { setUpSidebar } = await load();
    setUpSidebar();
    let opened = 0;
    query("#row-s1 a[href]").addEventListener("click", (event) => {
      event.preventDefault();
      opened += 1;
    });
    click(query("#row-s1 .session-counts"));
    expect(opened).toBe(1);
    click(query("#row-s1 .session-menu-trigger"));
    expect(opened).toBe(1);
  });
});

describe("row menus and the refresh button", () => {
  it("places the menu under its trigger, flipped up when it would not fit", async () => {
    page();
    const { setUpSidebar } = await load();
    setUpSidebar();
    const trigger = query("#row-s1 .session-menu-trigger");
    const menu = byId("row-menu-s1");
    setRect(trigger, { top: 100, bottom: 130, right: 300 });
    menu.showPopover();
    expect(menu.style.left).toBe("156px");
    expect(menu.style.top).toBe("134px");
    menu.hidePopover();
    // Two items, 34px each plus padding, do not fit under a trigger near the
    // bottom of a 768px window.
    setRect(trigger, { top: 700, bottom: 730, right: 300 });
    menu.showPopover();
    const height = menu.querySelectorAll(".menu-item").length * 34 + 10;
    expect(menu.style.top).toBe(`${String(700 - height - 4)}px`);
  });

  it("shows a check on the refresh button for two seconds", async () => {
    page();
    document.body.insertAdjacentHTML(
      "beforeend",
      '<button type="button" id="sidebar-refresh"></button>',
    );
    const { setUpSidebar } = await load();
    setUpSidebar();
    htmxEvent(byId("sidebar-refresh"), "htmx:afterRequest");
    expect(byId("sidebar-refresh").hasAttribute("data-done")).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(byId("sidebar-refresh").hasAttribute("data-done")).toBe(false);
  });
});

describe("folder memory", () => {
  it("pre-fills the picker with the last validated folder", async () => {
    page();
    document.body.insertAdjacentHTML("beforeend", '<div id="dialogs"></div>');
    const { setUpSidebar } = await load();
    setUpSidebar();
    htmxEvent(document.body, "htmx:configRequest", {
      path: "/workspaces/validate",
      parameters: { cwd: "/home/me/deep/folder" },
    });
    expect(localStorage.getItem("web-pi:last-cwd")).toBe(
      "/home/me/deep/folder",
    );
    byId("dialogs").innerHTML = '<input id="directory-path" value="/home/me">';
    htmxEvent(byId("dialogs"), "htmx:afterSwap");
    expect(field("#directory-path").value).toBe("/home/me/deep/folder");
  });
});
