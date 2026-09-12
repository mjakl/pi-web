import { describe, expect, it, vi } from "vitest";
import { frame, htmxEvent, mount, setGeometry } from "./helpers.ts";

// The phone keyboard: while a field is focused and the visual viewport is
// shorter than the layout, the app is pinned to what is still visible.

class FakeViewport extends EventTarget {
  height = 768;
  scale = 1;
}

async function load(viewport: FakeViewport | undefined) {
  vi.stubGlobal("visualViewport", viewport);
  mount('<textarea id="field"></textarea><button id="button"></button>');
  setGeometry(document.documentElement, { clientHeight: 768 });
  const { setUpViewport } = await import("@web/client/viewport");
  setUpViewport();
}

const root = () => document.documentElement.style;

describe("the visual viewport", () => {
  it("pins the height while a field is focused under a shorter viewport", async () => {
    const viewport = new FakeViewport();
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    await load(viewport);
    expect(root().getPropertyValue("--app-viewport-height")).toBe("");
    document.getElementById("field")?.focus();
    viewport.height = 400;
    viewport.dispatchEvent(new Event("resize"));
    frame();
    expect(root().getPropertyValue("--app-viewport-height")).toBe("400px");
    expect(root().getPropertyValue("--app-safe-area-bottom")).toBe("0px");
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    // The keyboard goes away: the pin comes off, and the page is scrolled
    // back once, not on every later frame.
    document.getElementById("button")?.focus();
    window.dispatchEvent(new Event("focusout"));
    frame();
    expect(root().getPropertyValue("--app-viewport-height")).toBe("");
    expect(scrollTo).toHaveBeenCalledTimes(2);
    viewport.dispatchEvent(new Event("scroll"));
    frame();
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it("clears a keyboard pin when history removes the focused field without blur", async () => {
    const viewport = new FakeViewport();
    await load(viewport);
    document.getElementById("field")?.focus();
    viewport.height = 400;
    viewport.dispatchEvent(new Event("resize"));
    frame();
    expect(root().getPropertyValue("--app-viewport-height")).toBe("400px");
    const replacement = document.createElement("body");
    replacement.innerHTML =
      '<main><textarea id="replacement"></textarea></main>';
    document.body.replaceWith(replacement);
    htmxEvent(document.body, "htmx:after:process");
    frame();
    expect(root().getPropertyValue("--app-viewport-height")).toBe("");
    document.getElementById("replacement")?.focus();
    viewport.dispatchEvent(new Event("resize"));
    frame();
    expect(root().getPropertyValue("--app-viewport-height")).toBe("400px");
  });

  it("leaves a pinch-zoomed page alone", async () => {
    const viewport = new FakeViewport();
    await load(viewport);
    document.getElementById("field")?.focus();
    viewport.height = 400;
    viewport.scale = 2;
    window.dispatchEvent(new Event("resize"));
    frame();
    expect(root().getPropertyValue("--app-viewport-height")).toBe("");
  });

  it("does nothing in a browser without a visual viewport", async () => {
    await load(undefined);
    window.dispatchEvent(new Event("resize"));
    frame();
    expect(root().getPropertyValue("--app-viewport-height")).toBe("");
  });
});
