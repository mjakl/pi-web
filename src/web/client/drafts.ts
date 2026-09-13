// Text survives reloads; attachment bytes stay in the images module's memory.
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
    /* Private storage: the in-memory draft still works. */
  }
}

export function draftKey(sessionId: string | null, cwd: string | null): string {
  return sessionId ?? `new:${cwd ?? ""}`;
}
type Draft = {
  key: string;
  text: string;
  version: number;
  timer?: ReturnType<typeof setTimeout> | undefined;
  changed: Set<() => void>;
};
const drafts = new Map<string, Draft>();
function flush(draft: Draft): void {
  clearTimeout(draft.timer);
  draft.timer = undefined;
  write(draft.key, draft.text);
}
export type Drafts = {
  save(value: string): void;
  clear(version?: number): boolean;
  version(): number;
};

export function setUpDrafts(
  sessionId: string | null,
  cwd: string | null,
  area: () => HTMLTextAreaElement | null,
  signal?: AbortSignal,
): Drafts {
  const key = draftKey(sessionId, cwd);
  const draft = drafts.get(key) ?? {
    key,
    text: read(key),
    version: 0,
    changed: new Set<() => void>(),
  };
  drafts.set(key, draft);
  const field = area();
  if (field) {
    if (
      field.hasAttribute("data-restored-draft") ||
      field.value.trim() !== ""
    ) {
      draft.text = field.value;
      draft.version += 1;
      flush(draft);
    } else field.value = draft.text;
  }
  const changed = () => {
    const field = area();
    if (!field || signal?.aborted || field.value === draft.text) return;
    field.value = draft.text;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  };
  draft.changed.add(changed);
  signal?.addEventListener(
    "abort",
    () => {
      flush(draft);
      draft.changed.delete(changed);
    },
    { once: true },
  );
  addEventListener(
    "pagehide",
    () => {
      flush(draft);
    },
    { signal },
  );
  document.body.addEventListener(
    "web-pi:session-created",
    (event) => {
      const detail = (event as CustomEvent<{ cwd?: string; id?: string }>)
        .detail;
      if (!detail?.id || draft.key !== draftKey(null, detail.cwd ?? null))
        return;
      flush(draft);
      write(draft.key, "");
      drafts.delete(draft.key);
      draft.key = detail.id;
      drafts.set(draft.key, draft);
      flush(draft);
    },
    { signal },
  );
  return {
    save(value) {
      if (signal?.aborted) return;
      if (value !== draft.text) {
        draft.text = value;
        draft.version += 1;
      }
      clearTimeout(draft.timer);
      draft.timer = setTimeout(() => {
        flush(draft);
      }, 300);
    },
    clear(version) {
      if (version !== undefined && version !== draft.version) return false;
      draft.text = "";
      draft.version += 1;
      flush(draft);
      for (const notify of draft.changed) notify();
      return true;
    },
    version: () => draft.version,
  };
}
