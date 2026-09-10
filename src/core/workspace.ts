import {
  buildEntriesFromFiles,
  BUILTIN_COMMANDS,
  type FileEntry,
  filterFileEntries,
  rankCommands,
  type SlashCommand,
} from "./composer.ts";
import {
  conversationRail,
  hasBranches,
  type RailMark,
} from "./conversation-rail.ts";
import { contextUsage, type ContextUsage } from "./context-usage.ts";
import { type FileKind, fileKind, languageOf } from "./file-types.ts";
import type { GitFileStatus } from "./git-status.ts";
import {
  directoryWithin,
  FileAccessError,
  isAbsolutePath,
  isBashOutputPath,
  parentPath,
  referencesPath,
  samePath,
  withinAny,
} from "./path-access.ts";
import type {
  AgentRuntime,
  DirEntry,
  Files,
  FileStat,
  Git,
  GitChangeFile,
  GitStatus,
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
  Watcher,
} from "./ports.ts";
import {
  type BranchLeaf,
  branchLeaves,
  readStars,
  sessionStats,
  type SessionStats,
} from "./session-entries.ts";
import {
  compareSessions,
  isSubagentSession,
  type ProjectEntry,
  projectKeyOf,
  recentProjects,
  selectedProject,
  type SessionRowMetadata,
  type SessionSummary,
  sessionsForProject,
} from "./sessions.ts";
import {
  assistantItem,
  type ContentPart,
  contentParts,
  deferThinking,
  projectTranscript,
  type ToolCallView,
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
  /** Marks for the conversation rail: prompts, stars, and compactions. */
  rail: RailMark[];
  /** The session forked at least once, so the rail can expand into a graph. */
  branched: boolean;
};

/**
 * The sidebar shows one project at a time. Listing every session of a real
 * store is what made the page heavy, and a reader works in one repository.
 */
export type SidebarView = {
  projects: ProjectEntry[];
  selected?: string;
  /** Conversations of the selected project, with the runs each spawned. */
  sessions: { summary: SessionSummary; subagents: number }[];
  /** Subagent runs of this project whose parent session is not in the list. */
  orphans: number;
  /** Some other project has a session running: the closed selector says so. */
  activityElsewhere: boolean;
};

