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
import type { DialogAnswer } from "./extension-ui.ts";
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
import { initialModel, initialThinking } from "./models.ts";
import type { PackagesView, PackageScope } from "./packages.ts";
import type {
  SkillInfo,
  SkillScope,
  SkillSearchHit,
  SkillUpdate,
} from "./skills.ts";
import {
  type ProjectInfo,
  unavailableFolderMessage,
  type WorktreeInfo,
} from "./workspaces.ts";
import type {
  AgentRuntime,
  DirectoryBrowser,
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
  Packages,
  ProjectResolver,
  ProjectResources,
  ProjectTrust,
  PromptInput,
  PushNotifier,
  PushSubscription,
  RuntimeEvent,
  SessionCatalog,
  SessionRead,
  Skills,
  ThinkingLevel,
  ToolView,
  Watcher,
} from "./ports.ts";
import {
  type BranchLeaf,
  branchLeaves,
  branchTo,
  readStars,
  rowMetadata,
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
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

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
  /** The reader's context-warning threshold, in tokens. */
  warnTokens?: number;
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
  /**
   * The turn that just ended, for the one render that appends it to the log.
   * Empty at every other moment: once handed over it belongs to `items`, so a
   * later re-render cannot put the same messages on the page twice.
   */
  settledTurn: TranscriptItem[];
  status: LiveStatus | null;
  usage: ContextUsage;
  /** Cumulative token totals of the whole session, for the top-bar readout. */
  tokens: SessionStats["tokens"];
  models: ModelOption[];
  /**
   * The model this session last answered with, for the composer's selector
   * before a runtime exists. A live session reports its own in `status`.
   */
  model?: ModelOption;
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

/** One project row of the folder picker, once its worktrees are known. */
export type FolderChoice = {
  cwd: string;
  available: boolean;
  project: ProjectInfo;
  /** False when git could not answer at all: a plain folder. */
  isGit: boolean;
  worktrees: WorktreeInfo[];
  /** The listed worktree the reader is in right now, if any. */
  current: string | null;
};

/** What the new-session page needs before there is a session. */
export type NewSessionView = {
  cwd: string;
  available: boolean;
  /** The folder passed validation, so completion and models are offered. */
  usable: boolean;
  projectKey: string;
  models: ModelOption[];
  modelWarnings: string[];
  model: ModelOption | undefined;
  thinkingLevel: ThinkingLevel;
  trust: { requiresTrust: boolean; trusted: boolean };
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

/** A name worth showing: a blank one is the same as none. */
function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

export function createWorkspace(deps: {
  sessions: SessionCatalog;
  runtime: AgentRuntime;
  models: ModelCatalog;
  projects: ProjectResolver;
  browser: DirectoryBrowser;
  trust: ProjectTrust;
  skills: Skills;
  packages: Packages;
  resources: ProjectResources;
  files: Files;
  git: Git;
  watcher: Watcher;
  push: PushNotifier;
  /** os.tmpdir(); shell captures may live nowhere else. */
  tmpdir: string;
}) {
  // Folders a reader explicitly validated, as pi-web does: in memory, gone on
  // restart, never written to Pi's store.
  const validatedRoots = new Set<string>();

  /**
   * A finished run reaches every subscribed browser, open tab or not. The
   * service worker decides whether to show it: a visible window already heard
   * about it through the session stream.
   */
  deps.runtime.subscribeAll((event) => {
    if (event.type !== "completed") return;
    void summaryOf(event.sessionId)
      .then((summary) =>
        deps.push.send({
          title: nonEmpty(summary?.name) ?? "Session complete",
          body: "Task finished.",
          url: `/sessions/${event.sessionId}`,
          tag: `web-pi:session-complete:${event.sessionId}`,
        }),
      )
      .catch(() => {
        // Push is best effort: a failing subscription must not break a turn.
      });
  });

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
    const roots = new Map<string, ProjectInfo>();
    const present = new Map<string, boolean>();
    await Promise.all(
      [...new Set(sessions.map((session) => session.cwd))].map(async (cwd) => {
        const [project, available] = await Promise.all([
          deps.projects.resolve(cwd),
          deps.projects.available(cwd),
        ]);
        roots.set(cwd, project);
        present.set(cwd, available);
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
        ...(present.get(session.cwd) === false ? { cwdAvailable: false } : {}),
      };
    });
  }

  /**
   * Reading, exporting and stopping stay open when a session's folder is
   * gone; everything that would run the agent in it is refused with the one
   * message the page also shows.
   */
  async function requireFolder(id: string): Promise<void> {
    const summary = await summaryOf(id);
    if (summary?.cwdAvailable === false) {
      throw new Error(unavailableFolderMessage(summary.cwd));
    }
  }

  function folderAvailable(cwd: string): Promise<boolean> {
    return deps.projects.available(cwd);
  }

  /**
   * Installing into a project writes into a repository whose own code the
   * agent will load. An untrusted one is refused, not silently redirected to
   * the global scope.
   */
  async function requireTrustedProject(
    cwd: string,
    project: boolean,
  ): Promise<void> {
    if (!project) return;
    const status = await deps.trust.status(cwd);
    if (!status.trusted) {
      throw new FileAccessError(
        "Project resources must be trusted before installing into this project",
        403,
      );
    }
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
    // `turnStart` moves to the end of the branch the moment the agent settles,
    // so a settled turn is part of the log and only the settled-turn render
    // still sees it.
    const settled = projectTranscript(
      snapshot.branch.slice(0, snapshot.turnStart),
    );
    const page = pageItems(settled.items, options);
    deferThinking(page.items);
    const turn = projectTranscript(snapshot.branch.slice(snapshot.turnStart));
    if (snapshot.partial) {
      turn.items.push(
        assistantItem("partial", snapshot.partial, {
          ...(snapshot.partialArguments === undefined
            ? {}
            : { partialArguments: snapshot.partialArguments }),
        }),
      );
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
    const settledTurn = snapshot.settledTurn
      ? projectTranscript(
          snapshot.branch.slice(
            snapshot.settledTurn.start,
            snapshot.settledTurn.end,
          ),
        ).items
      : [];
    const { status } = snapshot;
    // This view is what delivers notices and extension composer text; nothing
    // else may consume them.
    live.takePending();
    const starred = readStars(snapshot.entries);
    const leafId = snapshot.branch.at(-1)?.id ?? null;
    const reported = status.contextTokens;
    const fallback = turn.lastContextTokens ?? settled.lastContextTokens;
    fillCompactions(summary.id, snapshot.entries, [
      ...page.items,
      ...turn.items,
      ...settledTurn,
    ]);
    return {
      summary,
      items: page.items,
      hasMore: page.hasMore,
      ...(page.oldestId === undefined ? {} : { oldestId: page.oldestId }),
      ...(options.leaf === undefined ? {} : { leaf: options.leaf }),
      turn: turn.items,
      settledTurn,
      status,
      tokens: sessionStats(snapshot.entries).tokens,
      usage: contextUsage({
        tokens: reported ?? fallback,
        contextWindow: status.model?.contextWindow,
        estimated: reported === null && fallback !== null,
        ...(options.warnTokens === undefined
          ? {}
          : { warnTokens: options.warnTokens }),
      }),
      models: models.models,
      modelWarnings: models.warnings,
      starred,
      leaves: branchLeaves(snapshot.entries, leafId),
      otherBranch:
        options.leaf !== undefined && options.leaf !== (leafId ?? undefined),
      rail: conversationRail(snapshot.entries, leafId, starred),
      branched: hasBranches(snapshot.entries),
    };
  }

  /** The post-compaction estimate every compaction card on the page shows. */
  function fillCompactions(
    id: string,
    entries: readonly SessionEntry[],
    items: readonly TranscriptItem[],
  ): void {
    for (const item of items) {
      if (item.kind !== "compaction") continue;
      const after = deps.sessions.contextTokensAt(id, entries, item.entryId);
      if (after !== undefined) item.tokensAfter = after;
    }
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
    fillCompactions(stored.summary.id, stored.entries, page.items);
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
      settledTurn: [],
      status: null,
      tokens: sessionStats(stored.entries).tokens,
      usage: contextUsage({
        tokens: transcript.lastContextTokens,
        contextWindow: model?.contextWindow,
        ...(options.warnTokens === undefined
          ? {}
          : { warnTokens: options.warnTokens }),
      }),
      models: listing.models,
      ...(model === undefined ? {} : { model }),
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
    // A running session owns its file, so even another branch of it is read
    // from the runtime: the file on disk may be a flush behind.
    const live = deps.runtime.get(id);
    if (live) {
      const summary = await summaryOf(id);
      if (!summary) return undefined;
      const snapshot = live.snapshot();
      const leafId = snapshot.branch.at(-1)?.id ?? null;
      if (options.leaf !== undefined && options.leaf !== leafId) {
        // Another branch of a running session: read-only, but still from the
        // runtime's entries rather than from a file it has yet to flush.
        return storedView(
          {
            summary: snapshot.summary,
            branch: branchTo(snapshot.entries, options.leaf),
            entries: snapshot.entries,
            leafId,
          },
          summary,
          options,
        );
      }
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
      const snapshot = live?.snapshot();
      const found = await deps.sessions.rowMetadata(id);
      const base = snapshot?.summary ?? found?.summary;
      if (!base) return undefined;
      const [summary] = await decorate([base]);
      if (!summary) return undefined;
      // A session Pi has not flushed yet has no file to count; its entries are
      // right here, and they answer the same question.
      const metadata =
        found?.metadata ??
        (snapshot
          ? rowMetadata(snapshot.entries, {
              modifiedAt: base.modifiedAt,
              fileSize: base.fileSize,
            })
          : undefined);
      return { summary, ...(metadata ? { metadata } : {}) };
    },

    async sessionStats(
      id: string,
      options: { warnTokens?: number } = {},
    ): Promise<
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
        viewSession(id, options),
      ]);
      if (!stored || !view) return undefined;
      return {
        summary: view.summary,
        stats: sessionStats(stored.entries),
        usage: view.usage,
      };
    },

    /**
     * Start a session in `cwd` and send the first prompt. An explicit model
     * or reasoning level starts it there and, when Pi honours the choice,
     * becomes the default for the next session — so the listing is stale
     * afterwards.
     */
    async startSession(
      cwd: string,
      text: string,
      input?: PromptInput,
      startup: {
        model?: { provider: string; modelId: string };
        thinkingLevel?: ThinkingLevel;
      } = {},
    ): Promise<string> {
      if (!(await folderAvailable(cwd))) {
        throw new Error(unavailableFolderMessage(cwd));
      }
      const live = await deps.runtime.open({ cwd, ...startup });
      if (startup.model || startup.thinkingLevel) deps.models.invalidate(cwd);
      await live.prompt(text, input);
      return live.id;
    },

    async send(id: string, text: string, input?: PromptInput): Promise<void> {
      await requireFolder(id);
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
      await requireFolder(id);
      const live = await liveOrOpen(id);
      await live.compact(instructions);
    },

    abortCompaction(id: string): void {
      deps.runtime.get(id)?.abortCompaction();
    },

    async reload(id: string): Promise<void> {
      await requireFolder(id);
      await (await liveOrOpen(id)).reload();
    },

    /**
     * Answers an extension dialog. Only the tab that gets here resolves it;
     * the others see the dialog disappear on the next render.
     */
    answerDialog(id: string, requestId: string, answer: DialogAnswer): boolean {
      return deps.runtime.get(id)?.answerDialog(requestId, answer) ?? false;
    },

    /** One keystroke or paste for an extension's open custom UI. */
    customInput(id: string, requestId: string, data: string): void {
      deps.runtime.get(id)?.customInput(requestId, data);
    },

    /** The VAPID public key a browser needs to subscribe to push. */
    pushKey(): string {
      return deps.push.publicKey();
    },

    subscribePush(subscription: PushSubscription): void {
      deps.push.subscribe(subscription);
    },

    /**
     * Empties the queue and hands it back for the composer: the texts as one
     * draft, and the images of every queued message, so recalling a message
     * that carried a screenshot does not silently drop it.
     */
    recallQueue(id: string): { text: string; images: ImageAttachment[] } {
      const queued = deps.runtime.get(id)?.clearQueue() ?? [];
      return {
        text: queued
          .map((message) => message.text)
          .filter((text) => text !== "")
          .join("\n\n"),
        images: queued.flatMap((message) => message.images ?? []),
      };
    },

    async runBash(
      id: string,
      command: string,
      excludeFromContext: boolean,
    ): Promise<void> {
      await requireFolder(id);
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

    // --- Workspace selection ---------------------------------------------

    /** Directory names only, for the picker's browse pane. */
    browse(path?: string) {
      return deps.browser.browse(path);
    },

    /**
     * One project row of the picker: its worktrees, freshly probed. Probing
     * runs git in the folder, so the folder has to be one this reader may
     * already reach; the worktrees it reports join the allowed roots, which is
     * how a session in a sibling worktree stays readable after a restart.
     */
    async folders(cwd: string): Promise<FolderChoice> {
      const available = await folderAvailable(cwd);
      // A folder that is gone is never probed, so there is nothing to gate;
      // one that is there has git run in it, and that needs a folder this
      // reader may already reach.
      if (available) await authorize(cwd, { listing: true });
      const listing = await deps.projects.worktrees(cwd);
      const worktrees =
        listing.worktrees.length > 0
          ? listing.worktrees
          : available
            ? [{ path: cwd, branch: listing.project.branch }]
            : [];
      for (const tree of worktrees) validatedRoots.add(tree.path);
      return {
        cwd,
        available,
        project: listing.project,
        isGit: listing.isGit,
        worktrees,
        current:
          worktrees.find((tree) => samePath(tree.path, cwd))?.path ?? null,
      };
    },

    /** What `/new` renders: models and trust for the chosen folder. */
    async newSession(cwd: string): Promise<NewSessionView> {
      const [available, trust] = await Promise.all([
        folderAvailable(cwd),
        deps.trust.status(cwd).catch(() => ({
          requiresTrust: false,
          trusted: true,
        })),
      ]);
      // Validation is what makes a folder reachable, so it is also what
      // decides whether the composer may complete paths in it.
      let usable = false;
      let projectKey = cwd;
      if (available) {
        try {
          projectKey = (await this.validateFolder(cwd)).projectRoot;
          usable = true;
        } catch {
          usable = false;
        }
      }
      const listing = usable
        ? await modelsFor(cwd)
        : { models: [], warnings: [] };
      const model = initialModel(listing.models, listing.preferred);
      return {
        cwd,
        available,
        usable,
        projectKey,
        models: listing.models,
        modelWarnings: listing.warnings,
        model,
        thinkingLevel: initialThinking(model),
        trust,
      };
    },

    /** The slash menu before a session exists: prompts and skills of a folder. */
    async folderCommands(cwd: string, query: string): Promise<SlashCommand[]> {
      await authorize(cwd, { listing: true });
      const listed = await deps.resources
        .commands(cwd)
        .catch(() => [] as SlashCommand[]);
      return rankCommands([...BUILTIN_COMMANDS, ...listed], query, {
        running: false,
      });
    },

    /** `@` completion before a session exists, containment enforced. */
    async folderFiles(
      cwd: string,
      query: string,
      path: boolean,
    ): Promise<
      { files: string[]; truncated: boolean } | { matches: FileEntry[] }
    > {
      await authorize(cwd, { listing: true });
      if (path) {
        const children = await deps.files.children(query, cwd);
        return {
          matches: children.filter((entry) => directoryWithin(cwd, entry.path)),
        };
      }
      const index = await deps.files.index(cwd);
      if (query === "") return index;
      return {
        matches: filterFileEntries(buildEntriesFromFiles(index.files), query),
      };
    },

    // --- Project trust ----------------------------------------------------

    trustStatus(cwd: string) {
      return deps.trust.status(cwd);
    },

    /**
     * Granting trust rebuilds the folder's sessions: a session started while
     * the project was untrusted is running without its extensions, and only a
     * restart can load them. A session mid-turn blocks the change.
     */
    async trustProject(cwd: string): Promise<void> {
      const status = await deps.trust.status(cwd);
      if (!status.requiresTrust) {
        throw new Error("This project has no resources that require trust");
      }
      const inFolder = (await deps.sessions.list()).filter((session) =>
        samePath(session.cwd, cwd),
      );
      const running = inFolder
        .map((session) => deps.runtime.get(session.id))
        .filter((live) => live !== undefined);
      if (running.some((live) => live.snapshot().status.running)) {
        throw new Error(
          "Wait for the active session to finish before trusting this project",
        );
      }
      await deps.trust.trust(cwd);
      deps.models.invalidate(cwd);
      // Stopped here, reopened on the next use, with project resources loaded.
      for (const live of running) await live.stop();
    },

    // --- Skills -----------------------------------------------------------

    skills(cwd: string): Promise<{
      skills: SkillInfo[];
      diagnostics: string[];
      projectResourcesLoaded: boolean;
    }> {
      return deps.skills.list(cwd);
    },

    /**
     * The skill file is the reader's own Markdown; only the one frontmatter
     * line changes. It may sit outside every allowed root, because global
     * skills live in Pi's agent directory.
     */
    async toggleSkill(
      cwd: string,
      filePath: string,
      disable: boolean,
    ): Promise<SkillInfo | undefined> {
      const { skills } = await deps.skills.list(cwd);
      const known = skills.some((skill) => skill.filePath === filePath);
      if (!known) throw new FileAccessError("Unknown skill", 404);
      await deps.skills.setDisabled(filePath, disable);
      const refreshed = await deps.skills.list(cwd);
      return refreshed.skills.find((skill) => skill.filePath === filePath);
    },

    searchSkills(query: string, limit: number): Promise<SkillSearchHit[]> {
      return deps.skills.search(query, limit);
    },

    async installSkill(
      cwd: string,
      pkg: string,
      scope: SkillScope,
    ): Promise<string> {
      await requireTrustedProject(cwd, scope === "project");
      return deps.skills.install(pkg, scope, cwd);
    },

    checkSkills(
      cwd: string,
      target?: { package: string; scope: SkillScope },
    ): Promise<SkillUpdate[]> {
      return deps.skills.check(cwd, target);
    },

    updateSkill(cwd: string, pkg: string, scope: SkillScope): Promise<string> {
      return deps.skills.update(cwd, pkg, scope);
    },

    // --- Extension packages ----------------------------------------------

    plugins(cwd: string): Promise<PackagesView> {
      return deps.packages.list(cwd);
    },

    /** Every action re-reads the list, so the page always shows Pi's truth. */
    async runPluginAction(
      action: "install" | "remove" | "update" | "enable" | "disable",
      request: { cwd: string; source?: string; scope: PackageScope },
    ): Promise<PackagesView> {
      await requireTrustedProject(request.cwd, request.scope === "project");
      await deps.packages.run(action, request);
      deps.models.invalidate(request.cwd);
      return deps.packages.list(request.cwd);
    },

    /**
     * Reload the resources of every live session in a folder. A plugin change
     * reaches a running session no other way: its extensions were built when
     * it started.
     */
    async reloadFolder(cwd: string): Promise<number> {
      const inFolder = (await deps.sessions.list()).filter((session) =>
        samePath(session.cwd, cwd),
      );
      const live = inFolder
        .map((session) => deps.runtime.get(session.id))
        .filter((session) => session !== undefined);
      for (const session of live) await session.reload();
      return live.length;
    },

    // --- Session inspection ----------------------------------------------

    /** Tool definitions of a running session; nothing is started to get them. */
    toolDefinitions(id: string): ToolView[] | undefined {
      return deps.runtime.get(id)?.toolDefinitions();
    },

    systemPrompt(id: string): string | undefined {
      return deps.runtime.get(id)?.systemPrompt();
    },

    async setModel(
      id: string,
      choice: {
        provider: string;
        modelId: string;
        thinkingLevel?: ThinkingLevel;
      },
    ): Promise<void> {
      await requireFolder(id);
      const live =
        deps.runtime.get(id) ?? (await deps.runtime.open({ sessionId: id }));
      await live.setModel(choice.provider, choice.modelId);
      if (choice.thinkingLevel) live.setThinkingLevel(choice.thinkingLevel);
    },

    async activate(id: string): Promise<void> {
      await requireFolder(id);
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

    async fork(
      id: string,
      entryId: string,
    ): Promise<{ id: string; text: string }> {
      await requireFolder(id);
      return deps.sessions.fork(id, entryId);
    },

    async clone(id: string, leafId?: string): Promise<string> {
      await requireFolder(id);
      return deps.sessions.clone(id, leafId);
    },

    /** Shuts the runtime down first: nothing may append during the rewrite. */
    async rewind(id: string, entryId: string): Promise<string> {
      await requireFolder(id);
      await stop(id);
      return deps.sessions.rewind(id, entryId);
    },

    /** Moves the session's leaf, opening a runtime when there is none. */
    async navigateTree(id: string, targetId: string): Promise<string> {
      await requireFolder(id);
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
