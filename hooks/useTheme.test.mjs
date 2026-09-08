import assert from "node:assert/strict";
import test, { after } from "node:test";
import { Window } from "happy-dom";
import { createJiti } from "jiti";

process.env.NODE_ENV = "test";
const window = new Window({ url: "http://localhost", width: 800, height: 600 });
Object.assign(globalThis, {
  window,
  document: window.document,
  IS_REACT_ACT_ENVIRONMENT: true,
});
after(() => window.happyDOM.close());
const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { createRoot } = await jiti.import("react-dom/client");
const { useTheme } = await jiti.import("./useTheme.ts");

test("explicit preferences retain centered transitions, reduced motion, and system synchronization", async () => {
  let dark = false;
  let reducedMotion = false;
  let systemChange;
  window.matchMedia = (query) => ({
    matches: query.includes("prefers-color-scheme") ? dark : reducedMotion,
    addEventListener(_type, listener) {
      systemChange = listener;
    },
  });
  let transitionCount = 0;
  let animation;
  document.startViewTransition = (apply) => {
    transitionCount++;
    apply();
    return { ready: Promise.resolve() };
  };
  document.documentElement.animate = (frames, options) => {
    animation = { frames, options };
  };
  let theme;
  function Probe() {
    theme = useTheme();
    return React.createElement(
      "span",
      null,
      `${theme.preference}:${theme.theme}`,
    );
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await React.act(() => root.render(React.createElement(Probe)));
    assert.equal(container.textContent, "auto:light");
    await React.act(() => theme.setThemePreference("dark"));
    assert.equal(container.textContent, "dark:dark");
    assert.equal(window.localStorage.getItem("pi-theme"), "dark");
    assert.equal(document.documentElement.classList.contains("dark"), true);
    assert.deepEqual(animation.frames.clipPath, [
      "circle(0px at 400px 300px)",
      "circle(500px at 400px 300px)",
    ]);
    assert.equal(
      animation.options.pseudoElement,
      "::view-transition-new(root)",
    );
    reducedMotion = true;
    await React.act(() => theme.setThemePreference("light"));
    assert.equal(container.textContent, "light:light");
    assert.equal(transitionCount, 1);
    dark = true;
    await React.act(() => systemChange());
    assert.equal(container.textContent, "light:light");
    await React.act(() => theme.setThemePreference("auto"));
    assert.equal(container.textContent, "auto:dark");
    dark = false;
    await React.act(() => systemChange());
    assert.equal(container.textContent, "auto:light");
    dark = true;
    await React.act(() => window.dispatchEvent(new window.Event("focus")));
    assert.equal(container.textContent, "auto:dark");
    assert.equal(window.localStorage.getItem("pi-theme"), "auto");
    assert.equal(transitionCount, 1);
  } finally {
    await React.act(() => root.unmount());
    container.remove();
  }
});
