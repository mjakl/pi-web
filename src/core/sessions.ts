export type SessionSummary = {
  id: string;
  cwd: string;
  name?: string;
  createdAt: string;
  modifiedAt: string;
  fileSize: number;
  /** Set while a runtime for this session is alive in this process. */
  live?: boolean;
};

export type ProjectGroup = {
  cwd: string;
  label: string;
  sessions: SessionSummary[];
};

function projectLabel(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts.length >= 2
    ? `${parts.at(-2) ?? ""}/${parts.at(-1) ?? ""}`
    : (parts.at(-1) ?? cwd);
}

/** Group by working folder; groups and sessions both newest first. */
export function groupByProject(
  sessions: readonly SessionSummary[],
): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  for (const session of sessions) {
    const group = groups.get(session.cwd) ?? {
      cwd: session.cwd,
      label: projectLabel(session.cwd),
      sessions: [],
    };
    group.sessions.push(session);
    groups.set(session.cwd, group);
  }
  const byNewest = (a: SessionSummary, b: SessionSummary) =>
    b.modifiedAt.localeCompare(a.modifiedAt);
  const result = [...groups.values()];
  for (const group of result) group.sessions.sort(byNewest);
  result.sort((a, b) => {
    const first = a.sessions[0];
    const second = b.sessions[0];
    if (!first || !second) return 0;
    return byNewest(first, second);
  });
  return result;
}

const SESSION_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

/** Ids come from URLs; keep them to the shape Pi writes into headers. */
export function isSessionId(value: unknown): value is string {
  return (
    typeof value === "string" && value.length <= 128 && SESSION_ID.test(value)
  );
}
