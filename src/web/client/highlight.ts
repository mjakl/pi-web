import hljs from "highlight.js/lib/core";
import { knownLanguage, registerLanguages } from "@web/syntax";

/**
 * Colour every settled code block. Blocks in the running turn are left plain:
 * they change on every frame, and tokenising half a line is wasted work. The
 * file viewer is coloured on the server instead, where a whole file can be
 * split into numbered rows.
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
    if (language === "" || language === "mermaid" || !knownLanguage(language)) {
      continue;
    }
    block.dataset["highlighted"] = "1";
    hljs.highlightElement(block);
  }
}
