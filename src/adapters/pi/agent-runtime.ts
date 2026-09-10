import type {
  AgentRuntime,
  LiveEvent,
  LiveSession,
  LiveSnapshot,
  LiveStatus,
  ModelOption,
  ThinkingLevel,
} from "@core/ports";
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
import { statSync } from "node:fs";
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
  private queued = 0;
  private readonly statuses = new Map<string, string>();
  private notices: LiveStatus["notices"] = [];
  private readonly listeners = new Set<(event: LiveEvent) => void>();
  private readonly unsubscribe: () => void;

  private readonly inner: AgentSession;
  private readonly onStop: () => void;

  constructor(inner: AgentSession, onStop: () => void) {
    this.inner = inner;
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
      case "compaction_start":
        this.compacting = true;
        this.emit({ type: "activity" });
        break;
      case "compaction_end":
        this.compacting = false;
        if (event.errorMessage) {
          this.notices.push({ level: "error", message: event.errorMessage });
        }
        this.emit({ type: "activity" });
        break;
      case "queue_update":
        this.queued = event.steering.length + event.followUp.length;
        this.emit({ type: "activity" });
        break;
      case "agent_settled":
        this.partial = undefined;
        this.emit({ type: "turn_done" });
        break;
      case "agent_start":
      case "agent_end":
      case "entry_appended":
      case "tool_execution_start":
      case "tool_execution_update":
      case "tool_execution_end":
      case "auto_retry_start":
      case "auto_retry_end":
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
    return {
      running: this.inner.isStreaming,
      compacting: this.compacting,
      model: option,
      thinkingLevel: this.inner.thinkingLevel,
      thinkingLevels: this.inner.getAvailableThinkingLevels(),
      contextTokens: this.inner.getContextUsage()?.tokens ?? null,
      queued: this.queued,
      statuses: Object.fromEntries(this.statuses),
      notices,
    };
  }

  snapshot(): LiveSnapshot {
    return {
      summary: this.summary(),
      branch: this.inner.sessionManager.getBranch(),
      turnStart: this.turnStart,
      ...(this.partial ? { partial: this.partial } : {}),
      status: this.status(),
    };
  }

  prompt(text: string): Promise<void> {
    if (!this.inner.isStreaming) {
      this.turnStart = this.inner.sessionManager.getBranch().length;
    }
    // The SDK's prompt() resolves when the whole run ends; the caller only
    // needs to know the prompt was accepted, so settle on preflight instead.
    return new Promise((resolve, reject) => {
      this.inner
        .prompt(text, {
          streamingBehavior: "followUp",
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

export function createPiAgentRuntime(options: {
  agentDir: string;
  catalog: PiSessionCatalog;
}): AgentRuntime {
  const live = new Map<string, PiLiveSession>();
  const starting = new Map<string, Promise<PiLiveSession>>();

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
      },
      ...(trust ? { resourceLoaderReloadOptions: trust } : {}),
    });
    const { session } = await createAgentSessionFromServices({
      services,
      sessionManager: manager,
    });
    const id = session.sessionId;
    const wrapper = new PiLiveSession(session, () => live.delete(id));
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
    return wrapper;
  }

  return {
    get: (sessionId) => live.get(sessionId),
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
