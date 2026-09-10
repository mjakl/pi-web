import { Marked } from "marked";

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Model output is untrusted. Raw HTML inside Markdown is shown as text rather
// than sanitised, which needs no allowlist and cannot leak a script.
const renderer = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
  },
});

export function renderMarkdown(source: string): string {
  return renderer.parse(source, { async: false });
}
