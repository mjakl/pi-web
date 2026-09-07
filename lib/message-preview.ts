import type { UserMessage } from "./types";

/** Plain text only: collapse whitespace and stop once the preview is full. */
export function getMessagePreview(content: UserMessage["content"]): string {
  const blocks =
    typeof content === "string"
      ? [{ type: "text", text: content }]
      : Array.isArray(content)
        ? content
        : [];
  const characters: string[] = [];
  let space = false;
  for (const block of blocks) {
    if (block.type !== "text" || !("text" in block)) continue;
    for (const character of block.text) {
      if (/\s/u.test(character)) {
        space = characters.length > 0;
        continue;
      }
      if (space) characters.push(" ");
      space = false;
      characters.push(character);
      if (characters.length > 100)
        return characters.slice(0, 99).join("") + "…";
    }
    space = characters.length > 0;
  }
  return characters.join("");
}
