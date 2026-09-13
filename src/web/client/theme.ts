// pi-web's theme mechanism, ported from hooks/useTheme.ts: a class on <html>,
// the preference in localStorage under the same key and the same three values,
// and the switch itself drawn as a circular wipe by the View Transitions API.
// The pre-paint script in HtmlLayout reads the same key before the first paint.

export const THEME_KEY = "pi-theme";

export type ThemePreference = "light" | "dark" | "auto";

// Resolved on use, never on import: HtmlLayout imports THEME_KEY from here,
// and that runs on the server.
function darkQuery(): MediaQueryList {
  return matchMedia("(prefers-color-scheme: dark)");
}

export function storedPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_KEY);
    if (value === "light" || value === "dark" || value === "auto") return value;
  } catch {
    // Storage can be blocked; following the system is a fine fallback.
  }
  return "auto";
}

function resolve(preference: ThemePreference): "light" | "dark" {
  if (preference === "auto") return darkQuery().matches ? "dark" : "light";
  return preference;
}

function applyDomTheme(theme: "light" | "dark"): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

/** The wipe: a circle growing from the viewport centre to its far corner. */
function wipe(apply: () => void): void {
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion || typeof document.startViewTransition !== "function") {
    apply();
    return;
  }
  const x = window.innerWidth / 2;
  const y = window.innerHeight / 2;
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  );
  document
    .startViewTransition(apply)
    .ready.then(() => {
      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${String(x)}px ${String(y)}px)`,
            `circle(${String(endRadius)}px at ${String(x)}px ${String(y)}px)`,
          ],
        },
        {
          duration: 450,
          easing: "cubic-bezier(0.22, 0.61, 0.36, 1)",
          pseudoElement: "::view-transition-new(root)",
        },
      );
    })
    .catch(() => {
      // The transition was cancelled; the theme is applied either way.
    });
}

export function setThemePreference(preference: ThemePreference): void {
  if (preference === storedPreference()) return;
  wipe(() => {
    applyDomTheme(resolve(preference));
    try {
      localStorage.setItem(THEME_KEY, preference);
    } catch {
      // Without storage the choice lasts for this page only.
    }
  });
}

/** Marks the option the stored preference names; the server cannot know it. */
function paintOptions(preference: ThemePreference): void {
  for (const button of document.querySelectorAll<HTMLElement>(
    "[data-theme-option]",
  )) {
    button.setAttribute(
      "aria-checked",
      String(button.dataset["themeOption"] === preference),
    );
  }
}

export function setUpTheme(): void {
  applyDomTheme(resolve(storedPreference()));
  // Some browsers delay or miss scheme events while the tab is backgrounded,
  // so "auto" is re-checked whenever the page comes back into view.
  const follow = (): void => {
    if (storedPreference() === "auto") applyDomTheme(resolve("auto"));
  };
  darkQuery().addEventListener("change", follow);
  window.addEventListener("focus", follow);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") follow();
  });
  document.body.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const option = target.closest<HTMLElement>("[data-theme-option]");
    const preference = option?.dataset["themeOption"];
    if (preference === undefined) return;
    setThemePreference(preference as ThemePreference);
    paintOptions(preference as ThemePreference);
  });
  paintOptions(storedPreference());
  // Settings arrives as a fragment, so its radio group is painted on arrival.
  document.body.addEventListener("htmx:after:settle", () => {
    paintOptions(storedPreference());
  });
}
