// The composer textarea is replaced whole whenever the server hands back a
// new one (queue recall, a rewind); nothing may hold on to the element.

export function textarea(): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>("#composer-text");
}

export function composerForm(): HTMLFormElement | null {
  return document.querySelector<HTMLFormElement>("#composer");
}

/** Replaces `[start, end)` and puts the caret at `start + caret`. */
export function replaceRange(
  area: HTMLTextAreaElement,
  start: number,
  end: number,
  text: string,
  caret: number,
): void {
  area.value = area.value.slice(0, start) + text + area.value.slice(end);
  const position = start + caret;
  area.setSelectionRange(position, position);
  area.focus();
  area.dispatchEvent(new Event("input", { bubbles: true }));
}

export function setComposerValue(
  area: HTMLTextAreaElement,
  value: string,
): void {
  area.value = value;
  area.setSelectionRange(value.length, value.length);
  area.dispatchEvent(new Event("input", { bubbles: true }));
}
