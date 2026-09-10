import { createFileTree } from "@adapters/fs/file-tree";
import { createWatcher } from "@adapters/fs/watch";
import { createGit } from "@adapters/git/git";
import type { SlashCommand } from "@core/composer";
import type {
  AgentRuntime,
  ExtensionWidget,
  Files,
  Git,
  LiveEvent,
  LiveSession,
  LiveSnapshot,
  LiveStatus,
  ModelCatalog,
  ModelOption,
  ProjectResolver,
  ProjectResources,
  PromptInput,
  QueuedMessage,
  RunningTool,
  RuntimeEvent,
  SessionCatalog,
  ThinkingLevel,
  Watcher,
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

/**
 * What a scripted answer does, step by step. Enough to exercise the parts of
 * the transcript a plain text reply never reaches: reasoning, tool cards,
 * diffs, and subagent results.
 */
export type ScriptedStep =
  | { thinking: string }
  | { text: string }
  /** An extension status; omit `statusText` to clear it. */
  | { status: string; statusText?: string }
  /** An extension widget; omit `lines` to remove it. */
  | {
      widget: string;
      lines?: string[];
      placement?: ExtensionWidget["placement"];
    }
  | {
      tool: string;
      arguments?: unknown;
      /** Lines the tool reports while it runs, one per tick. */
      progress?: string[];
      result?: string;
      isError?: boolean;
      details?: unknown;
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
  images = 0,
): SessionEntry {
  const content =
    images === 0
      ? text
      : [
          { type: "text" as const, text },
          ...Array.from({ length: images }, () => ({
            type: "image" as const,
            // A 1x1 transparent GIF: enough for a thumbnail to render.
            data: "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
            mimeType: "image/gif",
          })),
        ];
  return {
    type: "message",
    id,
    parentId,
    timestamp: new Date().toISOString(),
    message: { role: "user", content, timestamp: Date.now() },
  };
}

export function bashEntry(
  id: string,
  parentId: string | null,
  command: string,
  output: string,
  excludeFromContext: boolean,
): SessionEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: new Date().toISOString(),
    message: {
      role: "bashExecution",
      command,
      output,
      exitCode: 0,
      cancelled: false,
      truncated: false,
      timestamp: Date.now(),
      excludeFromContext,
    },
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

export const FAKE_COMMANDS: SlashCommand[] = [
  { name: "review", description: "Review the diff", source: "extension" },
  { name: "changelog", description: "Draft a changelog", source: "prompt" },
  {
    name: "skill:testing",
    description: "How this repository tests things",
    source: "skill",
    manual: true,
  },
];

type Part = Record<string, unknown> & { type: string };

class FakeLiveSession implements LiveSession {
  readonly id: string;
  private partial: Extract<AgentMessage, { role: "assistant" }> | undefined;
  private turnStart: number;
  private running = false;
  private compacting = false;
  private bashRunning = false;
  private bash: { command: string; output: string } | undefined;
  private queue: QueuedMessage[] = [];
  private compaction: LiveStatus["compaction"] = null;
  private tools: RunningTool[] = [];
  private retry: LiveStatus["retry"] = null;
  private notices: LiveStatus["notices"] = [];
  private statuses = new Map<string, string>();
  private widgets = new Map<string, ExtensionWidget>();
  private thinkingLevel: ThinkingLevel = "medium";
  private readonly listeners = new Set<(event: LiveEvent) => void>();
  private counter = 0;

  private readonly stored: FakeStoredSession;
  private readonly script: (prompt: string) => ScriptedStep[];
  private readonly delayMs: number;
  private readonly onStop: () => void;

  constructor(
    stored: FakeStoredSession,
    script: (prompt: string) => ScriptedStep[],
    delayMs: number,
    onStop: () => void,
  ) {
    this.stored = stored;
    this.script = script;
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
    const notices = this.notices;
    this.notices = [];
    return {
      summary: { ...this.stored.summary, live: true },
      branch,
      entries: [...this.stored.entries],
      turnStart: this.turnStart,
      ...(this.partial ? { partial: this.partial } : {}),
      ...(this.bash ? { bash: { ...this.bash } } : {}),
      status: {
        running: this.running,
        compacting: this.compacting,
        bashRunning: this.bashRunning,
        model: FAKE_MODEL,
        thinkingLevel: this.thinkingLevel,
        thinkingLevels: [
          { level: "off", label: "off" },
          { level: "low", label: "brief" },
          { level: "medium", label: "balanced" },
          { level: "high", label: "thorough" },
        ],
        contextTokens,
        queue: [...this.queue],
        compaction: this.compaction,
        tools: [...this.tools],
        retry: this.retry,
        statuses: Object.fromEntries(this.statuses),
        widgets: [...this.widgets.values()],
        notices,
      },
    };
  }

  private setPartial(content: Part[]): void {
    this.partial = {
      role: "assistant",
      content: content as never,
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
  }

  private wait(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, this.delayMs));
  }

  /** Store the message the partial has become, and start the next one. */
  private settle(parentId: string | null, content: Part[]): string {
    const id = this.nextId();
    const previous = this.snapshot().status.contextTokens ?? 1000;
    this.partial = undefined;
    this.stored.entries.push({
      type: "message",
      id,
      parentId,
      timestamp: new Date().toISOString(),
      message: {
        role: "assistant",
        content: content as never,
        api: "openai-responses",
        provider: FAKE_MODEL.provider,
        model: FAKE_MODEL.id,
        usage: {
          input: previous + 490,
          output: 10,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: previous + 500,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
      },
    });
    this.stored.leafId = id;
    touch(this.stored);
    return id;
  }

  /** Play a scripted answer: reasoning, prose, and tool calls with results. */
  private async play(userId: string, steps: ScriptedStep[]): Promise<void> {
    let parentId = userId;
    let content: Part[] = [];
    await this.wait();
    for (const step of steps) {
      if (!this.running) break;
      if ("status" in step) {
        if (step.statusText === undefined) this.statuses.delete(step.status);
        else this.statuses.set(step.status, step.statusText);
        this.emit({ type: "activity" });
        await this.wait();
        continue;
      }
      if ("widget" in step) {
        if (step.lines === undefined) this.widgets.delete(step.widget);
        else {
          this.widgets.set(step.widget, {
            key: step.widget,
            lines: step.lines,
            placement: step.placement ?? "aboveEditor",
          });
        }
        this.emit({ type: "activity" });
        await this.wait();
        continue;
      }
      if ("thinking" in step) {
        content.push({ type: "thinking", thinking: step.thinking });
        this.setPartial(content);
        await this.wait();
        continue;
      }
      if ("text" in step) {
        const words = step.text.split(" ");
        for (let shown = 1; shown <= words.length; shown += 1) {
          this.setPartial([
            ...content,
            { type: "text", text: words.slice(0, shown).join(" ") },
          ]);
          await this.wait();
          if (!this.running) return;
        }
        content.push({ type: "text", text: step.text });
        continue;
      }
      const callId = `call-${this.nextId()}`;
      content.push({
        type: "toolCall",
        id: callId,
        name: step.tool,
        arguments: step.arguments ?? {},
      });
      this.setPartial(content);
      await this.wait();
      parentId = this.settle(parentId, content);
      content = [];
      for (const line of step.progress ?? []) {
        this.tools = [{ name: step.tool, progress: line }];
        this.emit({ type: "activity" });
        await this.wait();
      }
      this.tools = [];
      const resultId = this.nextId();
      this.stored.entries.push({
        type: "message",
        id: resultId,
        parentId,
        timestamp: new Date().toISOString(),
        message: {
          role: "toolResult",
          toolCallId: callId,
          toolName: step.tool,
          content: [{ type: "text", text: step.result ?? "ok" }],
          ...(step.details === undefined ? {} : { details: step.details }),
          isError: step.isError === true,
          timestamp: Date.now(),
        },
      });
      this.stored.leafId = resultId;
      touch(this.stored);
      parentId = resultId;
      this.emit({ type: "activity" });
    }
    if (content.length > 0) this.settle(parentId, content);
    this.partial = undefined;
    this.tools = [];
    this.running = false;
    this.emit({ type: "turn_done" });
  }

  prompt(text: string, input: PromptInput = {}): Promise<void> {
    if (this.running) {
      this.queue.push({ text, behavior: input.behavior ?? "steer" });
      this.emit({ type: "activity" });
      return Promise.resolve();
    }
    this.running = true;
    this.compaction = null;
    this.turnStart = branchOf(this.stored).length;
    const userId = this.nextId();
    this.append(
      userEntry(userId, leafOf(this.stored), text, input.images?.length ?? 0),
    );
    this.emit({ type: "activity" });
    void this.play(userId, this.script(text));
    return Promise.resolve();
  }

  abort(): Promise<void> {
    this.running = false;
    this.partial = undefined;
    this.tools = [];
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

  commands(): SlashCommand[] {
    return FAKE_COMMANDS;
  }

  compact(instructions?: string): Promise<void> {
    this.compacting = true;
    this.compaction = null;
    this.emit({ type: "activity" });
    setTimeout(() => {
      this.compacting = false;
      this.compaction = {
        tokensBefore: 40_000,
        tokensAfter: 8000,
        reason: instructions ?? "manual",
      };
      this.emit({ type: "activity" });
    }, this.delayMs * 4);
    return Promise.resolve();
  }

  abortCompaction(): void {
    this.compacting = false;
    this.emit({ type: "activity" });
  }

  reload(): Promise<void> {
    this.notices.push({ level: "info", message: "Resources reloaded." });
    this.emit({ type: "activity" });
    return Promise.resolve();
  }

  clearQueue(): QueuedMessage[] {
    const cleared = this.queue;
    this.queue = [];
    this.emit({ type: "activity" });
    return cleared;
  }

  /** Echoes the command back, one chunk at a time, like a real shell run. */
  runBash(command: string, excludeFromContext: boolean): Promise<void> {
    this.bashRunning = true;
    this.turnStart = branchOf(this.stored).length;
    this.bash = { command, output: "" };
    this.emit({ type: "activity" });
    return new Promise((resolve) => {
      let shown = 0;
      const lines = [`${command}: ok`, "done"];
      const tick = () => {
        const line = lines[shown];
        shown += 1;
        if (this.bash && line !== undefined) this.bash.output += `${line}\n`;
        this.emit({ type: "activity" });
        if (shown < lines.length && this.bashRunning) {
          setTimeout(tick, this.delayMs);
          return;
        }
        const output = this.bash?.output ?? "";
        this.bash = undefined;
        this.bashRunning = false;
        this.append(
          bashEntry(
            this.nextId(),
            leafOf(this.stored),
            command,
            output,
            excludeFromContext,
          ),
        );
        this.emit({ type: "turn_done" });
        resolve();
      };
      setTimeout(tick, this.delayMs);
    });
  }

  abortBash(): void {
    this.bashRunning = false;
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
  resources: ProjectResources;
  files: Files;
  git: Git;
  watcher: Watcher;
  tmpdir: string;
  store: Map<string, FakeStoredSession>;
};

export function createFakeWorld(
  options: {
    sessions?: FakeStoredSession[];
    reply?: (prompt: string) => string;
    /** A scripted answer, for turns with reasoning, tools, or subagents. */
    script?: (prompt: string) => ScriptedStep[];
    delayMs?: number;
    files?: string[];
    tmpdir?: string;
  } = {},
): FakeWorld {
  const store = new Map(
    (options.sessions ?? []).map((session) => [session.summary.id, session]),
  );
  const live = new Map<string, FakeLiveSession>();
  const watchers = new Set<(event: RuntimeEvent) => void>();
  const reply = options.reply ?? ((prompt) => `You said: ${prompt}`);
  const script =
    options.script ?? ((prompt: string) => [{ text: reply(prompt) }]);
  const delayMs = options.delayMs ?? 5;
  const realFiles = createFileTree();
  let created = 0;

  function announce(event: RuntimeEvent): void {
    for (const watcher of watchers) watcher(event);
  }

  function open(stored: FakeStoredSession): FakeLiveSession {
    const session = new FakeLiveSession(stored, script, delayMs, () => {
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
    models: {
      list: () => Promise.resolve({ models: [FAKE_MODEL], warnings: [] }),
    },
    projects: {
      resolve: (cwd) => Promise.resolve({ root: cwd, branch: null }),
    },
    resources: {
      commands: () =>
        Promise.resolve(
          FAKE_COMMANDS.filter((command) => command.source !== "extension"),
        ),
    },
    files: {
      index: () =>
        Promise.resolve({
          files: [...(options.files ?? ["src/main.ts", "README.md"])],
          truncated: false,
        }),
      children: (query, cwd) =>
        Promise.resolve(
          (options.files ?? ["src/main.ts", "README.md"])
            .map((file) => ({
              path: `${cwd}/${file}`,
              isDir: false,
            }))
            .filter((entry) => entry.path.includes(query.replace(/^\.\//, ""))),
        ),
      readOutput: () => Promise.resolve("full shell output"),
      // The file system itself is never faked: a viewer or a diff is only
      // worth checking against real bytes in a temporary directory.
      list: (directory) => realFiles.list(directory),
      stat: (path) => realFiles.stat(path),
      realpath: (path) => realFiles.realpath(path),
      readText: (path, maxBytes) => realFiles.readText(path, maxBytes),
      stream: (path, range) => realFiles.stream(path, range),
      docxHtml: (path) => realFiles.docxHtml(path),
    },
    git: createGit(),
    watcher: createWatcher(),
    tmpdir: options.tmpdir ?? "/tmp",
  };
}
