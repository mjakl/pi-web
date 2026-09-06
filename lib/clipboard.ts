import { translateMessage } from "./i18n/format";

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  // navigator.clipboard exists only in secure contexts. A start:lan deployment
  // reached over plain http from another device has none, so fall back to
  // execCommand -- and report what it actually did, so callers do not show
  // "Copied" when the clipboard was left untouched.
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  try {
    ta.select();
    // Plain-HTTP LAN deployments have no Clipboard API; retain this fallback.
    // oxlint-disable-next-line typescript/no-deprecated
    const copied = document.execCommand("copy");
    if (!copied) throw new Error(translateMessage("chat.copyRefused"));
  } finally {
    document.body.removeChild(ta);
  }
}
