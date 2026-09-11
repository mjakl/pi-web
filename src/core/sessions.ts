export type SessionSummary = {
  id: string;
  cwd: string;
  name?: string;
  createdAt: string;
  modifiedAt: string;
  fileSize: number;
  /** Set while a runtime for this session is alive in this process. */
  live?: boolean;
  /** False when the working folder is gone: the session is read-only. */
  cwdAvailable?: boolean;
  /** Set while that runtime is working on a turn. */
  running?: boolean;
  /** Git top level of `cwd`, when it differs. Sessions group by this. */
  projectRoot?: string;
  /** Checked-out branch of `cwd`, when it is a worktree of `projectRoot`. */
  worktreeBranch?: string;
  /** Id of the session this one was forked from, when the header names one. */
  parentId?: string;
  /** The JSONL Pi keeps this conversation in; shown in the statistics panel. */
  filePath?: string;
};

/** What a sidebar row shows once its file has been read. */
export type SessionRowMetadata = {
  name?: string;
  firstMessage: string;
  messageCount: number;
  starCount: number;
  modifiedAt: string;
  fileSize: number;
};

/** One project in the workspace selector, with the activity it holds. */
export type ProjectEntry = {
  key: string;
  label: string;
  /** Newest session of the project: the selector's order. */
  modifiedAt: string;
  running: number;
  /**
   * The folder to probe for worktrees: the newest session's own, which is a
   * checkout that still exists more often than the repository root is.
   */
  entryPath: string;
};

function projectLabel(root: string): string {
  const parts = root.split(/[\\/]/).filter(Boolean);
  return parts.length >= 2
    ? `${parts.at(-2) ?? ""}/${parts.at(-1) ?? ""}`
    : (parts.at(-1) ?? root);
}

/** Sessions group by the git top level of their folder, else by the folder. */
export function projectKeyOf(session: SessionSummary): string {
  return session.projectRoot ?? session.cwd;
}

/**
 * pi-subagent writes each run as its own session file named
 * `<timestamp>_subagent.<hex>.jsonl`, so its id is `subagent.<hex>`. They are
 * transcripts of a tool call, not conversations somebody started.
 */
export function isSubagentSession(summary: SessionSummary): boolean {
  return summary.id.startsWith("subagent.");
}

/** Sidebar order: working sessions first, then live ones, then by age. */
export function compareSessions(a: SessionSummary, b: SessionSummary): number {
  const rank = (session: SessionSummary) =>
    session.running ? 0 : session.live ? 1 : 2;
  return (
    rank(a) - rank(b) || b.modifiedAt.localeCompare(a.modifiedAt) //
  );
}

/** One entry per project, newest first; the selector lists these. */
export function recentProjects(
  sessions: readonly SessionSummary[],
): ProjectEntry[] {
  const byKey = new Map<string, ProjectEntry>();
  for (const session of sessions) {
    const key = projectKeyOf(session);
    const entry = byKey.get(key) ?? {
      key,
      label: projectLabel(key),
      modifiedAt: session.modifiedAt,
      running: 0,
      entryPath: session.cwd,
    };
    if (session.modifiedAt >= entry.modifiedAt) {
      entry.modifiedAt = session.modifiedAt;
      entry.entryPath = session.cwd;
    }
    if (session.running) entry.running += 1;
    byKey.set(key, entry);
  }
  return [...byKey.values()].sort((a, b) =>
    b.modifiedAt.localeCompare(a.modifiedAt),
  );
}

/**
 * Which project the sidebar shows: the one the open session belongs to, else
 * the remembered choice while it still exists, else the most recent.
 */
export function selectedProject(
  projects: readonly ProjectEntry[],
  options: { active?: string; remembered?: string } = {},
): string | undefined {
  if (options.active !== undefined) return options.active;
  const remembered = options.remembered;
  if (remembered !== undefined && projects.some((p) => p.key === remembered)) {
    return remembered;
  }
  return projects[0]?.key;
}

/** The visible list: one project's own sessions, in sidebar order. */
export function sessionsForProject(
  sessions: readonly SessionSummary[],
  key: string | undefined,
): SessionSummary[] {
  return sessions
    .filter((session) => key === undefined || projectKeyOf(session) === key)
    .sort(compareSessions);
}

/** Row title: the name, else the start of the first message, else the id. */
export function sessionTitle(
  summary: SessionSummary,
  metadata?: SessionRowMetadata,
): string {
  const name = (metadata?.name ?? summary.name ?? "").trim();
  if (name) return name;
  const first = (metadata?.firstMessage ?? "").replaceAll(/\s+/g, " ").trim();
  if (first) return first.slice(0, 50);
  return summary.id.slice(0, 12);
}

const MINUTE = 60_000;
const UNITS: [limit: number, size: number, suffix: string][] = [
  [60 * MINUTE, MINUTE, "m"],
  [24 * 60 * MINUTE, 60 * MINUTE, "h"],
  [30 * 24 * 60 * MINUTE, 24 * 60 * MINUTE, "d"],
];

/** Compact age for sidebar rows: "now", "12m", "3h", "5d", else a date. */
export function relativeTime(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const elapsed = Math.max(0, now - then);
  if (elapsed < MINUTE) return "now";
  for (const [limit, size, suffix] of UNITS) {
    if (elapsed < limit)
      return `${String(Math.floor(elapsed / size))}${suffix}`;
  }
  return new Date(then).toISOString().slice(0, 10);
}

const SESSION_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

/** Ids come from URLs; keep them to the shape Pi writes into headers. */
export function isSessionId(value: unknown): value is string {
  return (
    typeof value === "string" && value.length <= 128 && SESSION_ID.test(value)
  );
}
