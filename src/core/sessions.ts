export type SessionSummary = {
  id: string;
  cwd: string;
  name?: string;
  createdAt: string;
  modifiedAt: string;
  fileSize: number;
  /** Set while a runtime for this session is alive in this process. */
  live?: boolean;
  /** Set while that runtime is working on a turn. */
  running?: boolean;
  /** Git top level of `cwd`, when it differs. Sessions group by this. */
  projectRoot?: string;
  /** Checked-out branch of `cwd`, when it is a worktree of `projectRoot`. */
  worktreeBranch?: string;
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

export type ProjectGroup = {
  root: string;
  label: string;
  sessions: SessionSummary[];
};

function projectLabel(root: string): string {
  const parts = root.split(/[\\/]/).filter(Boolean);
  return parts.length >= 2
    ? `${parts.at(-2) ?? ""}/${parts.at(-1) ?? ""}`
    : (parts.at(-1) ?? root);
}

/** Sidebar order: working sessions first, then live ones, then by age. */
export function compareSessions(a: SessionSummary, b: SessionSummary): number {
  const rank = (session: SessionSummary) =>
    session.running ? 0 : session.live ? 1 : 2;
  return (
    rank(a) - rank(b) || b.modifiedAt.localeCompare(a.modifiedAt) //
  );
}

/** Group by project root (the git top level when there is one). */
export function groupByProject(
  sessions: readonly SessionSummary[],
): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  for (const session of sessions) {
    const root = session.projectRoot ?? session.cwd;
    const group = groups.get(root) ?? {
      root,
      label: projectLabel(root),
      sessions: [],
    };
    group.sessions.push(session);
    groups.set(root, group);
  }
  const result = [...groups.values()];
  for (const group of result) group.sessions.sort(compareSessions);
  result.sort((a, b) => {
    const first = a.sessions[0];
    const second = b.sessions[0];
    if (!first || !second) return 0;
    return compareSessions(first, second);
  });
  return result;
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
