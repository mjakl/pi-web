import { translateMessage } from "./i18n/format";

export function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  // navigator.clipboard exists only in secure contexts. A start:lan deployment
  // reached over plain http from another device has none, so fall back to
  // execCommand -- and report what it actually did, so callers do not show
  // "Copied" when the clipboard was left untouched.
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(ta);
    return copied ? Promise.resolve() : Promise.reject(new Error(translateMessage("chat.copyRefused")));
  } catch (error) {
    return Promise.reject(error);
  }
}
