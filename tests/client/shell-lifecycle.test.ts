import { describe, expect, it, vi } from "vitest";
import {
  byId,
  click,
  htmxEvent,
  keydown,
  mount,
  query,
  setRect,
} from "./helpers.ts";

const shell =
  '<main data-session-id="s1" data-cwd="/repo/one">' +
  '<aside id="session-sidebar" class="sidebar-mobile-pending"><div class="sidebar-resize-handle" tabindex="0"></div></aside>' +
  '<button id="sidebar-toggle"></button><div class="sidebar-overlay-backdrop"></div>' +
  '<div id="top-bar"><button data-top-panel="system" aria-pressed="false"></button></div>' +
  '<div id="top-panel" hidden></div>' +
  '<button id="mobile-toolbar-more"><span data-more-closed-icon></span><span data-more-open-icon hidden></span></button>' +
  '<div id="top-bar-tabs"></div></main>';

async function load(): Promise<void> {
  mount(shell);
  const { setUpShell } = await import("@web/client/shell");
  setUpShell();
}

function replaceBody(): void {
  const replacement = document.createElement("body");
  replacement.innerHTML = shell.replace("/repo/one", "/repo/two");
  document.body.replaceWith(replacement);
  htmxEvent(document.body, "htmx:after:process");
  htmxEvent(document.body, "htmx:after:process");
}

describe("shell region replacement", () => {
  it("mounts a fresh drawer, resize handle, toolbar and title without rerunning setup", async () => {
    await load();
    const oldHandle = query(".sidebar-resize-handle");
    const oldMore = byId("mobile-toolbar-more");
    const oldTabs = byId("top-bar-tabs");
    click(byId("sidebar-toggle"));
    click(oldMore);
    replaceBody();
    expect(document.title).toBe("two - web-pi");
    expect(byId("session-sidebar").classList.contains("sidebar-open")).toBe(
      true,
    );
    click(byId("sidebar-toggle"));
    expect(byId("session-sidebar").classList.contains("sidebar-closed")).toBe(
      true,
    );
    click(byId("sidebar-toggle"));
    click(query(".sidebar-overlay-backdrop"));
    expect(byId("session-sidebar").classList.contains("sidebar-closed")).toBe(
      true,
    );
    keydown(oldHandle, "ArrowRight");
    expect(localStorage.getItem("web-pi-sidebar-width")).toBeNull();
    keydown(query(".sidebar-resize-handle"), "ArrowRight");
    expect(localStorage.getItem("web-pi-sidebar-width")).toBe("272");
    click(oldMore);
    expect(oldTabs.hasAttribute("data-open")).toBe(true);
    click(byId("mobile-toolbar-more"));
    expect(byId("top-bar-tabs").hasAttribute("data-open")).toBe(true);
  });

  it("disconnects the old panel observer and listeners before mounting the new panel", async () => {
    const observers: {
      observe: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
    }[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe = vi.fn();
        disconnect = vi.fn();
        constructor() {
          observers.push(this);
        }
      },
    );
    await load();
    const oldHost = byId("top-panel");
    const oldBar = byId("top-bar");
    const oldMeasure = vi.spyOn(oldBar, "getBoundingClientRect");
    click(query("[data-top-panel]"));
    oldMeasure.mockClear();
    htmxEvent(oldHost, "htmx:before:cleanup");
    expect(observers[0]?.disconnect).toHaveBeenCalledOnce();
    replaceBody();
    expect(observers).toHaveLength(2);
    setRect(byId("top-bar"), { bottom: 80, left: 20, width: 500 });
    click(query("[data-top-panel]"));
    expect(byId("top-panel").hidden).toBe(false);
    expect(byId("top-panel").style.top).toBe("80px");
    window.dispatchEvent(new Event("scroll"));
    expect(oldMeasure).not.toHaveBeenCalled();
    keydown(document, "Escape");
    expect(byId("top-panel").hidden).toBe(true);
    expect(oldHost.hidden).toBe(false);
  });

  it("does not measure the bar for a hidden panel on scroll", async () => {
    await load();
    const measure = vi.spyOn(byId("top-bar"), "getBoundingClientRect");
    expect(byId("top-panel").hidden).toBe(true);
    window.dispatchEvent(new Event("scroll"));
    expect(measure).not.toHaveBeenCalled();
    click(query("[data-top-panel]"));
    window.dispatchEvent(new Event("scroll"));
    expect(measure).toHaveBeenCalled();
  });

  it("releases an in-progress drag when its handle is cleaned up", async () => {
    await load();
    const handle = query(".sidebar-resize-handle");
    const release = vi.spyOn(handle, "releasePointerCapture");
    handle.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 7 }));
    htmxEvent(handle, "htmx:before:cleanup");
    expect(release).toHaveBeenCalledWith(7);
    handle.dispatchEvent(
      new PointerEvent("pointermove", { pointerId: 7, clientX: 400 }),
    );
    expect(
      document.documentElement.style.getPropertyValue("--sidebar-width"),
    ).toBe("260px");
    expect(localStorage.getItem("web-pi-sidebar-width")).toBeNull();
  });

  it("keeps replacement drawers closed on phones", async () => {
    window.innerWidth = 500;
    await load();
    click(byId("sidebar-toggle"));
    replaceBody();
    expect(byId("session-sidebar").classList.contains("sidebar-closed")).toBe(
      true,
    );
    expect(
      byId("session-sidebar").classList.contains("sidebar-mobile-pending"),
    ).toBe(false);
  });
});
