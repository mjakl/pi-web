import type { SlashCommand } from "@core/composer";
import type {
  AgentRuntime,
  LiveEvent,
  LiveSession,
  LiveSnapshot,
  LiveStatus,
  ModelOption,
  PromptInput,
  QueuedMessage,
  RunningTool,
  RuntimeEvent,
  ThinkingChoice,
  ThinkingLevel,
} from "@core/ports";
import { toolProgress } from "@core/transcript";
import { STAR_TYPE } from "@core/session-entries";
import type { SessionSummary } from "@core/sessions";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  type AgentSession,
  type AgentSessionEvent,
  createAgentSessionFromServices,
  createAgentSessionServices,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { existsSync, statSync } from "node:fs";
import {
  createProjectBashExtension,
  createProjectBashOperations,
  preferUserBashExtension,
} from "./bash-env.ts";
import { createHeadlessUi } from "./headless-ui.ts";
import { projectTrustReloadOptions } from "./project-trust.ts";
import type { PiSessionCatalog } from "./session-catalog.ts";

const RENDER_NOTE =
  "The interface renders Markdown with tables, task lists, links, and fenced code blocks. LaTeX/math typesetting is not supported; use plain text or code for math.";

type Partial = Extract<AgentMessage, { role: "assistant" }>;

class PiLiveSession implements LiveSession {
  readonly id: string;
  private partial: Partial | undefined;
  private turnStart: number;
  private compacting = false;
  private queue: QueuedMessage[] = [];
  private compaction: LiveStatus["compaction"] = null;
  private bash: { command: string; output: string } | undefined;
  private readonly statuses = new Map<string, string>();
  private readonly tools = new Map<string, RunningTool>();
  private retry: LiveStatus["retry"] = null;
  private notices: LiveStatus["notices"] = [];
  private readonly listeners = new Set<(event: LiveEvent) => void>();
  private readonly unsubscribe: () => void;

  private readonly inner: AgentSession;
  private readonly agentDir: string;
  private readonly shellPath: string | undefined;
  private readonly onStop: () => void;

  constructor(
    inner: AgentSession,
    options: { agentDir: string; shellPath?: string },
    onStop: () => void,
  ) {
    this.inner = inner;
    this.agentDir = options.agentDir;
    this.shellPath = options.shellPath;
    this.onStop = onStop;
    this.id = inner.sessionId;
    this.turnStart = inner.sessionManager.getBranch().length;
    this.unsubscribe = inner.subscribe((event) => {
      this.handle(event);
    });
  }

  readonly ui = createHeadlessUi({
    notify: (level, message) => {
      this.notices.push({ level, message });
      this.emit({ type: "activity" });
    },
    setStatus: (key, text) => {
      if (text === undefined) this.statuses.delete(key);
      else this.statuses.set(key, text);
      this.emit({ type: "activity" });
    },
  });

  private handle(event: AgentSessionEvent): void {
    switch (event.type) {
      case "message_start":
      case "message_update":
        if (event.message.role === "assistant") this.partial = event.message;
        this.emit({ type: "activity" });
        break;
      case "message_end":
        this.partial = undefined;
        this.emit({ type: "activity" });
        break;
      case "tool_execution_start":
        this.tools.set(event.toolCallId, { name: event.toolName });
        this.emit({ type: "activity" });
        break;
      case "tool_execution_update": {
        const progress = toolProgress(event.partialResult);
        this.tools.set(event.toolCallId, {
          name: event.toolName,
          ...(progress === undefined ? {} : { progress }),
        });
        this.emit({ type: "activity" });
        break;
      }
      case "tool_execution_end":
        this.tools.delete(event.toolCallId);
        this.emit({ type: "activity" });
        break;
      case "auto_retry_start":
        this.retry = {
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          message: event.errorMessage,
        };
        this.emit({ type: "activity" });
        break;
      case "auto_retry_end":
        this.retry = null;
        this.emit({ type: "activity" });
        break;
      case "compaction_start":
        this.compacting = true;
        this.emit({ type: "activity" });
        break;
      case "compaction_end":
        this.compacting = false;
        if (event.errorMessage) {
          this.notices.push({ level: "error", message: event.errorMessage });
        } else if (event.result && !event.aborted) {
          this.compaction = {
            tokensBefore: event.result.tokensBefore,
            tokensAfter: event.result.estimatedTokensAfter ?? null,
            reason: event.reason,
          };
        }
        this.emit({ type: "activity" });
        break;
      case "queue_update":
        this.queue = [
          ...event.steering.map((text): QueuedMessage => ({
            text,
            behavior: "steer",
          })),
          ...event.followUp.map((text): QueuedMessage => ({
            text,
            behavior: "followUp",
          })),
        ];
        this.emit({ type: "activity" });
        break;
      case "bash_execution_update":
        if (this.bash) this.bash.output += event.delta;
        this.emit({ type: "activity" });
        break;
      case "agent_settled":
        this.partial = undefined;
        this.tools.clear();
        this.retry = null;
        this.emit({ type: "turn_done" });
        break;
      case "agent_start":
      case "agent_end":
      case "entry_appended":
      case "session_info_changed":
      case "thinking_level_changed":
        this.emit({ type: "activity" });
        break;
      default:
        break;
    }
  }

