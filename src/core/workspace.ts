import { contextUsage, type ContextUsage } from "./context-usage.ts";
import type {
  AgentRuntime,
  LiveEvent,
  LiveSession,
  LiveStatus,
  ModelCatalog,
  ModelOption,
  SessionCatalog,
  ThinkingLevel,
} from "./ports.ts";
import {
  groupByProject,
  type ProjectGroup,
  type SessionSummary,
} from "./sessions.ts";
import {
  assistantItem,
  projectTranscript,
  type TranscriptItem,
} from "./transcript.ts";

// The application service. Inbound port for every page and partial: the web
// layer renders what this returns and never touches Pi or the file system.

export type SessionView = {
  summary: SessionSummary;
  /** Settled conversation, before the current turn. */
  items: TranscriptItem[];
  /** The current (or just finished) turn, re-rendered while streaming. */
  turn: TranscriptItem[];
  status: LiveStatus | null;
  usage: ContextUsage;
  models: ModelOption[];
};

export type Workspace = ReturnType<typeof createWorkspace>;

export function createWorkspace(deps: {
  sessions: SessionCatalog;
  runtime: AgentRuntime;
  models: ModelCatalog;
}) {
  async function modelsFor(cwd: string): Promise<ModelOption[]> {
    try {
      return await deps.models.list(cwd);
    } catch {
      return [];
    }
  }

  function liveView(live: LiveSession, models: ModelOption[]): SessionView {
    const snapshot = live.snapshot();
    const settled = projectTranscript(
      snapshot.branch.slice(0, snapshot.turnStart),
    );
    const turn = projectTranscript(snapshot.branch.slice(snapshot.turnStart));
    if (snapshot.partial) {
      turn.items.push(assistantItem("partial", snapshot.partial));
    }
    const { status } = snapshot;
    const reported = status.contextTokens;
    const fallback = turn.lastContextTokens ?? settled.lastContextTokens;
    return {
      summary: snapshot.summary,
      items: settled.items,
      turn: turn.items,
      status,
      usage: contextUsage({
        tokens: reported ?? fallback,
        contextWindow: status.model?.contextWindow,
        estimated: reported === null && fallback !== null,
      }),
      models,
    };
  }

  return {
    async listSessions(): Promise<ProjectGroup[]> {
      const sessions = await deps.sessions.list();
      return groupByProject(
        sessions.map((session) => ({
          ...session,
          live: deps.runtime.get(session.id) !== undefined,
        })),
      );
    },

    async viewSession(id: string): Promise<SessionView | undefined> {
      const live = deps.runtime.get(id);
      if (live)
        return liveView(live, await modelsFor(live.snapshot().summary.cwd));
      const stored = await deps.sessions.read(id);
      if (!stored) return undefined;
      const transcript = projectTranscript(stored.branch);
      const models = await modelsFor(stored.summary.cwd);
      const model = transcript.lastModel
        ? models.find(
            (option) =>
              option.provider === transcript.lastModel?.provider &&
              option.id === transcript.lastModel.id,
          )
        : undefined;
      return {
        summary: stored.summary,
        items: transcript.items,
        turn: [],
        status: null,
        usage: contextUsage({
          tokens: transcript.lastContextTokens,
          contextWindow: model?.contextWindow,
        }),
        models,
      };
    },

    /** Start a session in `cwd` and send the first prompt. Returns its id. */
    async startSession(cwd: string, text: string): Promise<string> {
      const live = await deps.runtime.open({ cwd });
      await live.prompt(text);
      return live.id;
    },

    async send(id: string, text: string): Promise<void> {
      const live =
        deps.runtime.get(id) ?? (await deps.runtime.open({ sessionId: id }));
      await live.prompt(text);
    },

    async abort(id: string): Promise<void> {
      await deps.runtime.get(id)?.abort();
    },

    async setModel(
      id: string,
      choice: {
        provider: string;
        modelId: string;
        thinkingLevel?: ThinkingLevel;
      },
    ): Promise<void> {
      const live =
        deps.runtime.get(id) ?? (await deps.runtime.open({ sessionId: id }));
      await live.setModel(choice.provider, choice.modelId);
      if (choice.thinkingLevel) live.setThinkingLevel(choice.thinkingLevel);
    },

    async stop(id: string): Promise<void> {
      await deps.runtime.get(id)?.stop();
    },

    /** Undefined when the session has no runtime; the page then has nothing to stream. */
    subscribe(
      id: string,
      listener: (event: LiveEvent) => void,
    ): (() => void) | undefined {
      return deps.runtime.get(id)?.subscribe(listener);
    },
  };
}
