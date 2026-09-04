import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { createJiti } from "jiti";

process.env.NODE_ENV = "test";
const window = new Window({ url: "http://localhost" });
const frames = [];
window.requestAnimationFrame = (callback) => {
  frames.push(callback);
  return frames.length;
};
window.cancelAnimationFrame = () => {};
const viewport = new window.EventTarget();
Object.assign(viewport, { height: 844, scale: 1 });
let innerHeight = 844;
Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
Object.defineProperty(window, "innerHeight", { configurable: true, get: () => innerHeight });
Object.defineProperty(window.document.documentElement, "clientHeight", { configurable: true, value: 844 });
const pageScrolls = [];
let scrollY = 0;
Object.defineProperty(window, "scrollX", { configurable: true, value: 0 });
Object.defineProperty(window, "scrollY", { configurable: true, get: () => scrollY });
window.scrollTo = (x, y) => {
  pageScrolls.push([x, y]);
  scrollY = y;
};
Object.assign(globalThis, {
  window,
  document: window.document,
  HTMLElement: window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
});

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" } });
const React = await jiti.import("react");
const { createRoot } = await jiti.import("react-dom/client");
const { shouldUseVisualViewportHeight, useViewportHeight } = await jiti.import("./useViewportHeight.ts");

function ViewportHeightHarness() {
  useViewportHeight();
  return null;
}

test("tracks the keyboard height without fighting keyboard-open page movement", async () => {
  const textarea = document.createElement("textarea");
  const container = document.createElement("div");
  document.body.append(textarea, container);
  const root = createRoot(container);

  try {
    await React.act(() => root.render(React.createElement(ViewportHeightHarness)));
    await React.act(() => frames.splice(0).forEach((callback) => callback(0)));

    viewport.height = 510;
    innerHeight = 510;
    textarea.focus();
    viewport.dispatchEvent(new window.Event("resize"));
    await React.act(() => frames.splice(0).forEach((callback) => callback(0)));

    assert.equal(document.documentElement.style.getPropertyValue("--app-viewport-height"), "510px");

    scrollY = 40;
    viewport.dispatchEvent(new window.Event("scroll"));
    await React.act(() => frames.splice(0).forEach((callback) => callback(0)));
    assert.deepEqual(pageScrolls, []);

    viewport.height = 844;
    innerHeight = 844;
    textarea.blur();
    await React.act(() => frames.splice(0).forEach((callback) => callback(0)));
    assert.equal(document.documentElement.style.getPropertyValue("--app-viewport-height"), "");
    assert.deepEqual(pageScrolls, [[0, 0]]);
  } finally {
    await React.act(() => root.unmount());
    textarea.remove();
    container.remove();
  }
});

test("uses the visual viewport for a focused editor when the keyboard shrinks it", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    layoutHeight: 844,
    viewportHeight: 510,
    viewportScale: 1,
  }), true);
});

test("does not keep the keyboard height after the visual viewport restores", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    layoutHeight: 844,
    viewportHeight: 844,
    viewportScale: 1,
  }), false);
});

test("restores the dynamic height as soon as the editor loses focus", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: false,
    layoutHeight: 844,
    viewportHeight: 510,
    viewportScale: 1,
  }), false);
});

test("does not mistake pinch zoom for an open keyboard", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    layoutHeight: 844,
    viewportHeight: 422,
    viewportScale: 2,
  }), false);
});

test("keeps the dynamic viewport height when the visual viewport is not reduced", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    layoutHeight: 844,
    viewportHeight: 844,
    viewportScale: 1,
  }), false);
});