  private emit(event: LiveEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private summary(): SessionSummary {
    const manager = this.inner.sessionManager;
    const file = manager.getSessionFile();
    let modifiedAt = new Date().toISOString();
    let fileSize = 0;
    if (file) {
      try {
        const info = statSync(file);
        modifiedAt = info.mtime.toISOString();
        fileSize = info.size;
      } catch {
        // A brand-new session has no file until Pi flushes it.
      }
    }
    const header = manager.getHeader();
    const name = this.inner.sessionName;
    return {
      id: this.id,
      cwd: manager.getCwd(),
      ...(name ? { name } : {}),
      createdAt: header?.timestamp ?? modifiedAt,
      modifiedAt,
      fileSize,
      live: true,
    };
  }

  private status(): LiveStatus {
    const model = this.inner.model;
    const notices = this.notices;
    this.notices = [];
    const option: ModelOption | null = model
      ? {
          provider: model.provider,
          id: model.id,
          name: model.name,
          contextWindow: model.contextWindow,
          reasoning: model.reasoning,
        }
      : null;
    const labels = model?.thinkingLevelMap;
    return {
      running: this.inner.isStreaming,
      compacting: this.compacting,
      bashRunning: this.inner.isBashRunning,
      model: option,
      thinkingLevel: this.inner.thinkingLevel,
      thinkingLevels: this.inner
        .getAvailableThinkingLevels()
        .map((level): ThinkingChoice => ({
          level,
          label: labels?.[level] ?? level,
        })),
      contextTokens: this.inner.getContextUsage()?.tokens ?? null,
      queue: this.queue,
      compaction: this.compaction,
      tools: [...this.tools.values()],
      retry: this.retry,
      statuses: Object.fromEntries(this.statuses),
      notices,
    };
  }

  snapshot(): LiveSnapshot {
    return {
      summary: this.summary(),
      branch: this.inner.sessionManager.getBranch(),
      entries: this.inner.sessionManager.getEntries(),
      turnStart: this.turnStart,
      ...(this.partial ? { partial: this.partial } : {}),
      ...(this.bash ? { bash: { ...this.bash } } : {}),
      status: this.status(),
    };
  }

  prompt(text: string, input: PromptInput = {}): Promise<void> {
    if (!this.inner.isStreaming) {
      this.turnStart = this.inner.sessionManager.getBranch().length;
      this.compaction = null;
    }
    // The SDK's prompt() resolves when the whole run ends; the caller only
    // needs to know the prompt was accepted, so settle on preflight instead.
    return new Promise((resolve, reject) => {
      this.inner
        .prompt(text, {
          streamingBehavior: input.behavior ?? "steer",
          ...(input.images && input.images.length > 0
            ? {
                images: input.images.map((image) => ({
                  type: "image" as const,
                  data: image.data,
                  mimeType: image.mimeType,
                })),
              }
            : {}),
          preflightResult: (ok) => {
            if (ok) resolve();
          },
        })
        .then(resolve, (error: unknown) => {
          this.notices.push({
            level: "error",
            message: error instanceof Error ? error.message : String(error),
          });
          this.emit({ type: "turn_done" });
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    });
  }

  abort(): Promise<void> {
    return this.inner.abort();
  }

  async setModel(provider: string, modelId: string): Promise<void> {
    const model = this.inner.modelRuntime.getModel(provider, modelId);
    if (!model) throw new Error(`Unknown model ${provider}/${modelId}`);
    await this.inner.setModel(model);
    this.emit({ type: "activity" });
  }

  setThinkingLevel(level: ThinkingLevel): void {
    this.inner.setThinkingLevel(level);
    this.emit({ type: "activity" });
  }

  setName(name: string): void {
    this.inner.setSessionName(name);
    this.emit({ type: "activity" });
  }

  setStar(targetId: string, starred: boolean): void {
    const manager = this.inner.sessionManager;
    const target = manager.getEntry(targetId);
    if (target?.type !== "message" || target.message.role !== "assistant") {
      throw new Error("Star target must be an assistant answer");
    }
    manager.appendCustomEntry(STAR_TYPE, { targetId, starred });
    this.emit({ type: "activity" });
  }

  /** Moves the leaf inside the same file; extensions see `session_before_tree`. */
  async navigateTree(targetId: string): Promise<string | undefined> {
    const result = await this.inner.navigateTree(targetId);
    this.turnStart = this.inner.sessionManager.getBranch().length;
    this.emit({ type: "activity" });
    return result.cancelled ? undefined : result.editorText;
  }

  /**
   * Extension commands, prompt templates, and skills, as the SDK reports them
   * for this session. Skills Pi may not invoke on its own are marked so the
   * menu can say who may run them.
   */
  commands(): SlashCommand[] {
    return [
      ...this.inner.extensionRunner
        .getRegisteredCommands()
        .map((command): SlashCommand => ({
          name: command.invocationName,
          description: command.description ?? "",
          source: "extension",
        })),
      ...this.inner.promptTemplates.map((prompt): SlashCommand => ({
        name: prompt.name,
        description: prompt.description,
        source: "prompt",
      })),
      ...this.inner.resourceLoader
        .getSkills()
        .skills.map((skill): SlashCommand => ({
          name: `skill:${skill.name}`,
          description: skill.description,
          source: "skill",
          ...(skill.disableModelInvocation ? { manual: true } : {}),
        })),
    ];
  }

  async compact(instructions?: string): Promise<void> {
    this.compaction = null;
    await this.inner.compact(instructions);
  }

  abortCompaction(): void {
    this.inner.abortCompaction();
    this.emit({ type: "activity" });
  }

  async reload(): Promise<void> {
    await this.inner.reload();
    this.emit({ type: "activity" });
  }

  clearQueue(): QueuedMessage[] {
    const cleared = this.queue;
    const dropped = this.inner.clearQueue();
    this.queue = [];
    this.emit({ type: "activity" });
    return cleared.length > 0
      ? cleared
      : [
          ...dropped.steering.map((text): QueuedMessage => ({
            text,
            behavior: "steer",
          })),
          ...dropped.followUp.map((text): QueuedMessage => ({
            text,
            behavior: "followUp",
          })),
        ];
  }

  /** `!cmd` in the composer. Output streams through `bash_execution_update`. */
  async runBash(command: string, excludeFromContext: boolean): Promise<void> {
    if (!this.inner.isStreaming) {
      this.turnStart = this.inner.sessionManager.getBranch().length;
    }
    this.bash = { command, output: "" };
    this.emit({ type: "activity" });
    try {
      await this.inner.executeBash(command, undefined, {
        excludeFromContext,
        operations: createProjectBashOperations({
          agentDir: this.agentDir,
          ...(this.shellPath === undefined
            ? {}
            : { shellPath: this.shellPath }),
        }),
      });
    } finally {
      this.bash = undefined;
      this.emit({ type: "turn_done" });
    }
  }

  abortBash(): void {
    this.inner.abortBash();
    this.emit({ type: "activity" });
  }

  /** A session Pi never wrote to disk: an abandoned draft, safe to drop. */
  hasTranscript(): boolean {
    const file = this.inner.sessionManager.getSessionFile();
    return file !== undefined && existsSync(file);
  }

  get busy(): boolean {
    return this.inner.isStreaming || this.inner.isBashRunning;
  }

  subscribe(listener: (event: LiveEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async stop(): Promise<void> {
    this.unsubscribe();
    await this.inner.abort();
    this.inner.dispose();
    this.onStop();
    this.emit({ type: "stopped" });
    this.listeners.clear();
  }
}

/** Abandoned drafts are shut down; a session with a file on disk is not. */
const DRAFT_IDLE_MS = 10 * 60 * 1000;

export function createPiAgentRuntime(options: {
  agentDir: string;
  catalog: PiSessionCatalog;
}): AgentRuntime {
  const live = new Map<string, PiLiveSession>();
  const starting = new Map<string, Promise<PiLiveSession>>();
  const watchers = new Set<(event: RuntimeEvent) => void>();

  function announce(event: RuntimeEvent): void {
    for (const watcher of watchers) watcher(event);
  }

  async function start(manager: SessionManager): Promise<PiLiveSession> {
    const cwd = manager.getCwd();
    const settingsManager = SettingsManager.create(cwd, options.agentDir);
    const trust = projectTrustReloadOptions(cwd, options.agentDir);
    const services = await createAgentSessionServices({
      cwd,
      agentDir: options.agentDir,
      settingsManager,
      resourceLoaderOptions: {
        appendSystemPromptOverride: (base) => [...base, RENDER_NOTE],
        extensionFactories: [
          createProjectBashExtension({
            cwd,
            agentDir: options.agentDir,
            settings: settingsManager,
          }),
        ],
        extensionsOverride: preferUserBashExtension,
      },
      ...(trust ? { resourceLoaderReloadOptions: trust } : {}),
    });
    const { session } = await createAgentSessionFromServices({
      services,
      sessionManager: manager,
    });
    const id = session.sessionId;
    const shellPath = settingsManager.getShellPath();
    const wrapper = new PiLiveSession(
      session,
      {
        agentDir: options.agentDir,
        ...(shellPath === undefined ? {} : { shellPath }),
      },
      () => {
        live.delete(id);
        announce({ type: "stopped", sessionId: id });
      },
    );
    let idle: ReturnType<typeof setTimeout> | undefined;
    const resetIdle = () => {
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => {
        if (!wrapper.hasTranscript() && !wrapper.busy) void wrapper.stop();
        else resetIdle();
      }, DRAFT_IDLE_MS).unref();
    };
    wrapper.subscribe((event) => {
      if (event.type === "turn_done") {
        announce({ type: "finished", sessionId: id });
      }
      if (event.type === "stopped") {
        if (idle) clearTimeout(idle);
      } else resetIdle();
    });
    resetIdle();
    await session.bindExtensions({
      uiContext: wrapper.ui,
      mode: "rpc",
      onError: (error) => {
        wrapper.ui.notify(`${error.extensionPath}: ${error.error}`, "error");
      },
    });
    const file = manager.getSessionFile();
    if (file) options.catalog.remember(id, file);
    live.set(id, wrapper);
    announce({ type: "opened", sessionId: id });
    return wrapper;
  }

  return {
    get: (sessionId) => live.get(sessionId),
    subscribeAll(listener) {
      watchers.add(listener);
      return () => watchers.delete(listener);
    },
    async open(target) {
      if ("cwd" in target) {
        return start(SessionManager.create(target.cwd));
      }
      const existing = live.get(target.sessionId);
      if (existing) return existing;
      const inflight = starting.get(target.sessionId);
      if (inflight) return inflight;
      const filePath = await options.catalog.pathOf(target.sessionId);
      if (!filePath) throw new Error(`Unknown session ${target.sessionId}`);
      const promise = start(SessionManager.open(filePath)).finally(() => {
        starting.delete(target.sessionId);
      });
      starting.set(target.sessionId, promise);
      return promise;
    },
  };
}
