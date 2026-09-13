// A browser keystroke as the bytes a terminal component expects. Extension
// custom UIs are pi-tui components: they parse VT sequences, not DOM events.
// The client bundle imports this and posts the result; nothing else decodes it.

export type KeyEvent = {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
};

const ESC = "\u001B";
const DEL = "\u007F";

const SPECIAL: Record<string, string> = {
  ArrowUp: `${ESC}[A`,
  ArrowDown: `${ESC}[B`,
  ArrowRight: `${ESC}[C`,
  ArrowLeft: `${ESC}[D`,
  Home: `${ESC}[H`,
  End: `${ESC}[F`,
  Insert: `${ESC}[2~`,
  Delete: `${ESC}[3~`,
  PageUp: `${ESC}[5~`,
  PageDown: `${ESC}[6~`,
  Escape: ESC,
  Backspace: DEL,
};

/** Alt+arrow is word motion in readline, not cursor motion. */
const ALT_ARROW: Record<string, string> = {
  ArrowLeft: `${ESC}b`,
  ArrowRight: `${ESC}f`,
  ArrowUp: `${ESC}p`,
  ArrowDown: `${ESC}n`,
};

function control(key: string): string | null {
  if (key === "?") return DEL;
  if (key.length !== 1) return null;
  const code = key.toUpperCase().codePointAt(0) ?? 0;
  return code >= 64 && code <= 95 ? String.fromCodePoint(code & 0x1f) : null;
}

/**
 * Null means "let the browser have it": Cmd/Meta shortcuts, Ctrl+V, and
 * ordinary typing, which arrives as input rather than as a key event.
 */
export function terminalKeyData(event: KeyEvent): string | null {
  if (event.metaKey) return null;
  if (event.ctrlKey && !event.altKey && event.key.toLowerCase() === "v") {
    return null;
  }
  if (event.ctrlKey && !event.altKey) {
    const sequence = control(event.key);
    if (sequence !== null) return sequence;
  }
  if (event.altKey && !event.ctrlKey) {
    if (event.key === "Backspace") return `${ESC}${DEL}`;
    const arrow = ALT_ARROW[event.key];
    if (arrow !== undefined) return arrow;
    if (event.key.length === 1) return `${ESC}${event.key}`;
  }
  if (event.key === "Enter") return event.shiftKey ? "\n" : "\r";
  if (event.key === "Tab") return event.shiftKey ? `${ESC}[Z` : "\t";
  return SPECIAL[event.key] ?? null;
}

/** Pasted text, wrapped so the component can tell it from typing. */
export function bracketedPaste(text: string): string {
  return `${ESC}[200~${text}${ESC}[201~`;
}
