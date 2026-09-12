import { conversationRail, hasBranches } from "@core/conversation-rail";
import { contextUsage, type ContextUsage } from "@core/context-usage";
import { isThinkingLevel } from "@core/models";
import type {
  LiveSession,
  ModelListing,
  RuntimeEvent,
  SessionRead,
} from "@core/ports";
import {
  branchLeaves,
  branchTo,
  readStars,
  rowMetadata,
  sessionStats,
  type SessionStats,
} from "@core/session-entries";
import {
  projectKeyOf,
  recentProjects,
  selectedProject,
  type SessionRowMetadata,
  type SessionSummary,
  sessionsForProject,
} from "@core/sessions";
import {
  assistantItem,
  deferThinking,
  projectTranscript,
  type TranscriptItem,
} from "@core/transcript";
import { pageItems } from "@core/turns";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { Shared } from "./deps.ts";
import type { SessionView, SidebarView, ViewOptions } from "./views.ts";

// Persisted sessions: the sidebar, one session's page, and the edits Pi's
// SessionManager writes for us (rename, star, fork, clone, rewind).

export function sessionUseCases({
  deps,
  decorate,
  entriesOf,
  modelsFor,
  requireFolder,
  summaryOf,
  cwdOf,
}: Shared) {
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
    const settledBranch = snapshot.branch.slice(0, snapshot.turnStart);
    const settled = projectTranscript(settledBranch);
    const page = pageItems(settled.items, {
      ...options,
      entryIds: settledBranch.map((entry) => entry.id),
    });
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
    const page = pageItems(transcript.items, {
      ...options,
      entryIds: stored.branch.map((entry) => entry.id),
    });
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
      // pi-web reads context usage off the running agent, so a session
      // nothing is attached to shows no gauge, no warning tint on the
      // compact button, and no context rows in the stats popover. Without a
      // window there is nothing to measure against, which says exactly that.
      usage: contextUsage({ tokens: null, contextWindow: null }),
      models: listing.models,
      ...(model === undefined ? {} : { model }),
      ...(transcript.lastThinking !== null &&
      isThinkingLevel(transcript.lastThinking)
        ? { thinking: transcript.lastThinking }
        : {}),
      modelWarnings: listing.warnings,
      starred,
      leaves: branchLeaves(stored.entries, leafId),
      otherBranch: options.leaf !== undefined && options.leaf !== stored.leafId,
      rail: conversationRail(stored.entries, leafId, starred),
      branched: hasBranches(stored.entries),
    };
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
      const stored = await deps.sessions.list();
      const known = new Set(stored.map((session) => session.id));
      // A session Pi has not flushed yet has no file to list; its row comes
      // from the runtime, or the list would miss it until the turn ends.
      const unflushed = deps.runtime
        .live()
        .filter((live) => !known.has(live.id))
        .map((live) => live.snapshot().summary);
      const all = await decorate([...stored, ...unflushed]);
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
      const sessions = sessionsForProject(all, selected);
      return {
        projects,
        ...(selected === undefined ? {} : { selected }),
        sessions,
        activityElsewhere: projects.some(
          (project) => project.key !== selected && project.running > 0,
        ),
      };
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

    /** The working folder of a session, for the file panel's root. */
    async sessionFolder(id: string): Promise<string | undefined> {
      const cwd = await cwdOf(id);
      return cwd === "" ? undefined : cwd;
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

    /** Every session's lifecycle, for the sidebar's one shared stream. */
    subscribeSessions(listener: (event: RuntimeEvent) => void): () => void {
      return deps.runtime.subscribeAll(listener);
    },
  };
}