/** Everything the file viewer renders, in one read. */
export type FileView = {
  path: string;
  /** The folder the panel shows paths relative to. */
  cwd: string;
  kind: FileKind;
  language: string;
  size: number;
  /** A text file within the limit. */
  text?: string;
  /** A text file too large to render; the reader is told, not truncated. */
  tooLarge?: boolean;
  /** The file is gone from disk; only the diff is left. */
  deleted?: boolean;
  status?: GitFileStatus;
  /** The unified patch against HEAD, when Git has one. */
  diff?: string;
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
  git: Git;
  watcher: Watcher;
  /** os.tmpdir(); shell captures may live nowhere else. */
  tmpdir: string;
}) {
  // Folders a reader explicitly validated, as pi-web does: in memory, gone on
  // restart, never written to Pi's store.
  const validatedRoots = new Set<string>();

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
    const starred = readStars(snapshot.entries);
    const leafId = snapshot.branch.at(-1)?.id ?? null;
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
      starred,
      leaves: branchLeaves(snapshot.entries, leafId),
      otherBranch: false,
      rail: conversationRail(snapshot.entries, leafId, starred),
      branched: hasBranches(snapshot.entries),
    };
  }

  async function storedView(
    stored: SessionRead,
    summary: SessionSummary,
    options: ViewOptions,
  ): Promise<SessionView> {
    const transcript = projectTranscript(stored.branch);
    const starred = readStars(stored.entries);
    const leafId = stored.branch.at(-1)?.id ?? null;
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
      starred,
      leaves: branchLeaves(stored.entries, leafId),
      otherBranch: options.leaf !== undefined && options.leaf !== stored.leafId,
      rail: conversationRail(stored.entries, leafId, starred),
      branched: hasBranches(stored.entries),
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

  /**
   * The folder a completion request may list. Defaults to the session's own,
   * and anything else goes through the same containment policy as the file
   * panel, so there is one answer to "may this be listed".
   */
  async function authorizedCwd(
    id: string,
    directory: string | undefined,
  ): Promise<string> {
    const summary = await summaryOf(id);
    if (!summary) throw new ForbiddenPath("Unknown session");
    if (directory === undefined || directory === "") return summary.cwd;
    await authorize(directory, { sessionId: id, listing: true });
    return directory;
  }

  // --- File access -------------------------------------------------------
  //
  // One policy for every file route: lexical containment against the roots
  // this request may reach, then the same check on the resolved path. The
  // cheap roots (the open session's folder and its repository) are tried
  // first; the full set costs a pass over every session header.

  /** 256 KiB of text, as pi-web; above that the viewer says so. */
  const TEXT_LIMIT = 256 * 1024;
  const MEDIA_LIMIT = 10 * 1024 * 1024;

  async function projectRootOf(cwd: string): Promise<string | undefined> {
    return deps.projects.resolve(cwd).then(
      (project) => project.root,
      () => undefined,
    );
  }

  async function nearRoots(sessionId: string | undefined): Promise<string[]> {
    const roots = [...validatedRoots];
    if (sessionId === undefined) return roots;
    const summary = await summaryOf(sessionId);
    if (!summary) return roots;
    roots.push(summary.cwd);
    // A linked worktree may reach the repository it belongs to.
    const root = await projectRootOf(summary.cwd);
    if (root !== undefined) roots.push(root);
    return roots;
  }

  /** Every session's working folder, and the repository each sits in. */
  async function everyRoot(): Promise<string[]> {
    const cwds = [
      ...new Set((await deps.sessions.list()).map((session) => session.cwd)),
    ];
    const roots = await Promise.all(cwds.map(projectRootOf));
    return [...cwds, ...roots.filter((root) => root !== undefined)];
  }

  async function sessionReferences(id: string, path: string): Promise<boolean> {
    const stored = await entriesOf(id);
    return stored
      ? referencesPath(JSON.stringify(stored.entries), path)
      : false;
  }

  /**
   * Answers with the file's stat, or throws with the status the route should
   * send. `listing` requests are never granted by a transcript reference:
   * naming a file does not open its folder.
   */
  async function authorize(
    path: string,
    options: {
      sessionId?: string | undefined;
      listing?: boolean;
      allowMissing?: boolean;
    } = {},
  ): Promise<FileStat | undefined> {
    if (!isAbsolutePath(path)) {
      throw new FileAccessError("Path must be absolute", 400);
    }
    const roots = await nearRoots(options.sessionId);
    if (!withinAny(roots, path)) roots.push(...(await everyRoot()));
    let referenced = false;
    if (!withinAny(roots, path)) {
      if (options.listing === true || options.sessionId === undefined) {
        throw new FileAccessError("Access denied", 403);
      }
      referenced = await sessionReferences(options.sessionId, path);
      if (!referenced) throw new FileAccessError("Access denied", 403);
    }
    const info = await deps.files.stat(path);
    if (info === undefined && options.allowMissing !== true) {
      throw new FileAccessError("Not found", 404);
    }
    if (options.listing === true && info !== undefined && !info.isDirectory) {
      throw new FileAccessError("Not a directory", 400);
    }
    if (!referenced) {
      // The lexical check proved the spelling; this proves the file.
      const real = await deps.files.realpath(
        info === undefined ? parentPath(path) : path,
      );
      if (real === undefined) throw new FileAccessError("Not found", 404);
      const resolved = await Promise.all(
        roots.map((root) => deps.files.realpath(root)),
      );
      const known = resolved.filter((root) => root !== undefined);
      if (!withinAny(known, real)) {
        throw new FileAccessError("Access denied", 403);
      }
    }
    return info;
  }

  async function cwdOf(sessionId: string | undefined): Promise<string> {
    if (sessionId === undefined) return "";
    return (await summaryOf(sessionId))?.cwd ?? "";
  }

  function changeFor(
    status: GitStatus,
    path: string,
  ): GitChangeFile | undefined {
    return status.files.find((file) => samePath(file.path, path));
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

    /**
     * The whole sidebar: the projects to choose from, and the sessions of the
     * chosen one. `activeId` wins over the remembered choice, so opening a
     * session always shows the project it belongs to.
     */
    async sidebar(
      options: { remembered?: string; activeId?: string } = {},
    ): Promise<SidebarView> {
      const all = await decorate(await deps.sessions.list());
      const projects = recentProjects(all);
      const open =
        options.activeId === undefined
          ? undefined
          : all.find((session) => session.id === options.activeId);
      const selected = selectedProject(projects, {
        ...(open ? { active: projectKeyOf(open) } : {}),
        ...(options.remembered === undefined
          ? {}
          : { remembered: options.remembered }),
      });
      const inProject = all.filter(
        (session) => projectKeyOf(session) === selected,
      );
      const sessions = sessionsForProject(
        inProject.filter((session) => !isSubagentSession(session)),
        undefined,
      );
      const known = new Set(sessions.map((session) => session.id));
      const runs = new Map<string, number>();
      let orphans = 0;
      for (const run of inProject.filter(isSubagentSession)) {
        const parent = run.parentId;
        if (parent !== undefined && known.has(parent)) {
          runs.set(parent, (runs.get(parent) ?? 0) + 1);
        } else orphans += 1;
      }
      return {
        projects,
        ...(selected === undefined ? {} : { selected }),
        sessions: sessions.map((summary) => ({
          summary,
          subagents: runs.get(summary.id) ?? 0,
        })),
        orphans,
        activityElsewhere: projects.some(
          (project) => project.key !== selected && project.running > 0,
        ),
      };
    },

    /**
     * The runs behind a collapsed "N subagent runs" line: either one session's
     * children, or the project's runs that have no parent to hang under.
     */
    async subagentRuns(
      project: string,
      parentId?: string,
    ): Promise<SessionSummary[]> {
      const all = await decorate(await deps.sessions.list());
      const known = new Set(
        all
          .filter(
            (session) =>
              !isSubagentSession(session) && projectKeyOf(session) === project,
          )
          .map((session) => session.id),
      );
      return all
        .filter(
          (session) =>
            isSubagentSession(session) &&
            projectKeyOf(session) === project &&
            (parentId === undefined
              ? session.parentId === undefined || !known.has(session.parentId)
              : session.parentId === parentId),
        )
        .sort(compareSessions);
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

    /** The working folder of a session, for the file panel's root. */
    async sessionFolder(id: string): Promise<string | undefined> {
      const cwd = await cwdOf(id);
      return cwd === "" ? undefined : cwd;
    },

    /** Children of one directory, for the explorer's lazy tree. */
    async listDirectory(
      sessionId: string | undefined,
      path: string,
    ): Promise<{ path: string; entries: DirEntry[] }> {
      await authorize(path, { sessionId, listing: true });
      return { path, entries: await deps.files.list(path) };
    },

    /** What the working tree changed, for the panel's changes section. */
    async gitChanges(sessionId: string): Promise<GitStatus> {
      const cwd = await cwdOf(sessionId);
      if (cwd === "") throw new FileAccessError("Unknown session", 404);
      return deps.git.status(cwd);
    },

    /**
     * One file as the viewer needs it: its kind, its text when it has any,
     * and its diff against HEAD. A deleted file has no content left, so it
     * opens with the diff alone.
     */
    async fileView(
      sessionId: string | undefined,
      path: string,
    ): Promise<FileView> {
      const cwd = await cwdOf(sessionId);
      const info = await authorize(path, { sessionId, allowMissing: true });
      const status = cwd === "" ? null : await deps.git.status(cwd);
      const change = status ? changeFor(status, path) : undefined;
      if (info === undefined) {
        if (!change) throw new FileAccessError("Not found", 404);
        const diff = await deps.git.diff(cwd, change);
        return {
          path,
          cwd,
          kind: "text",
          language: languageOf(path),
          size: 0,
          deleted: true,
          status: change.status,
          ...(diff === null ? {} : { diff }),
        };
      }
      if (!info.isFile) throw new FileAccessError("Not a file", 400);
      const kind = fileKind(path);
      const view: FileView = {
        path,
        cwd,
        kind,
        language: languageOf(path),
        size: info.size,
        ...(change ? { status: change.status } : {}),
      };
      if (kind === "text") {
        if (info.size > TEXT_LIMIT) view.tooLarge = true;
        else view.text = await deps.files.readText(path, TEXT_LIMIT);
      }
      if (change) {
        const diff = await deps.git.diff(cwd, change);
        if (diff !== null) view.diff = diff;
      }
      return view;
    },

    /** Size, language, and kind alone: what a media viewer re-reads. */
    async fileMeta(
      sessionId: string | undefined,
      path: string,
    ): Promise<{ size: number; language: string; kind: FileKind }> {
      const info = await authorize(path, { sessionId });
      if (info === undefined || !info.isFile) {
        throw new FileAccessError("Not a file", 400);
      }
      return {
        size: info.size,
        language: languageOf(path),
        kind: fileKind(path),
      };
    },

    /** Raw bytes for an image, an audio file, a PDF, or a download. */
    async fileBytes(
      sessionId: string | undefined,
      path: string,
      range?: { start: number; end: number },
    ): Promise<{ size: number; stream: ReadableStream<Uint8Array> }> {
      const info = await authorize(path, { sessionId });
      if (info === undefined || !info.isFile) {
        throw new FileAccessError("Not a file", 400);
      }
      if (fileKind(path) === "image" && info.size > MEDIA_LIMIT) {
        throw new FileAccessError("Image too large (>10MB)", 413);
      }
      return { size: info.size, stream: deps.files.stream(path, range) };
    },

    /** A .docx as HTML, for the sandboxed preview frame. */
    async docxPreview(
      sessionId: string | undefined,
      path: string,
    ): Promise<string> {
      const info = await authorize(path, { sessionId });
      if (info === undefined || fileKind(path) !== "docx") {
        throw new FileAccessError("Not a Word document", 400);
      }
      if (info.size > MEDIA_LIMIT) {
        throw new FileAccessError("Document too large (>10MB)", 413);
      }
      return deps.files.docxHtml(path);
    },

    /** Tells the viewer when the file changed under it. */
    async watchFile(
      sessionId: string | undefined,
      path: string,
      handlers: {
        change(info: { mtime: number; size: number }): void;
        error(): void;
      },
    ): Promise<() => void> {
      // A watch survives the file being deleted and written again, so a
      // missing path is not an error here.
      await authorize(path, { sessionId, allowMissing: true });
      return deps.watcher.watch(path, handlers);
    },

    /** The explorer's search box: files of the index, ranked. */
    async searchFiles(
      sessionId: string,
      query: string,
      limit = 50,
    ): Promise<FileEntry[]> {
      const cwd = await authorizedCwd(sessionId, undefined);
      const index = await deps.files.index(cwd);
      const entries = index.files.map((path) => ({ path, isDir: false }));
      return filterFileEntries(entries, query, limit);
    },

    /**
     * A folder the reader picked. Validating it is what makes it reachable;
     * the set is in memory, so a restart forgets it, as pi-web does.
     */
    async validateFolder(
      path: string,
    ): Promise<{ cwd: string; projectRoot: string }> {
      if (!isAbsolutePath(path)) {
        throw new FileAccessError(`Not an absolute path: ${path}`, 400);
      }
      const info = await deps.files.stat(path);
      if (info === undefined) {
        throw new FileAccessError(`Folder not found: ${path}`, 404);
      }
      if (!info.isDirectory) {
        throw new FileAccessError(`Not a folder: ${path}`, 400);
      }
      const cwd = (await deps.files.realpath(path)) ?? path;
      validatedRoots.add(cwd);
      const projectRoot = (await projectRootOf(cwd)) ?? cwd;
      validatedRoots.add(projectRoot);
      return { cwd, projectRoot };
    },

    /** One tool call, for the "show all" behind a truncated result. */
    async toolCall(
      id: string,
      entryId: string,
      callId: string,
    ): Promise<ToolCallView | undefined> {
      const stored = await entriesOf(id);
      if (!stored) return undefined;
      for (const item of projectTranscript(stored.branch).items) {
        if (item.kind !== "assistant") continue;
        for (const block of item.blocks) {
          if (block.kind !== "tool" || block.call.id !== callId) continue;
          // The link carries whichever entry the truncated body came from:
          // the call's own, or the one the result was written into.
          if (
            item.entryId === entryId ||
            block.call.result?.entryId === entryId
          ) {
            return block.call;
          }
        }
      }
      return undefined;
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
