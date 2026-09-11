import {
  type ProjectEntry,
  relativeTime,
  type SessionRowMetadata,
  sessionTitle,
  type SessionSummary,
} from "@core/sessions";
import type { SidebarView } from "@core/workspace";

// The session list of one project. Rows arrive as placeholders and fetch their
// own counts when they scroll into view, so opening a store with thousands of
// sessions costs one header read per file and nothing else. The project
// selector above it is what keeps the page small: a real store holds hundreds
// of projects, and a reader works in one.

export type Row = { summary: SessionSummary; metadata?: SessionRowMetadata };

function Indicator({ summary }: { summary: SessionSummary }) {
  const [label, klass] = summary.running
    ? ["Agent running", "status-primary animate-pulse"]
    : summary.live
      ? ["Session active", "status-success"]
      : ["Session stopped", "status-neutral opacity-40"];
  return (
    <span
      class={`status status-sm ${klass}`}
      title={label}
      aria-label={label}
    />
  );
}

function MenuItem(props: {
  label: string;
  post?: string;
  href?: string;
  danger?: boolean;
  confirm?: string;
  target: string;
}) {
  const klass = props.danger ? "text-error" : "";
  if (props.href) {
    return (
      <li>
        <a href={props.href} target="_blank" rel="noreferrer" class={klass}>
          {props.label}
        </a>
      </li>
    );
  }
  return (
    <li>
      <button
        type="button"
        class={klass}
        hx-post={props.post}
        hx-target={props.target}
        hx-swap="outerHTML"
        {...(props.confirm ? { "hx-confirm": props.confirm } : {})}
      >
        {props.label}
      </button>
    </li>
  );
}

function RowMenu({ summary, metadata }: Row) {
  const id = summary.id;
  const target = `#row-${id}`;
  return (
    <details class="dropdown dropdown-end">
      <summary
        class="btn btn-square btn-ghost btn-xs"
        aria-label={`Actions for ${sessionTitle(summary, metadata)}`}
      >
        ⋯
      </summary>
      <ul class="menu dropdown-content z-10 w-52 rounded-box bg-base-100 p-1 text-sm shadow">
        <li>
          <form
            hx-post={`/sessions/${id}/rename`}
            hx-target={target}
            hx-swap="outerHTML"
            class="p-1"
          >
            <input
              name="name"
              value={metadata?.name ?? summary.name ?? ""}
              placeholder="Rename…"
              aria-label={`Rename ${sessionTitle(summary, metadata)}`}
              class="input w-full input-xs"
            />
          </form>
        </li>
        {summary.live ? (
          <MenuItem
            label="Stop"
            post={`/sessions/${id}/stop`}
            target={target}
          />
        ) : (
          <MenuItem
            label="Activate"
            post={`/sessions/${id}/activate`}
            target={target}
          />
        )}
        {metadata && metadata.starCount > 0 ? (
          <MenuItem
            label="Clear all stars"
            post={`/sessions/${id}/stars/clear`}
            target={target}
          />
        ) : null}
        <MenuItem
          label="Clone branch"
          post={`/sessions/${id}/clone`}
          target={target}
        />
        <MenuItem
          label="Full history"
          href={`/sessions/${id}/export`}
          target={target}
        />
        <MenuItem
          label="Delete"
          post={`/sessions/${id}/delete`}
          target={target}
          confirm="Delete this session and its transcript?"
          danger
        />
      </ul>
    </details>
  );
}

/** One sidebar row. Without metadata it loads its own when revealed. */
export function SessionRow({
  summary,
  metadata,
  activeId,
  oob,
}: Row & { activeId?: string; oob?: boolean }) {
  const id = summary.id;
  const title = sessionTitle(summary, metadata);
  const pending = metadata === undefined;
  return (
    <li
      id={`row-${id}`}
      data-session-id={id}
      data-title={title.toLowerCase()}
      {...(oob ? { "hx-swap-oob": "true" } : {})}
      {...(pending
        ? {
            "hx-get": `/sessions/${id}/row`,
            "hx-trigger": "revealed",
            "hx-swap": "outerHTML",
          }
        : {})}
      class="flex items-center gap-1 px-1"
    >
      <a
        href={`/sessions/${id}`}
        class={`flex min-w-0 flex-1 flex-col gap-0.5 rounded px-2 py-1 hover:bg-base-300 ${
          id === activeId ? "bg-base-300 font-medium" : ""
        }`}
      >
        <span class="flex min-w-0 items-center gap-1">
          <span
            class="unread-dot hidden size-1.5 shrink-0 rounded-full bg-info"
            title="New activity"
          />
          <span class="truncate text-sm">{title}</span>
        </span>
        <span class="flex items-center gap-2 text-xs text-base-content/60">
          <Indicator summary={summary} />
          <span title={summary.modifiedAt}>
            {relativeTime(summary.modifiedAt)}
          </span>
          {pending ? (
            <span role="status">…</span>
          ) : (
            <>
              <span>{String(metadata.messageCount)} msgs</span>
              {metadata.starCount > 0 ? (
                <span title={`${String(metadata.starCount)} starred answers`}>
                  ★ {String(metadata.starCount)}
                </span>
              ) : null}
            </>
          )}
          {summary.worktreeBranch ? (
            <span class="badge badge-ghost badge-xs">
              {summary.worktreeBranch}
            </span>
          ) : null}
        </span>
      </a>
      {pending ? null : <RowMenu summary={summary} metadata={metadata} />}
    </li>
  );
}

