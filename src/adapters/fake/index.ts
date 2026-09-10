import type {
  AgentRuntime,
  LiveEvent,
  LiveSession,
  LiveSnapshot,
  ModelCatalog,
  ModelOption,
  SessionCatalog,
  ThinkingLevel,
} from "@core/ports";
import type { SessionSummary } from "@core/sessions";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

// In-memory implementations of every outbound port. Tests and the
// `WEB_PI_RUNTIME=fake` demo mode use them; no Pi installation is needed.

export const FAKE_MODEL: ModelOption = {
  provider: "fake",
  id: "fake-1",
  name: "Fake 1",
  contextWindow: 100_000,
  reasoning: true,
};

export type FakeStoredSession = {
  summary: SessionSummary;
  branch: SessionEntry[];
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
    this.turnStart = stored.branch.length;
  }

  private emit(event: LiveEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private nextId(): string {
    this.counter += 1;
    return `${this.id}-e${String(this.counter + this.stored.branch.length)}`;
  }

  snapshot(): LiveSnapshot {
    const last = [...this.stored.branch]
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
      branch: [...this.stored.branch],
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
    this.turnStart = this.stored.branch.length;
    const parent = this.stored.branch.at(-1)?.id ?? null;
    const userId = this.nextId();
    this.stored.branch.push(userEntry(userId, parent, text));
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
      this.stored.branch.push(
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
  const reply = options.reply ?? ((prompt) => `You said: ${prompt}`);
  const delayMs = options.delayMs ?? 5;
  let created = 0;

  function open(stored: FakeStoredSession): FakeLiveSession {
    const session = new FakeLiveSession(stored, reply, delayMs, () =>
      live.delete(stored.summary.id),
    );
    live.set(stored.summary.id, session);
    return session;
  }

  return {
    store,
    sessions: {
      list: () => Promise.resolve([...store.values()].map((s) => s.summary)),
      read: (id) => {
        const stored = store.get(id);
        return Promise.resolve(
          stored
            ? { summary: stored.summary, branch: [...stored.branch] }
            : undefined,
        );
      },
    },
    runtime: {
      get: (id) => live.get(id),
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
          branch: [],
        };
        store.set(stored.summary.id, stored);
        return Promise.resolve(open(stored));
      },
    },
    models: { list: () => Promise.resolve([FAKE_MODEL]) },
  };
}
