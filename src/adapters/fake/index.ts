import type {
  AgentRuntime,
  LiveEvent,
  LiveSession,
  LiveSnapshot,
  ModelCatalog,
  ModelOption,
  ProjectResolver,
  RuntimeEvent,
  SessionCatalog,
  ThinkingLevel,
} from "@core/ports";
import {
  readStars,
  rowMetadata,
  STAR_TYPE,
  userMessageText,
} from "@core/session-entries";
import type { SessionSummary } from "@core/sessions";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

// In-memory implementations of every outbound port. Tests and the
// `WEB_PI_RUNTIME=fake` demo mode use them; no Pi installation is needed.
// Sessions are entry trees here too, so branching and forking behave as they
// do against Pi.

export const FAKE_MODEL: ModelOption = {
  provider: "fake",
  id: "fake-1",
  name: "Fake 1",
  contextWindow: 100_000,
  reasoning: true,
};

export type FakeStoredSession = {
  summary: SessionSummary;
  entries: SessionEntry[];
  leafId?: string | null;
};

export function userEntry(
  id: string,
  parentId: string | null,
  text: string,
): SessionEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: new Date().toISOString(),
    message: { role: "user", content: text, timestamp: Date.now() },
  };
}

export function assistantEntry(
  id: string,
  parentId: string | null,
  text: string,
  contextTokens: number,
): SessionEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: new Date().toISOString(),
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      api: "openai-responses",
      provider: FAKE_MODEL.provider,
      model: FAKE_MODEL.id,
      usage: {
        input: contextTokens - 10,
        output: 10,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: contextTokens,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    },
  };
}

function leafOf(stored: FakeStoredSession): string | null {
  return stored.leafId ?? stored.entries.at(-1)?.id ?? null;
}

