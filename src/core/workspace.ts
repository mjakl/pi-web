import {
  buildEntriesFromFiles,
  BUILTIN_COMMANDS,
  type FileEntry,
  filterFileEntries,
  rankCommands,
  type SlashCommand,
} from "./composer.ts";
import { contextUsage, type ContextUsage } from "./context-usage.ts";
import { directoryWithin, isBashOutputPath } from "./path-access.ts";
import type {
  AgentRuntime,
  Files,
  ImageAttachment,
  LiveEvent,
  LiveSession,
  LiveStatus,
  ModelCatalog,
  ModelListing,
  ModelOption,
  ProjectResolver,
  ProjectResources,
  PromptInput,
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
  type ContentPart,
  contentParts,
  deferThinking,
  projectTranscript,
  type TranscriptItem,
} from "./transcript.ts";
import { pageItems } from "./turns.ts";

// The application service. Inbound port for every page and partial: the web
// layer renders what this returns and never touches Pi or the file system.

/** Which slice of which branch a page shows. */
export type ViewOptions = {
  /** Branch tip to view; the session's own leaf by default. */
  leaf?: string;
  /** How many settled items the page holds. */
  tail?: number;
  /** Page backwards from an entry already on screen. */
  before?: string;
  /** Widen the page until this entry is part of it. */
  through?: string;
};

export type SessionView = {
  summary: SessionSummary;
  /** Settled conversation, before the current turn. */
  items: TranscriptItem[];
  /** Older entries exist before the first item on the page. */
  hasMore: boolean;
  /** The oldest item on the page: the cursor for the previous page. */
  oldestId?: string;
  /** The branch being viewed, so paging requests stay on it. */
  leaf?: string;
  /** The current (or just finished) turn, re-rendered while streaming. */
  turn: TranscriptItem[];
  status: LiveStatus | null;
  usage: ContextUsage;
  models: ModelOption[];
  /** `enabledModels` patterns that matched nothing, shown once per page. */
  modelWarnings: string[];
  /** Entry ids of starred answers. */
  starred: Set<string>;
  /** Tips of every branch in the session; one entry when nothing branched. */
  leaves: BranchLeaf[];
  /** True while viewing a branch other than the session's own leaf. */
  otherBranch: boolean;
};

export type Workspace = ReturnType<typeof createWorkspace>;

/** Where a file request may point: the session's own working folder. */
export class ForbiddenPath extends Error {}

