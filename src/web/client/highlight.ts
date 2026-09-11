import { escapeHtml } from "@core/html";
import hljs from "highlight.js/lib/core";
import {
  knownLanguage,
  registerLanguages,
  splitHighlighted,
} from "@web/syntax";

/** A fence's own text, without the line numbers the gutter added to it. */
export function codeText(block: Element | null | undefined): string {
  const code = block?.querySelector("code")?.cloneNode(true);
  if (!(code instanceof HTMLElement)) return "";
  for (const number of code.querySelectorAll(".linenumber")) number.remove();
  return code.textContent ?? "";
}

/**
 * Colour every settled code block and number its lines, as pi-web's
 * `SyntaxHighlighter showLineNumbers` does (§4.5). Blocks in the running turn
 * are left plain: they change on every frame, and tokenising half a line is
 * wasted work. The file viewer is coloured on the server instead, where a
 * whole file can be split into numbered rows.
 */
export function highlightIn(root: ParentNode): void {
  const blocks = root.querySelectorAll<HTMLElement>(
    "pre > code[class*='language-']",
  );
  if (blocks.length === 0) return;
  registerLanguages();
  for (const block of blocks) {
    if (block.dataset["highlighted"] === "1") continue;
    if (block.closest("#turn")) continue;
    const language = /language-([\w+#-]+)/.exec(block.className)?.[1] ?? "";
    block.dataset["highlighted"] = "1";
    const text = block.textContent ?? "";
    const lines =
      language !== "" && knownLanguage(language)
        ? splitHighlighted(
            hljs.highlight(text, { language, ignoreIllegals: true }).value,
          )
        : text.split("\n").map((line) => escapeHtml(line));
    // A trailing newline is a line break, not an extra numbered line.
    if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
    block.innerHTML = lines
      .map(
        (line, index) =>
          `<span class="linenumber">${String(index + 1)}</span>${line}`,
      )
      .join("\n");
  }
}