/**
 * The runs a `subagent` tool call spawned. They are transcripts of a tool
 * call, not conversations, so they stay folded away and load only when the
 * line is opened: a real store holds more of them than of real sessions.
 */
function SubagentRuns({
  project,
  parentId,
  count,
}: {
  project: string;
  parentId?: string;
  count: number;
}) {
  const query = new URLSearchParams({ project });
  if (parentId !== undefined) query.set("parent", parentId);
  return (
    <li class="px-1">
      <details class="pl-6">
        <summary
          class="cursor-pointer py-1 text-xs text-base-content/50"
          hx-get={`/sidebar/subagents?${query.toString()}`}
          hx-trigger="click once"
          hx-target="next ul"
          hx-swap="innerHTML"
        >
          {String(count)} subagent run{count === 1 ? "" : "s"}
        </summary>
        <ul class="flex flex-col">
          <li class="px-2 py-1 text-xs text-base-content/40" role="status">
            Loading…
          </li>
        </ul>
      </details>
    </li>
  );
}

/**
 * Rows sent on the first render. A busy project holds hundreds of sessions
 * and the reader sees ten; the rest arrive on the same sentinel the
 * transcript pages with.
 */
export const SIDEBAR_PAGE = 50;

/** One page of rows, plus the sentinel that fetches the page after it. */
export function SessionRows({
  view,
  activeId,
  offset = 0,
}: {
  view: SidebarView;
  activeId?: string;
  offset?: number;
}) {
  const project = view.selected ?? "";
  const page = view.sessions.slice(offset, offset + SIDEBAR_PAGE);
  const next = offset + SIDEBAR_PAGE;
  const more = next < view.sessions.length;
  const query = new URLSearchParams({ project, after: String(next) });
  return (
    <>
      {page.map((row) => (
        <>
          <SessionRow summary={row.summary} activeId={activeId} />
          {row.subagents > 0 ? (
            <SubagentRuns
              project={project}
              parentId={row.summary.id}
              count={row.subagents}
            />
          ) : null}
        </>
      ))}
      {more ? (
        <li
          class="px-3 py-2 text-xs text-base-content/50"
          hx-get={`/sidebar/rows?${query.toString()}`}
          hx-trigger="intersect once"
          hx-target="this"
          hx-swap="outerHTML"
        >
          Loading more sessions…
        </li>
      ) : null}
    </>
  );
}

export function SessionList({
  view,
  activeId,
  oob,
}: {
  view: SidebarView;
  activeId?: string;
  oob?: boolean;
}) {
  return (
    <ul
      id="session-list"
      class="min-h-0 flex-1 overflow-y-auto"
      {...(oob ? { "hx-swap-oob": "innerHTML" } : {})}
    >
      {view.sessions.length === 0 && view.orphans === 0 ? (
        <li class="px-3 py-2 text-xs text-base-content/50">
          No sessions in this project yet.
        </li>
      ) : null}
      {/* Runs with no parent session to hang under stay at the top, where
          they are reachable without paging through the whole project. */}
      {view.orphans > 0 ? (
        <SubagentRuns project={view.selected ?? ""} count={view.orphans} />
      ) : null}
      <SessionRows
        view={view}
        {...(activeId === undefined ? {} : { activeId })}
      />
    </ul>
  );
}

/** How many projects it takes before the selector needs a filter box. */
const FILTER_FROM = 8;

