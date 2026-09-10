// An unsent request survives a reload. Text only: attachments are Files, and
// a megabyte of base64 has no business in localStorage.

const PREFIX = "web-pi:draft:";

function read(key: string): string {
  try {
    return localStorage.getItem(PREFIX + key) ?? "";
  } catch {
    return "";
  }
}

function write(key: string, value: string): void {
  try {
    if (value === "") localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, value);
  } catch {
    // Without storage the draft simply lasts for this page only.
  }
}

export type Drafts = {
  save(value: string): void;
  clear(): void;
};

/**
 * A session that does not exist yet is keyed by its folder; the server tells
 * us the real id once the first prompt lands, and the draft moves with it.
 */
export function setUpDrafts(
  sessionId: string | null,
  cwd: string | null,
  area: () => HTMLTextAreaElement | null,
): Drafts {
  let key = sessionId ?? `new:${cwd ?? ""}`;
  const field = area();
  if (field) {
    // A server-rendered draft (a rewind, a fork) outranks the stored one.
    if (field.value.trim() === "") field.value = read(key);
    else write(key, field.value);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;

  document.body.addEventListener("web-pi:session-created", (event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (typeof detail !== "object" || detail === null) return;
    const moved = detail as { cwd?: unknown; id?: unknown };
    if (typeof moved.id !== "string" || `new:${String(moved.cwd)}` !== key) {
      return;
    }
    const pending = read(key);
    write(key, "");
    key = moved.id;
    write(key, pending);
  });

  return {
    save(value) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        write(key, value);
      }, 300);
    },
    clear() {
      if (timer) clearTimeout(timer);
      write(key, "");
    },
  };
}