export function createWorkspace(deps: {
  sessions: SessionCatalog;
  runtime: AgentRuntime;
  models: ModelCatalog;
  projects: ProjectResolver;
  resources: ProjectResources;
  files: Files;
  /** os.tmpdir(); shell captures may live nowhere else. */
  tmpdir: string;
}) {
  async function modelsFor(cwd: string): Promise<ModelListing> {
    try {
      return await deps.models.list(cwd);
    } catch {
      return { models: [], warnings: [] };
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
    models: ModelListing,
    options: ViewOptions,
  ): SessionView {
    const snapshot = live.snapshot();
    const settled = projectTranscript(
      snapshot.branch.slice(0, snapshot.turnStart),
    );
    const page = pageItems(settled.items, options);
    deferThinking(page.items);
    const turn = projectTranscript(snapshot.branch.slice(snapshot.turnStart));
    if (snapshot.partial) {
      turn.items.push(assistantItem("partial", snapshot.partial));
    }
    if (snapshot.bash) {
      turn.items.push({
        kind: "bash",
        entryId: "bash-pending",
        command: snapshot.bash.command,
        output: snapshot.bash.output,
        exitCode: null,
        cancelled: false,
        truncated: false,
        excluded: false,
        pending: true,
        timestamp: new Date().toISOString(),
      });
    }
    const { status } = snapshot;
    const reported = status.contextTokens;
    const fallback = turn.lastContextTokens ?? settled.lastContextTokens;
    return {
      summary,
      items: page.items,
      hasMore: page.hasMore,
      ...(page.oldestId === undefined ? {} : { oldestId: page.oldestId }),
      ...(options.leaf === undefined ? {} : { leaf: options.leaf }),
      turn: turn.items,
      status,
      usage: contextUsage({
        tokens: reported ?? fallback,
        contextWindow: status.model?.contextWindow,
        estimated: reported === null && fallback !== null,
      }),
      models: models.models,
      modelWarnings: models.warnings,
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
    options: ViewOptions,
  ): Promise<SessionView> {
    const transcript = projectTranscript(stored.branch);
    const page = pageItems(transcript.items, options);
    deferThinking(page.items);
    const listing = await modelsFor(stored.summary.cwd);
    const model = transcript.lastModel
      ? listing.models.find(
          (option) =>
            option.provider === transcript.lastModel?.provider &&
            option.id === transcript.lastModel.id,
        )
      : undefined;
    return {
      summary,
      items: page.items,
      hasMore: page.hasMore,
      ...(page.oldestId === undefined ? {} : { oldestId: page.oldestId }),
      ...(options.leaf === undefined ? {} : { leaf: options.leaf }),
      turn: [],
      status: null,
      usage: contextUsage({
        tokens: transcript.lastContextTokens,
        contextWindow: model?.contextWindow,
      }),
      models: listing.models,
      modelWarnings: listing.warnings,
      starred: readStars(stored.entries),
      leaves: branchLeaves(stored.entries, stored.branch.at(-1)?.id ?? null),
      otherBranch: options.leaf !== undefined && options.leaf !== stored.leafId,
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

  /** The content parts of one entry, whichever kind of message it holds. */
  async function entryContent(
    id: string,
    entryId: string,
  ): Promise<ContentPart[]> {
    const stored = await entriesOf(id);
    const entry = stored?.entries.find((item) => item.id === entryId);
    if (entry?.type === "message") {
      const { message } = entry;
      return "content" in message ? contentParts(message.content) : [];
    }
    if (entry?.type === "custom_message") return contentParts(entry.content);
    return [];
  }

  async function viewSession(
    id: string,
    options: ViewOptions = {},
  ): Promise<SessionView | undefined> {
    const live = options.leaf === undefined ? deps.runtime.get(id) : undefined;
    if (live) {
      const summary = await summaryOf(id);
      if (!summary) return undefined;
      return liveView(live, summary, await modelsFor(summary.cwd), options);
    }
    const stored = await deps.sessions.read(id, options.leaf);
    if (!stored) return undefined;
    const [summary] = await decorate([stored.summary]);
    if (!summary) return undefined;
    return storedView(stored, summary, options);
  }

  async function stop(id: string): Promise<void> {
    await deps.runtime.get(id)?.stop();
  }

  /** File requests may only reach the session's own working folder. */
  async function authorizedCwd(
    id: string,
    directory: string | undefined,
  ): Promise<string> {
    const summary = await summaryOf(id);
    if (!summary) throw new ForbiddenPath("Unknown session");
    if (directory === undefined || directory === "") return summary.cwd;
    if (!directoryWithin(summary.cwd, directory)) {
      throw new ForbiddenPath("Outside the session's working folder");
    }
    return directory;
  }

  async function liveOrOpen(id: string): Promise<LiveSession> {
    return deps.runtime.get(id) ?? deps.runtime.open({ sessionId: id });
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
    async startSession(
      cwd: string,
      text: string,
      input?: PromptInput,
    ): Promise<string> {
      const live = await deps.runtime.open({ cwd });
      await live.prompt(text, input);
      return live.id;
    },

    async send(id: string, text: string, input?: PromptInput): Promise<void> {
      const live = await liveOrOpen(id);
      await live.prompt(text, input);
    },

    /** Stops the turn, or the shell command when that is what runs. */
    async abort(id: string): Promise<void> {
      const live = deps.runtime.get(id);
      if (!live) return;
      if (live.snapshot().status.bashRunning) live.abortBash();
      else await live.abort();
    },

    /**
     * The slash menu: built-ins plus whatever the session offers. A stopped
     * session lists prompt templates and skills from disk rather than
     * starting an agent just to fill a menu.
     */
    async commands(id: string, query: string): Promise<SlashCommand[]> {
      const live = deps.runtime.get(id);
      let listed: SlashCommand[] = [];
      if (live) listed = live.commands();
      else {
        const summary = await summaryOf(id);
        if (summary) {
          listed = await deps.resources
            .commands(summary.cwd)
            .catch(() => [] as SlashCommand[]);
        }
      }
      return rankCommands([...BUILTIN_COMMANDS, ...listed], query, {
        running: live?.snapshot().status.running ?? false,
      });
    },

    async compact(id: string, instructions?: string): Promise<void> {
      const live = await liveOrOpen(id);
      await live.compact(instructions);
    },

    abortCompaction(id: string): void {
      deps.runtime.get(id)?.abortCompaction();
    },

    async reload(id: string): Promise<void> {
      await (await liveOrOpen(id)).reload();
    },

    /** Empties the queue and hands its texts back as one composer draft. */
    recallQueue(id: string): string {
      const queued = deps.runtime.get(id)?.clearQueue() ?? [];
      return queued.map((message) => message.text).join("\n\n");
    },

    clearQueue(id: string): void {
      deps.runtime.get(id)?.clearQueue();
    },

    async runBash(
      id: string,
      command: string,
      excludeFromContext: boolean,
    ): Promise<void> {
      const live = await liveOrOpen(id);
      await live.runBash(command, excludeFromContext);
    },

    /**
     * One image of an entry, straight out of the session file: an attachment
     * of a question, or an image a tool returned. Indexed among the image
     * parts of that entry, which is what the transcript renders links for.
     */
    async entryImage(
      id: string,
      entryId: string,
      index: number,
    ): Promise<ImageAttachment | undefined> {
      const image = (await entryContent(id, entryId)).filter(
        (part) => part.type === "image",
      )[index];
      return typeof image?.data === "string" &&
        typeof image.mimeType === "string"
        ? { data: image.data, mimeType: image.mimeType }
        : undefined;
    },

    /** One thinking block, for the ones the page left out of a long session. */
    async entryThinking(
      id: string,
      entryId: string,
      index: number,
    ): Promise<string | undefined> {
      const block = (await entryContent(id, entryId)).filter(
        (part) => part.type === "thinking",
      )[index];
      return typeof block?.thinking === "string" ? block.thinking : undefined;
    },

    /** The `@` index for a folder inside the session's own working folder. */
    async fileIndex(
      id: string,
      directory: string | undefined,
      query: string,
    ): Promise<
      { files: string[]; truncated: boolean } | { matches: FileEntry[] }
    > {
      const cwd = await authorizedCwd(id, directory);
      const index = await deps.files.index(cwd);
      if (query === "") return index;
      return {
        matches: filterFileEntries(buildEntriesFromFiles(index.files), query),
      };
    },

    /** Immediate children for a path-like `@` query, containment enforced. */
    async fileCompletion(
      id: string,
      query: string,
      directory: string | undefined,
    ): Promise<FileEntry[]> {
      const cwd = await authorizedCwd(id, directory);
      const children = await deps.files.children(query, cwd);
      return children.filter((entry) => directoryWithin(cwd, entry.path));
    },

    /** A truncated shell run's capture file, if this session produced it. */
    async bashOutput(id: string, path: string): Promise<string> {
      if (!isBashOutputPath(deps.tmpdir, path)) {
        throw new ForbiddenPath("Not a shell output file");
      }
      const stored = await entriesOf(id);
      const referenced = stored?.entries.some(
        (entry) =>
          entry.type === "message" &&
          entry.message.role === "bashExecution" &&
          entry.message.fullOutputPath === path,
      );
      if (!referenced) {
        throw new ForbiddenPath("This session did not produce that file");
      }
      return deps.files.readOutput(path);
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
