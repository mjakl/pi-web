import {
  type ProjectEntry,
  relativeTime,
  type SessionRowMetadata,
  sessionTitle,
  type SessionSummary,
} from "@core/sessions";
import type { SidebarView } from "@core/workspace";
import {
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  SettingsSectionIcon,
  SmallChevronIcon,
} from "./icons.tsx";

// The sidebar: pi-web's header block, workspace pill, session list and
// explorer section (components/SessionSidebar.tsx §3.1). The rows inside the
// list are still web-pi's own markup — the sidebar area rebuilds them on
// pi-web's 54px SessionItem.

export type Row = { summary: SessionSummary; metadata?: SessionRowMetadata };

function Indicator({ summary }: { summary: SessionSummary }) {
  const [label, colour] = summary.running
    ? ["Agent running", "var(--accent)"]
    : summary.live
      ? ["Session active", "var(--success)"]
      : ["Session stopped", "var(--text-dim)"];
  return (
    <span
      style={`width:6px; height:6px; border-radius:50%; flex-shrink:0; background:${colour}`}
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
  const klass = props.danger ? "menu-item menu-item-danger" : "menu-item";
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

/* TODO(sidebar): pi-web's row menu is a native popover placed by JS, 144px
   wide with 34px items (gap K2). */
function RowMenu({ summary, metadata }: Row) {
  const id = summary.id;
  const target = `#row-${id}`;
  return (
    <details>
      <summary aria-label={`Actions for ${sessionTitle(summary, metadata)}`}>
        ⋯
      </summary>
      <ul class="menu-surface">
        <li>
          <form
            hx-post={`/sessions/${id}/rename`}
            hx-target={target}
            hx-swap="outerHTML"
          >
            <input
              name="name"
              value={metadata?.name ?? summary.name ?? ""}
              placeholder="Rename…"
              aria-label={`Rename ${sessionTitle(summary, metadata)}`}
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
  const selected = id === activeId;
  return (
    <li
      id={`row-${id}`}
      class="session-row"
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
      style={`display:flex; align-items:center; gap:6px; padding-left:14px; padding-right:8px; border-left:2px solid ${selected ? "var(--accent)" : "transparent"}; ${selected ? "background:var(--bg-selected);" : ""}`}
    >
      <a
        href={`/sessions/${id}`}
        style="display:flex; min-width:0; flex:1; flex-direction:column; gap:2px; padding:6px 0; color:inherit; text-decoration:none"
      >
        <span style="display:flex; min-width:0; align-items:center; gap:6px; font-size:12px; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap">
          <span class="unread-dot" hidden title="New activity" />
          {title}
        </span>
        <span style="display:flex; align-items:center; gap:8px; font-size:11px; color:var(--text-dim)">
          <Indicator summary={summary} />
          <span title={summary.modifiedAt}>
            {relativeTime(summary.modifiedAt)}
          </span>
          {pending ? (
            <span role="status">…</span>
          ) : (
            <>
              <span class="session-counts">
                {String(metadata.messageCount)} msgs
              </span>
              {metadata.starCount > 0 ? (
                <span
                  class="session-star-count"
                  title={`${String(metadata.starCount)} starred answers`}
                >
                  ★ {String(metadata.starCount)}
                </span>
              ) : null}
            </>
          )}
          {summary.worktreeBranch ? (
            <span style="color:var(--accent)">{summary.worktreeBranch}</span>
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
    <li style="padding-left:14px; font-size:11px; color:var(--text-dim)">
      <details>
        <summary
          hx-get={`/sidebar/subagents?${query.toString()}`}
          hx-trigger="click once"
          hx-target="next ul"
          hx-swap="innerHTML"
        >
          {String(count)} subagent run{count === 1 ? "" : "s"}
        </summary>
        <ul>
          <li role="status">Loading…</li>
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
          style="padding:8px 12px; font-size:11px; color:var(--text-dim)"
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
      style="flex:1 1 auto; overflow-y:auto; min-height:80px; margin:0; padding:0; list-style:none"
      {...(oob ? { "hx-swap-oob": "innerHTML" } : {})}
    >
      {view.sessions.length === 0 && view.orphans === 0 ? (
        <li style="padding:16px 14px; font-size:12px; color:var(--text-muted)">
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

/**
 * The workspace pill and the menu it anchors: a native popover positioned by
 * CSS anchor positioning (§3.1, §1.9). The list is fetched when the popover
 * opens — a real store holds hundreds of projects.
 */
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
  const cwd = view.selected ?? "";
  return (
    <div style="position:relative" {...(oob ? { "hx-swap-oob": "true" } : {})}>
      <button
        type="button"
        id="project-select"
        class="anchor-sidebar-project"
        popovertarget="sidebar-project-menu"
        data-project-key={cwd}
        title={cwd === "" ? "No project" : cwd}
        style={`width:100%; display:flex; align-items:center; padding:6px 10px; background:${cwd === "" ? "rgba(37,99,235,0.06)" : "var(--bg-hover)"}; border:1px solid ${cwd === "" ? "rgba(37,99,235,0.4)" : "var(--border)"}; border-radius:7px; cursor:pointer; font-size:12px; color:var(--text); text-align:left; transition:border-color 0.15s, background 0.15s`}
      >
        <PathLabel
          text={current?.label ?? "Select a project"}
          dim={cwd === ""}
        />
        <span
          id="project-activity"
          title="Activity in another project"
          style="width:8px; height:8px; border-radius:50%; flex-shrink:0; margin-left:6px; background:var(--accent)"
          hidden={!view.activityElsewhere}
        />
      </button>
      <div
        id="sidebar-project-menu"
        class="anchored-menu menu-surface opens-down menu-sidebar-project"
        popover="auto"
        style="z-index:100; overflow:hidden"
        hx-get="/sidebar/projects"
        hx-trigger="toggle once"
        hx-swap="innerHTML"
      >
        <p
          style="padding:8px 10px; font-size:11px; color:var(--text-dim)"
          role="status"
        >
          Loading projects…
        </p>
      </div>
    </div>
  );
}

/**
 * pi-web's PathLabel: right-to-left text so a long path keeps its tail and
 * loses its head to the ellipsis.
 */
function PathLabel({ text, dim }: { text: string; dim?: boolean }) {
  return (
    <span
      style={`flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:block; min-width:0; line-height:1.35; direction:rtl; text-align:left; font-family:var(--font-mono); font-size:11px; color:var(${dim ? "--text-dim" : "--text"})`}
    >
      <span style="unicode-bidi:plaintext">{text}</span>
    </span>
  );
}

/** The menu's contents: every project, with a filter box once there are many. */
export function ProjectPicker({ view }: { view: SidebarView }) {
  return (
    <>
      {view.projects.length > FILTER_FROM ? (
        <div style="padding:6px 8px; border-bottom:1px solid var(--border)">
          <input
            id="project-filter"
            class="menu-filter"
            type="search"
            placeholder="Filter projects…"
            aria-label="Filter projects"
          />
        </div>
      ) : null}
      <div style="max-height:min(50vh, 380px); overflow-y:auto">
        <ul style="margin:0; padding:0; list-style:none">
          {view.projects.map((project) => (
            <ProjectRow
              project={project}
              selected={project.key === view.selected}
            />
          ))}
        </ul>
        <p
          id="project-empty"
          style="padding:8px 10px; font-size:11px; color:var(--text-dim)"
          hidden
        >
          No matching projects
        </p>
      </div>
      <button
        type="button"
        class="menu-item"
        hx-get="/workspaces/picker"
        hx-target="#dialogs"
        hx-swap="innerHTML"
      >
        Custom path…
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
        class="menu-item"
        aria-current={selected ? "true" : "false"}
        title={project.key}
        hx-get={`/sidebar?project=${encodeURIComponent(project.key)}`}
        hx-target="#project-nav"
        hx-swap="outerHTML"
      >
        <span class="project-folder-label">{project.label}</span>
        {project.running > 0 ? (
          <span title={`${String(project.running)} running`}>
            {String(project.running)}
          </span>
        ) : null}
        <span
          class="project-unread"
          title="Finished while you were elsewhere"
          hidden
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
      style="display:flex; min-height:0; flex:1 1 auto; flex-direction:column"
      hx-ext="sse"
      sse-connect="/events"
      sse-swap="rows"
      hx-swap="none"
    >
      <SessionList view={view} activeId={activeId} />
      {/* Filled by the global stream with the session whose turn just
          finished; src/web/client/sidebar.ts turns that into an unread dot. */}
      <div
        id="session-finished"
        sse-swap="finished"
        hx-swap="innerHTML"
        hidden
      />
    </div>
  );
}

/**
 * The explorer section at the foot of the sidebar (§3.5). The tree itself is
 * fetched by the files area's routes and rendered into `#file-explorer`.
 */
function ExplorerSection({
  sessionId,
  cwd,
}: {
  sessionId: string;
  cwd: string;
}) {
  const explorerUrl = `/files/explorer?session=${encodeURIComponent(sessionId)}`;
  return (
    <div
      id="explorer-section"
      style="border-top:1px solid var(--border); display:flex; flex-direction:column; flex:1 1 0; min-height:0; overflow:hidden"
    >
      <div style="display:flex; align-items:center; flex-shrink:0">
        <button
          type="button"
          id="explorer-toggle"
          aria-expanded="true"
          aria-controls="explorer-body"
          style="display:flex; align-items:center; gap:6px; flex:1; padding:6px 10px; background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:11px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; text-align:left"
        >
          <span
            data-explorer-chevron
            style="display:flex; transform:rotate(90deg); transition:transform 0.15s"
          >
            <SmallChevronIcon />
          </span>
          Explorer
        </button>
        {/* TODO(sidebar): pi-web toggles the search field from this button and
            adds a changed-files toggle beside it (gap B8). */}
        <button
          type="button"
          class="sidebar-toolbar-button"
          id="explorer-search-toggle"
          aria-pressed="false"
          title="Search files"
          aria-label="Search files"
        >
          <SearchIcon />
        </button>
        <button
          type="button"
          class="sidebar-toolbar-button"
          style="margin-right:6px"
          title="Refresh the file list"
          aria-label="Refresh the file list"
          hx-get={explorerUrl}
          hx-target="#file-explorer"
          hx-swap="innerHTML"
        >
          <RefreshIcon size={13} width={2} />
        </button>
      </div>
      <div
        id="explorer-body"
        style="flex:1; overflow-y:auto; overflow-x:hidden"
      >
        <input
          id="file-search"
          type="search"
          name="q"
          placeholder="Search files"
          aria-label="Search files"
          autocomplete="off"
          style="width:calc(100% - 20px); margin:0 10px 4px; padding:4px 8px; border:1px solid var(--border); border-radius:5px; background:var(--bg); color:var(--text); font-family:var(--font-mono); font-size:11px"
          hx-get={`/files/search?session=${encodeURIComponent(sessionId)}`}
          hx-trigger="input changed delay:150ms, search"
          hx-target="#file-tree"
          hx-swap="outerHTML"
        />
        <div
          id="file-explorer"
          class="explorer"
          data-cwd={cwd}
          hx-get={explorerUrl}
          hx-trigger="revealed, sse:settled"
          hx-swap="innerHTML"
        />
      </div>
    </div>
  );
}

export function Sidebar({
  view,
  activeId,
  cwd,
}: {
  view: SidebarView;
  activeId?: string;
  cwd?: string;
}) {
  return (
    <div
      id="sidebar"
      style="display:flex; flex-direction:column; height:100%; overflow:hidden"
    >
      <div style="padding:12px 10px 10px; border-bottom:1px solid var(--border); flex-shrink:0">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px">
          <span style="font-weight:700; font-size:15px; letter-spacing:-0.01em; color:var(--text); font-family:var(--font-mono); min-width:6ch">
            Pi Web
          </span>
          <div style="display:flex; gap:6px">
            <a
              class="sidebar-icon-button"
              href="/new"
              title="New session (Ctrl+K)"
              aria-label="New session"
              aria-keyshortcuts="Meta+K Control+K"
            >
              <PlusIcon />
            </a>
            {/* The list is pushed by the shared stream; this is for a session
                started in the terminal, which nothing here can hear about. */}
            <button
              type="button"
              id="sidebar-refresh"
              class="sidebar-icon-button"
              title="Refresh the session list"
              aria-label="Refresh the session list"
              hx-get="/sidebar"
              hx-target="#project-nav"
              hx-swap="outerHTML"
            >
              <RefreshIcon size={15} width={2} />
            </button>
            <a
              class="sidebar-icon-button"
              href="/settings"
              title="Settings"
              aria-label="Settings"
            >
              <SettingsSectionIcon section="general" size={15} width={2} />
            </a>
          </div>
        </div>
        <ProjectSelect view={view} />
      </div>
      <ProjectNav view={view} activeId={activeId} />
      {activeId !== undefined && cwd !== undefined ? (
        <ExplorerSection sessionId={activeId} cwd={cwd} />
      ) : null}
    </div>
  );
}
