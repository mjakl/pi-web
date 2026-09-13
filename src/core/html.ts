// The one HTML escaper. Server views, the ANSI converter, and the client
// bundle all build markup from untrusted text; escaping it in three slightly
// different ways is how one of them ends up missing an entity.

/** Text safe in element content and in a double- or single-quoted attribute. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
