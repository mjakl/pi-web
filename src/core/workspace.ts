import { contextUsage, type ContextUsage } from "./context-usage.ts";
import type {
  AgentRuntime,
  LiveEvent,
  LiveSession,
  LiveStatus,
  ModelCatalog,
  ModelOption,
  ProjectResolver,
  RuntimeEvent,
  SessionCatalog,
  SessionRead,
  ThinkingLevel,
} from "./ports.ts";
import {
  type BranchLeaf,
  branchLeaves,
  readStars,
  sessionStats,
  type SessionStats,
} from "./session-entries.ts";
import {
  groupByProject,
  type ProjectGroup,
  type SessionRowMetadata,
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
  /** Entry ids of starred answers. */
  starred: Set<string>;
  /** Tips of every branch in the session; one entry when nothing branched. */
  leaves: BranchLeaf[];
  /** True while viewing a branch other than the session's own leaf. */
  otherBranch: boolean;
};

export type Workspace = ReturnType<typeof createWorkspace>;

export function createWorkspace(deps: {
  sessions: SessionCatalog;
  runtime: AgentRuntime;
  models: ModelCatalog;
  projects: ProjectResolver;
}) {
  async function modelsFor(cwd: string): Promise<ModelOption[]> {
    try {
      return await deps.models.list(cwd);
    } catch {
      return [];
    }
  }

  /** Runtime state plus the project a session's folder belongs to. */
  async function decorate(
    sessions: readonly SessionSummary[],
  ): Promise<SessionSummary[]> {
    const roots = new Map<string, { root: string; branch: string | null }>();
    await Promise.all(
      [...new Set(sessions.map((session) => session.cwd))].map(async (cwd) => {
        roots.set(cwd, await deps.projects.resolve(cwd));
      }),
    );
    return sessions.map((session) => {
      const live = deps.runtime.get(session.id);
      const project = roots.get(session.cwd);
      const worktree = project && project.root !== session.cwd;
      return {
        ...session,
        ...(live
          ? { live: true, running: live.snapshot().status.running }
          : {}),
        ...(project ? { projectRoot: project.root } : {}),
        ...(worktree && project.branch
          ? { worktreeBranch: project.branch }
          : {}),
      };
    });
  }

  async function summaryOf(id: string): Promise<SessionSummary | undefined> {
    const live = deps.runtime.get(id);
    if (live) {
      const [decorated] = await decorate([live.snapshot().summary]);
      return decorated;
    }
    const stored = await deps.sessions.read(id);
    if (!stored) return undefined;
    const [decorated] = await decorate([stored.summary]);
    return decorated;
  }

  function liveView(
    live: LiveSession,
    summary: SessionSummary,
    models: ModelOption[],
  ): SessionView {
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
      summary,
      items: settled.items,
      turn: turn.items,
      status,
      usage: contextUsage({
        tokens: reported ?? fallback,
        contextWindow: status.model?.contextWindow,
        estimated: reported === null && fallback !== null,
      }),
      models,
      starred: readStars(snapshot.entries),
      leaves: branchLeaves(
        snapshot.entries,
        snapshot.branch.at(-1)?.id ?? null,
      ),
      otherBranch: false,
    };
  }

  async function storedView(
    stored: SessionRead,
    summary: SessionSummary,
    leafId: string | undefined,
  ): Promise<SessionView> {
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
      summary,
      items: transcript.items,
      turn: [],
      status: null,
      usage: contextUsage({
        tokens: transcript.lastContextTokens,
        contextWindow: model?.contextWindow,
      }),
      models,
      starred: readStars(stored.entries),
      leaves: branchLeaves(stored.entries, stored.branch.at(-1)?.id ?? null),
      otherBranch: leafId !== undefined && leafId !== stored.leafId,
    };
  }

  /** Whichever of the two writers owns this session right now. */
  async function entriesOf(id: string): Promise<SessionRead | undefined> {
    const live = deps.runtime.get(id);
    if (live) {
      const snapshot = live.snapshot();
      return {
        summary: snapshot.summary,
        branch: snapshot.branch,
        entries: snapshot.entries,
        leafId: snapshot.branch.at(-1)?.id ?? null,
      };
    }
    return deps.sessions.read(id);
  }

  async function viewSession(
    id: string,
    leafId?: string,
  ): Promise<SessionView | undefined> {
    const live = leafId === undefined ? deps.runtime.get(id) : undefined;
    if (live) {
      const summary = await summaryOf(id);
      if (!summary) return undefined;
      return liveView(live, summary, await modelsFor(summary.cwd));
    }
    const stored = await deps.sessions.read(id, leafId);
    if (!stored) return undefined;
    const [summary] = await decorate([stored.summary]);
    if (!summary) return undefined;
    return storedView(stored, summary, leafId);
  }

  async function stop(id: string): Promise<void> {
    await deps.runtime.get(id)?.stop();
  }

  /** A live session owns its file; only a stopped one is edited on disk. */
  async function setStar(
    id: string,
    targetId: string,
    starred: boolean,
  ): Promise<void> {
    const live = deps.runtime.get(id);
    if (live) live.setStar(targetId, starred);
    else await deps.sessions.setStar(id, targetId, starred);
  }

  return {
    viewSession,
    stop,
    setStar,

    async listSessions(): Promise<ProjectGroup[]> {
      return groupByProject(await decorate(await deps.sessions.list()));
    },

    /**
     * One sidebar row. The counts come from the catalog's cached pass over the
     * file; a live session's own summary wins, because it may have no file yet.
     */
    async row(
      id: string,
    ): Promise<
      { summary: SessionSummary; metadata?: SessionRowMetadata } | undefined
    > {
      const live = deps.runtime.get(id);
      const found = await deps.sessions.rowMetadata(id);
      const base = live?.snapshot().summary ?? found?.summary;
      if (!base) return undefined;
      const [summary] = await decorate([base]);
      if (!summary) return undefined;
      return { summary, ...(found ? { metadata: found.metadata } : {}) };
    },

    async sessionStats(id: string): Promise<
      | {
          summary: SessionSummary;
          stats: SessionStats;
          usage: ContextUsage;
        }
      | undefined
    > {
      // Two reads at most: the entries to aggregate, and the view that owns
      // the one context-usage number the whole page shows.
      const [stored, view] = await Promise.all([
        entriesOf(id),
        viewSession(id),
      ]);
      if (!stored || !view) return undefined;
      return {
        summary: view.summary,
        stats: sessionStats(stored.entries),
        usage: view.usage,
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

    async activate(id: string): Promise<void> {
      await deps.runtime.open({ sessionId: id });
    },

    /** A live session owns its file; only a stopped one is edited on disk. */
    async rename(id: string, name: string): Promise<void> {
      const live = deps.runtime.get(id);
      if (live) live.setName(name);
      else await deps.sessions.rename(id, name);
    },

    async clearStars(id: string): Promise<void> {
      const stored = await entriesOf(id);
      if (!stored) return;
      for (const targetId of readStars(stored.entries)) {
        await setStar(id, targetId, false);
      }
    },

    async remove(id: string): Promise<void> {
      await stop(id);
      await deps.sessions.remove(id);
    },

    fork(id: string, entryId: string): Promise<{ id: string; text: string }> {
      return deps.sessions.fork(id, entryId);
    },

    clone(id: string, leafId?: string): Promise<string> {
      return deps.sessions.clone(id, leafId);
    },

    /** Shuts the runtime down first: nothing may append during the rewrite. */
    async rewind(id: string, entryId: string): Promise<string> {
      await stop(id);
      return deps.sessions.rewind(id, entryId);
    },

    /** Moves the session's leaf, opening a runtime when there is none. */
    async navigateTree(id: string, targetId: string): Promise<string> {
      const live =
        deps.runtime.get(id) ?? (await deps.runtime.open({ sessionId: id }));
      return (await live.navigateTree(targetId)) ?? "";
    },

    exportHtml(id: string): Promise<{ html: string; filename: string }> {
      return deps.sessions.exportHtml(id);
    },

    /** Undefined when the session has no runtime; the page then has nothing to stream. */
    subscribe(
      id: string,
      listener: (event: LiveEvent) => void,
    ): (() => void) | undefined {
      return deps.runtime.get(id)?.subscribe(listener);
    },

    /** Every session's lifecycle, for the sidebar's one shared stream. */
    subscribeSessions(listener: (event: RuntimeEvent) => void): () => void {
      return deps.runtime.subscribeAll(listener);
    },
  };
}