export function ProjectSelect({
  view,
  oob,
}: {
  view: SidebarView;
  oob?: boolean;
}) {
  const current = view.projects.find(
    (project) => project.key === view.selected,
  );
  return (
    <details
      id="project-select"
      class="dropdown w-full"
      data-project-key={view.selected ?? ""}
      {...(oob ? { "hx-swap-oob": "true" } : {})}
    >
      <summary
        class="btn w-full justify-between btn-ghost btn-sm"
        title={view.selected ?? "No project"}
      >
        <span class="truncate">{current?.label ?? "No project"}</span>
        <span
          id="project-activity"
          class="size-1.5 shrink-0 rounded-full bg-info"
          title="Activity in another project"
          hidden={!view.activityElsewhere}
        />
      </summary>
      {/* A real store holds hundreds of projects: the list is fetched when the
          selector opens rather than shipped with every page. */}
      <div
        class="dropdown-content z-20 max-h-96 w-72 overflow-y-auto rounded-box bg-base-100 p-1 shadow"
        hx-get="/sidebar/projects"
        hx-trigger="toggle once from:closest details"
        hx-swap="innerHTML"
      >
        <p class="px-3 py-2 text-xs text-base-content/50" role="status">
          Loading projects…
        </p>
      </div>
    </details>
  );
}

/** The selector's contents: every project, with a filter box once there are many. */
export function ProjectPicker({ view }: { view: SidebarView }) {
  return (
    <>
      {view.projects.length > FILTER_FROM ? (
        <input
          id="project-filter"
          type="search"
          placeholder="Filter projects"
          aria-label="Filter projects"
          class="input mb-1 w-full input-xs"
        />
      ) : null}
      <ul class="menu w-full flex-nowrap p-0 text-sm">
        {view.projects.map((project) => (
          <ProjectRow
            project={project}
            selected={project.key === view.selected}
          />
        ))}
      </ul>
      <p
        id="project-empty"
        class="px-3 py-2 text-xs text-base-content/50"
        hidden
      >
        No matching projects
      </p>
      <button
        type="button"
        class="btn mt-1 w-full btn-ghost btn-xs"
        hx-get="/workspaces/picker"
        hx-target="#dialogs"
        hx-swap="innerHTML"
      >
        Change folder…
      </button>
    </>
  );
}

function ProjectRow({
  project,
  selected,
}: {
  project: ProjectEntry;
  selected: boolean;
}) {
  return (
    <li data-project-key={project.key}>
      <button
        type="button"
        class={selected ? "menu-active" : ""}
        title={project.key}
        hx-get={`/sidebar?project=${encodeURIComponent(project.key)}`}
        hx-target="#project-nav"
        hx-swap="outerHTML"
      >
        <span class="min-w-0 flex-1 truncate">{project.label}</span>
        {project.running > 0 ? (
          <span
            class="badge badge-xs badge-primary"
            title={`${String(project.running)} running`}
          >
            {String(project.running)}
          </span>
        ) : null}
        <span
          class="project-unread badge hidden badge-xs badge-info"
          title="Finished while you were elsewhere"
        />
      </button>
    </li>
  );
}

/**
 * The project selector and its list. One element, because the shared stream
 * lives on it: switching project replaces it, which reconnects the stream and
 * makes it push rows for the new project.
 */
export function ProjectNav({
  view,
  activeId,
}: {
  view: SidebarView;
  activeId?: string;
}) {
  return (
    <div
      id="project-nav"
      class="flex min-h-0 flex-1 flex-col"
      hx-ext="sse"
      sse-connect="/events"
      sse-swap="rows"
      hx-swap="none"
    >
      <div class="px-2 pb-1">
        <ProjectSelect view={view} />
      </div>
      <SessionList view={view} activeId={activeId} />
      {/* Filled by the global stream with the session whose turn just
          finished; src/web/client/main.ts turns that into an unread dot. */}
      <div
        id="session-finished"
        sse-swap="finished"
        hx-swap="innerHTML"
        hidden
      />
    </div>
  );
}

function Footer() {
  return (
    <div class="flex items-center gap-2 border-t border-base-300 px-3 py-2 text-xs">
      <span class="text-base-content/60">Theme</span>
      {/* Wired up by src/web/client/main.ts; without it the system theme wins. */}
      <select id="theme-select" class="select select-xs" aria-label="Theme">
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
      <span class="flex-1" />
      <a href="/settings" class="btn btn-ghost btn-xs" title="Settings">
        ⚙
      </a>
    </div>
  );
}

export function Sidebar({
  view,
  activeId,
}: {
  view: SidebarView;
  activeId?: string;
}) {
  return (
    <aside
      id="sidebar"
      class="flex h-full w-72 flex-col border-r border-base-300 bg-base-200"
    >
      <div class="flex items-center justify-between px-3 py-2">
        <a href="/" class="font-semibold">
          Pi
        </a>
        <a
          href="/new"
          class="btn btn-primary btn-xs"
          title="New session (Ctrl+K)"
        >
          New
        </a>
      </div>
      <div class="px-3 pb-2">
        <input
          id="session-filter"
          type="search"
          placeholder="Filter sessions"
          aria-label="Filter sessions"
          class="input w-full input-xs"
        />
      </div>
      <ProjectNav view={view} activeId={activeId} />
      <Footer />
    </aside>
  );
}
