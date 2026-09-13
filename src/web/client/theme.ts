import type { WebSettings } from "@core/web-settings";

export function storedPreference(): WebSettings["theme"] {
  const value = document.documentElement.dataset["theme"];
  return value === "light" || value === "dark" ? value : "auto";
}

function follow(): void {
  const preference = storedPreference();
  document.documentElement.classList.toggle(
    "dark",
    preference === "dark" ||
      (preference === "auto" &&
        matchMedia("(prefers-color-scheme: dark)").matches),
  );
}

export function setUpTheme(): void {
  follow();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", follow);
  window.addEventListener("focus", follow);
  document.addEventListener("visibilitychange", follow);
  document.addEventListener("web-pi:settings", follow);
}