/** Root-first path to `leafId`, the way SessionManager.getBranch walks it. */
function branchOf(stored: FakeStoredSession, leafId?: string): SessionEntry[] {
  const byId = new Map(stored.entries.map((entry) => [entry.id, entry]));
  const path: SessionEntry[] = [];
  let current = byId.get(leafId ?? leafOf(stored) ?? "");
  while (current) {
    path.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path.reverse();
}

function touch(stored: FakeStoredSession): void {
  stored.summary = {
    ...stored.summary,
    modifiedAt: new Date().toISOString(),
    fileSize: stored.entries.length,
  };
}

/** Stars only ever mark an assistant answer, as in the Pi adapter. */
function assertAnswer(stored: FakeStoredSession, targetId: string): void {
  const target = stored.entries.find((entry) => entry.id === targetId);
  if (target?.type !== "message" || target.message.role !== "assistant") {
    throw new Error("Star target must be an assistant answer");
  }
}

function starEntry(
  id: string,
  parentId: string | null,
  targetId: string,
  starred: boolean,
): SessionEntry {
  return {
    type: "custom",
    customType: STAR_TYPE,
    data: { targetId, starred },
    id,
    parentId,
    timestamp: new Date().toISOString(),
  };
}

class FakeLiveSession implements LiveSession {
  readonly id: string;
  private partial: Extract<AgentMessage, { role: "assistant" }> | undefined;
  private turnStart: number;
  private running = false;
  private thinkingLevel: ThinkingLevel = "medium";
  private readonly listeners = new Set<(event: LiveEvent) => void>();
  private counter = 0;

  private readonly stored: FakeStoredSession;
  private readonly reply: (prompt: string) => string;
  private readonly delayMs: number;
  private readonly onStop: () => void;

  constructor(
    stored: FakeStoredSession,
    reply: (prompt: string) => string,
    delayMs: number,
    onStop: () => void,
  ) {
    this.stored = stored;
    this.reply = reply;
    this.delayMs = delayMs;
    this.onStop = onStop;
    this.id = stored.summary.id;
    this.turnStart = branchOf(stored).length;
  }

  private emit(event: LiveEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private nextId(): string {
    this.counter += 1;
    return `${this.id}-e${String(this.counter + this.stored.entries.length)}`;
  }

  private append(entry: SessionEntry): void {
    this.stored.entries.push(entry);
    this.stored.leafId = entry.id;
    touch(this.stored);
  }

  snapshot(): LiveSnapshot {
    const branch = branchOf(this.stored);
    const last = [...branch]
      .reverse()
      .find(
        (entry) =>
          entry.type === "message" && entry.message.role === "assistant",
      );
    const contextTokens =
      last?.type === "message" && last.message.role === "assistant"
        ? last.message.usage.totalTokens
        : null;
    return {
      summary: { ...this.stored.summary, live: true },
      branch,
      entries: [...this.stored.entries],
      turnStart: this.turnStart,
      ...(this.partial ? { partial: this.partial } : {}),
      status: {
        running: this.running,
        compacting: false,
        model: FAKE_MODEL,
        thinkingLevel: this.thinkingLevel,
        thinkingLevels: ["off", "low", "medium", "high"],
        contextTokens,
        queued: 0,
        statuses: {},
        notices: [],
      },
    };
  }

  prompt(text: string): Promise<void> {
    if (this.running)
      throw new Error("Fake runtime accepts one prompt at a time");
    this.running = true;
    this.turnStart = branchOf(this.stored).length;
    const userId = this.nextId();
    this.append(userEntry(userId, leafOf(this.stored), text));
    this.emit({ type: "activity" });

    const answer = this.reply(text);
    const words = answer.split(" ");
    let shown = 0;
    const tick = () => {
      shown += 1;
      const textSoFar = words.slice(0, shown).join(" ");
      this.partial = {
        role: "assistant",
        content: [{ type: "text", text: textSoFar }],
        api: "openai-responses",
        provider: FAKE_MODEL.provider,
        model: FAKE_MODEL.id,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "pending",
        timestamp: Date.now(),
      };
      this.emit({ type: "activity" });
      if (shown < words.length) {
        setTimeout(tick, this.delayMs);
        return;
      }
      this.partial = undefined;
      const previousTokens = this.snapshot().status.contextTokens ?? 1000;
      this.append(
        assistantEntry(this.nextId(), userId, answer, previousTokens + 500),
      );
      this.running = false;
      this.emit({ type: "turn_done" });
    };
    setTimeout(tick, this.delayMs);
    return Promise.resolve();
  }

  abort(): Promise<void> {
    this.running = false;
    this.partial = undefined;
    this.emit({ type: "turn_done" });
    return Promise.resolve();
  }

  setModel(): Promise<void> {
    return Promise.resolve();
  }

  setThinkingLevel(level: ThinkingLevel): void {
    this.thinkingLevel = level;
    this.emit({ type: "activity" });
  }

  setName(name: string): void {
    this.stored.summary = { ...this.stored.summary, name };
    this.emit({ type: "activity" });
  }

  setStar(targetId: string, starred: boolean): void {
    assertAnswer(this.stored, targetId);
    this.append(
      starEntry(this.nextId(), leafOf(this.stored), targetId, starred),
    );
    this.emit({ type: "activity" });
  }

  navigateTree(targetId: string): Promise<string | undefined> {
    const entry = this.stored.entries.find((item) => item.id === targetId);
    if (!entry) throw new Error("Select an existing conversation message");
    this.stored.leafId = targetId;
    this.turnStart = branchOf(this.stored).length;
    this.emit({ type: "activity" });
    return Promise.resolve(userMessageText(entry));
  }

  subscribe(listener: (event: LiveEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  stop(): Promise<void> {
    this.onStop();
    this.emit({ type: "stopped" });
    this.listeners.clear();
    return Promise.resolve();
  }
}

export type FakeWorld = {
  sessions: SessionCatalog;
  runtime: AgentRuntime;
  models: ModelCatalog;
  projects: ProjectResolver;
  store: Map<string, FakeStoredSession>;
};

export function createFakeWorld(
  options: {
    sessions?: FakeStoredSession[];
    reply?: (prompt: string) => string;
    delayMs?: number;
  } = {},
): FakeWorld {
  const store = new Map(
    (options.sessions ?? []).map((session) => [session.summary.id, session]),
  );
  const live = new Map<string, FakeLiveSession>();
  const watchers = new Set<(event: RuntimeEvent) => void>();
  const reply = options.reply ?? ((prompt) => `You said: ${prompt}`);
  const delayMs = options.delayMs ?? 5;
  let created = 0;

  function announce(event: RuntimeEvent): void {
    for (const watcher of watchers) watcher(event);
  }

  function open(stored: FakeStoredSession): FakeLiveSession {
    const session = new FakeLiveSession(stored, reply, delayMs, () => {
      live.delete(stored.summary.id);
      announce({ type: "stopped", sessionId: stored.summary.id });
    });
    session.subscribe((event) => {
      if (event.type === "turn_done") {
        announce({ type: "finished", sessionId: stored.summary.id });
      }
    });
    live.set(stored.summary.id, session);
    announce({ type: "opened", sessionId: stored.summary.id });
    return session;
  }

  function need(id: string): FakeStoredSession {
    const stored = store.get(id);
    if (!stored) throw new Error("Session not found");
    return stored;
  }

  function copyBranch(id: string, leafId: string): string {
    const stored = need(id);
    created += 1;
    const newId = `copy-${String(created)}`;
    const now = new Date().toISOString();
    const entries = branchOf(stored, leafId);
    store.set(newId, {
      summary: {
        ...stored.summary,
        id: newId,
        createdAt: now,
        modifiedAt: now,
        fileSize: entries.length,
      },
      entries: entries.map((entry) => ({ ...entry })),
      leafId,
    });
    return newId;
  }

  return {
    store,
    sessions: {
      list: () => Promise.resolve([...store.values()].map((s) => s.summary)),
      read: (id, leafId) => {
        const stored = store.get(id);
        return Promise.resolve(
          stored
            ? {
                summary: stored.summary,
                branch: branchOf(stored, leafId),
                entries: [...stored.entries],
                leafId: leafOf(stored),
              }
            : undefined,
        );
      },
      rowMetadata: (id) => {
        const stored = store.get(id);
        return Promise.resolve(
          stored
            ? {
                summary: stored.summary,
                metadata: rowMetadata(stored.entries, {
                  modifiedAt: stored.summary.modifiedAt,
                  fileSize: stored.summary.fileSize,
                }),
              }
            : undefined,
        );
      },
      rename: (id, name) => {
        const stored = need(id);
        stored.summary = { ...stored.summary, name };
        return Promise.resolve();
      },
      remove: (id) => {
        need(id);
        store.delete(id);
        return Promise.resolve();
      },
      setStar: (id, targetId, starred) => {
        const stored = need(id);
        assertAnswer(stored, targetId);
        stored.entries.push(
          starEntry(
            `${id}-star${String(stored.entries.length)}`,
            leafOf(stored),
            targetId,
            starred,
          ),
        );
        touch(stored);
        return Promise.resolve();
      },
      fork: (id, entryId) => {
        const stored = need(id);
        const entry = stored.entries.find((item) => item.id === entryId);
        if (!entry) throw new Error("Select an existing conversation message");
        const text = userMessageText(entry) ?? "";
        const leafId = text ? entry.parentId : entry.id;
        if (leafId === null) {
          throw new Error(
            "Nothing precedes the first message; use New for an empty session.",
          );
        }
        return Promise.resolve({ id: copyBranch(id, leafId), text });
      },
      clone: (id, leafId) => {
        const stored = need(id);
        const leaf = leafId ?? leafOf(stored);
        if (leaf === null) throw new Error("Cannot clone an empty session");
        return Promise.resolve(copyBranch(id, leaf));
      },
      rewind: (id, entryId) => {
        const stored = need(id);
        const index = stored.entries.findIndex((item) => item.id === entryId);
        const target = stored.entries[index];
        const text = target && userMessageText(target);
        if (!target || !text) {
          throw new Error("Rewind requires an existing user message");
        }
        stored.entries = stored.entries.slice(0, index);
        stored.leafId = target.parentId;
        touch(stored);
        return Promise.resolve(text);
      },
      exportHtml: (id) => {
        const stored = need(id);
        const starred = readStars(stored.entries).size;
        return Promise.resolve({
          html: `<!doctype html><title>${id}</title><p>${String(stored.entries.length)} entries, ${String(starred)} starred`,
          filename: `pi-session-${id}.html`,
        });
      },
    },
    runtime: {
      get: (id) => live.get(id),
      subscribeAll(listener) {
        watchers.add(listener);
        return () => watchers.delete(listener);
      },
      open(target) {
        if ("sessionId" in target) {
          const existing = live.get(target.sessionId);
          if (existing) return Promise.resolve(existing);
          const stored = store.get(target.sessionId);
          if (!stored)
            return Promise.reject(
              new Error(`Unknown session ${target.sessionId}`),
            );
          return Promise.resolve(open(stored));
        }
        created += 1;
        const now = new Date().toISOString();
        const stored: FakeStoredSession = {
          summary: {
            id: `new-${String(created)}`,
            cwd: target.cwd,
            createdAt: now,
            modifiedAt: now,
            fileSize: 0,
          },
          entries: [],
          leafId: null,
        };
        store.set(stored.summary.id, stored);
        return Promise.resolve(open(stored));
      },
    },
    models: { list: () => Promise.resolve([FAKE_MODEL]) },
    projects: {
      resolve: (cwd) => Promise.resolve({ root: cwd, branch: null }),
    },
  };
}
