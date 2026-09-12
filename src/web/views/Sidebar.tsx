import {
  type ProjectEntry,
  relativeTime,
  type SessionRowMetadata,
  sessionTitle,
  type SessionSummary,
} from "@core/sessions";
import { Partial } from "@web/views/Partial";
import type { SidebarView } from "@core/workspace";
import { shortPath } from "@core/workspaces";
import {
  ActiveDotIcon,
  BranchBadgeIcon,
  ChangedFilesIcon,
  CheckIcon,
  ChevronRightIcon,
  MoreDotsIcon,
  PlusIcon,
  ProjectFolderIcon,
  RefreshIcon,
  SearchIcon,
  SettingsSectionIcon,
  SmallChevronIcon,
  SmallPlusIcon,
  SpinnerIcon,
  StarIcon,
  StoppedRingIcon,
} from "./icons.tsx";

// The sidebar: pi-web's header block, workspace pill, 54px session rows and
// explorer section (components/SessionSidebar.tsx §3.1, SessionItem.tsx §3.4,
// ProjectFolderGroup.tsx §3.3). Inline styles are pi-web's own objects with
// camelCase turned to kebab and numbers to px; the class names are what its
// stylesheets key on.

export type Row = { summary: SessionSummary; metadata?: SessionRowMetadata };

/** pi-web's SESSION_ITEM_HEIGHT. */
const ROW_HEIGHT = 54;

/** The last path segment, which is what pi-web labels a project with. */
function baseName(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() ?? path
  );
}

/**
 * Running, live or stopped (§3.4). The unread halo is a browser concern —
 * which turns finished while the reader was elsewhere is in localStorage —
 * so `client/sidebar.ts` adds `.session-indicator-unread` and the `--info`
 * tint on top of what is rendered here.
 */
function SessionIndicator({ summary }: { summary: SessionSummary }) {
  const [label, colour, icon] = summary.running
    ? (["Agent running…", "var(--accent)", <SpinnerIcon />] as const)
    : summary.live
      ? (["Session active", "var(--success)", <ActiveDotIcon />] as const)
      : (["Session stopped", "var(--text-dim)", <StoppedRingIcon />] as const);
  return (
    <span
      class="session-indicator"
      data-status={label}
      /* The unread tint is the browser's (client/sidebar.ts): pi-web renders
         --info in place of this colour, so the state's own colour has to
         survive being painted over. */
      data-colour={colour}
      title={label}
      aria-label={label}
      style={`width:14px; height:14px; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; color:${colour}`}
    >
      {icon}
    </span>
  );
}

function RowMenu({ summary, metadata }: Row) {
  const id = summary.id;
  const target = `#row-${id}`;
  const item = (label: string, path: string, danger?: boolean) => (
    <button
      type="button"
      class={danger === true ? "menu-item menu-item-danger" : "menu-item"}
      hx-post={`/sessions/${id}/${path}`}
      hx-target={target}
      hx-swap="outerHTML"
      {...(danger === true
        ? { "hx-confirm": "Delete this session and its transcript?" }
        : {})}
    >
      {label}
    </button>
  );
  return (
    <div
      id={`row-menu-${id}`}
      class="menu-surface"
      popover="auto"
      role="group"
      aria-label={`Session actions for ${sessionTitle(summary, metadata)}`}
      /* inset/margin reset the UA popover sheet, which centres itself and
         would ignore the top/left client/sidebar.ts measures. */
      style="position:fixed; inset:auto; margin:0; z-index:1000; width:min(144px, calc(100vw - 16px)); max-height:calc(100vh - 16px); overflow-y:auto"
    >
      {summary.live === true
        ? item("Stop", "stop")
        : item("Activate", "activate")}
      <button
        type="button"
        class="menu-item"
        hx-get={`/sessions/${id}/rename`}
        hx-target={target}
        hx-swap="outerHTML"
      >
        Rename
      </button>
      {metadata !== undefined && metadata.starCount > 0
        ? item("Clear all stars", "stars/clear")
        : null}
      {item("Delete", "delete", true)}
    </div>
  );
}

/** The row while it is being renamed: pi-web swaps the whole row for an input. */
export function RenameRow({ summary, metadata }: Row) {
  const id = summary.id;
  const title = sessionTitle(summary, metadata);
  return (
    <form
      id={`row-${id}`}
      class="session-row"
      data-session-id={id}
      hx-post={`/sessions/${id}/rename`}
      hx-target="this"
      hx-swap="outerHTML"
      style={`height:${String(ROW_HEIGHT)}px; display:flex; align-items:center; padding-left:14px; padding-right:8px; border-left:2px solid transparent; transition:background 0.1s; gap:6px; overflow:hidden`}
    >
      <input
        name="name"
        value={metadata?.name ?? summary.name ?? ""}
        aria-label={`Rename session ${title}`}
        autofocus
        autocomplete="off"
        hx-get={`/sessions/${id}/row`}
        hx-trigger="keyup[key=='Escape']"
        hx-target={`#row-${id}`}
        hx-swap="outerHTML"
        style="flex:1; font-size:12px; padding:5px 8px; border:1px solid var(--accent); border-radius:5px; outline:none; background:var(--bg); color:var(--text); height:30px"
      />
    </form>
  );
}

/** One sidebar row. Without metadata it loads its own when scrolled into view. */
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
  const menuId = `row-menu-${id}`;
  return (
    <div
      id={`row-${id}`}
      class="session-row"
      data-session-id={id}
      data-title={title.toLowerCase()}
      {...(oob === true ? { "hx-swap-oob": "true" } : {})}
      {...(pending
        ? {
            "hx-get": `/sessions/${id}/row${activeId === undefined ? "" : `?active=${encodeURIComponent(activeId)}`}`,
            // `intersect`, not `revealed`: htmx only re-checks `revealed` on
            // window scroll, and #session-list scrolls on its own.
            "hx-trigger": "intersect once",
            "hx-swap": "outerHTML",
          }
        : {})}
      style={`height:${String(ROW_HEIGHT)}px; display:flex; align-items:center; padding-left:14px; padding-right:8px; cursor:pointer; ${selected ? "background:var(--bg-selected); " : ""}border-left:2px solid ${selected ? "var(--accent)" : "transparent"}; transition:background 0.1s; gap:6px; overflow:hidden`}
    >
      <a
        href={`/sessions/${id}`}
        style="flex:1; min-width:0; display:block; color:inherit; text-decoration:none"
      >
        <div
          title={title}
          data-session-title
          style={`display:flex; align-items:center; gap:5px; min-width:0; font-size:12px; font-weight:${selected ? "500" : "400"}; line-height:1.4; color:var(${summary.live === true ? "--text" : "--text-muted"})`}
        >
          <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0">
            {title}
          </span>
        </div>
        <div style="margin-top:2px; display:flex; align-items:center; gap:8px; color:var(--text-dim); font-size:11px; min-width:0">
          <SessionIndicator summary={summary} />
          <span style="display:flex; align-items:center; gap:8px; min-width:0; overflow:hidden">
            <span
              title={summary.modifiedAt}
              style="white-space:nowrap; flex-shrink:0"
            >
              {relativeTime(summary.modifiedAt)}
            </span>
            {summary.isWorktree !== true ||
            summary.branch === undefined ? null : (
              <span
                title={`Worktree: ${summary.cwd}`}
                style="display:flex; align-items:center; gap:3px; color:var(--accent); min-width:0; overflow:hidden"
              >
                <BranchBadgeIcon />
                <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">
                  {summary.branch}
                </span>
              </span>
            )}
          </span>
        </div>
      </a>
      <div
        style={`min-width:64px; height:${String(ROW_HEIGHT)}px; padding:4px 0 5px; box-sizing:border-box; display:flex; flex-direction:column; align-items:flex-end; justify-content:space-between; flex-shrink:0; color:var(--text-dim); font-size:11px`}
      >
        {/* ⌘1…⌘0 take the menu trigger's place on the first ten rows while a
            modifier is held. Which row is which is a browser-side count — a
            row re-rendered on its own does not know its position — so
            client/sidebar.ts fills this in and decides what shows. */}
        <kbd
          class="session-shortcut"
          aria-hidden="true"
          style="display:none; align-items:center; justify-content:center; width:28px; height:28px; color:var(--text-dim); font-family:var(--font-mono); font-size:10px"
        />
        {pending ? (
          <span />
        ) : (
          <button
            type="button"
            class="session-menu-trigger"
            popovertarget={menuId}
            aria-label={`Session actions for ${title}`}
            aria-controls={menuId}
            /* pi-web sets `background: transparent` inline and flips it to
               --bg-selected while the menu is open; an inline value would
               outrank the rule in areas/sidebar.css that does that here, and
               base.css already makes a button transparent. */
            style="display:flex; align-items:center; justify-content:center; width:28px; height:28px; padding:0; border:1px solid transparent; border-radius:6px; color:var(--text-muted); cursor:pointer"
          >
            <MoreDotsIcon size={16} radius={1.8} />
          </button>
        )}
        {pending ? (
          <span role="status" aria-label="Loading...">
            …
          </span>
        ) : (
          <span class="session-counts">
            {metadata.starCount > 0 ? (
              <span
                class="session-star-count"
                title={`${String(metadata.starCount)} starred answers`}
                aria-label={`${String(metadata.starCount)} starred answers`}
              >
                <span>{metadata.starCount.toLocaleString("en")}</span>
                <StarIcon size={11} filled />
              </span>
            ) : null}
            <span
              class="session-message-count"
              title={`${String(metadata.messageCount)} msgs`}
              style="white-space:nowrap"
            >
              {String(metadata.messageCount)} msgs
            </span>
          </span>
        )}
      </div>
      {pending ? null : <RowMenu summary={summary} metadata={metadata} />}
    </div>
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
      {page.map((summary) => (
        <SessionRow
          summary={summary}
          {...(activeId === undefined ? {} : { activeId })}
        />
      ))}
      {more ? (
        <div
          style="padding:8px 12px; font-size:11px; color:var(--text-dim)"
          hx-get={`/sidebar/rows?${query.toString()}`}
          hx-trigger="intersect once"
          hx-target="this"
          hx-swap="outerHTML"
        >
          Loading more sessions…
        </div>
      ) : null}
    </>
  );
}

export function SessionList({
  view,
  activeId,
  oob,
  partial,
}: {
  view: SidebarView;
  activeId?: string;
  oob?: boolean;
  partial?: boolean;
}) {
  const body = (
    <>
      {view.sessions.length === 0 ? (
        <div style="padding:16px 14px; color:var(--text-muted); font-size:12px">
          No sessions found
        </div>
      ) : null}
      <SessionRows
        view={view}
        {...(activeId === undefined ? {} : { activeId })}
      />
    </>
  );
  return partial === true ? (
    <Partial target="#session-list">{body}</Partial>
  ) : (
    <div
      id="session-list"
      style="flex:1 1 auto; overflow-y:auto; padding:0; min-height:80px"
      {...(oob === true ? { "hx-swap-oob": "innerHTML" } : {})}
    >
      {body}
    </div>
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
  cwd,
  home,
  oob,
}: {
  view: SidebarView;
  cwd?: string;
  home?: string;
  oob?: boolean;
}) {
  // The pill names the working folder, and the menu below it the project that
  // folder belongs to: a remembered folder from a different project would
  // make the two disagree, so the project wins.
  const project = view.selected ?? "";
  const folder =
    cwd !== undefined && (project === "" || cwd.startsWith(project))
      ? cwd
      : project;
  const chosen = folder !== "";
  return (
    <div
      id="project-picker"
      style="position:relative"
      {...(oob === true ? { "hx-swap-oob": "true" } : {})}
    >
      <button
        type="button"
        id="project-select"
        class="anchor-sidebar-project"
        popovertarget="sidebar-project-menu"
        data-project-key={view.selected ?? ""}
        data-cwd={folder}
        title={folder}
        style={`width:100%; display:flex; align-items:center; padding:6px 10px; background:${chosen ? "var(--bg-hover)" : "rgba(37,99,235,0.06)"}; border:1px solid ${chosen ? "var(--border)" : "rgba(37,99,235,0.4)"}; border-radius:7px; cursor:pointer; font-size:12px; color:var(--text); text-align:left; transition:border-color 0.15s, background 0.15s`}
      >
        {chosen ? (
          <PathLabel text={shortPath(folder, home)} />
        ) : (
          <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-family:var(--font-mono); font-size:11px; color:var(--text-dim)">
            Select project…
          </span>
        )}
        <span
          id="project-activity"
          title="New activity"
          aria-label="New activity"
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
        <div
          style="padding:8px 10px; font-size:11px; color:var(--text-dim)"
          role="status"
        >
          Loading...
        </div>
      </div>
    </div>
  );
}

/**
 * pi-web's PathLabel: right-to-left text so a long path keeps its tail and
 * loses its head to the ellipsis.
 */
function PathLabel({ text }: { text: string }) {
  return (
    <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:block; min-width:0; line-height:1.35; direction:rtl; text-align:left; font-family:var(--font-mono); font-size:11px; color:var(--text)">
      <span style="unicode-bidi:plaintext">{text}</span>
    </span>
  );
}

/** The menu's contents: every project, with a filter box once there are many. */
export function ProjectPicker({
  view,
  cwd,
  home,
}: {
  view: SidebarView;
  cwd?: string;
  home?: string;
}) {
  return (
    <>
      {view.projects.length > FILTER_FROM ? (
        <div style="padding:6px 8px; border-bottom:1px solid var(--border)">
          {/* No autofocus: pi-web renders this field with the sidebar, long
              before the popover opens, so React's autoFocus never fires and
              the box opens unfocused, with no ring and no caret. */}
          <input
            id="project-filter"
            class="menu-filter"
            placeholder="Filter projects…"
            aria-label="Filter projects"
          />
        </div>
      ) : null}
      <div style="max-height:min(50vh, 380px); overflow-y:auto">
        {view.projects.map((project) => (
          <ProjectFolderGroup
            project={project}
            selected={project.key === view.selected}
            {...(cwd === undefined ? {} : { cwd })}
            {...(home === undefined ? {} : { home })}
          />
        ))}
        <div
          id="project-empty"
          style="padding:8px 10px; font-size:11px; color:var(--text-dim)"
          hidden
        >
          No matching projects
        </div>
      </div>
      <button
        type="button"
        class="menu-item"
        hx-get="/workspaces/picker"
        hx-target="#dialogs"
        hx-swap="innerHTML"
      >
        <SmallPlusIcon />
        <span>Custom path…</span>
      </button>
    </>
  );
}

/**
 * The badges on a project row (§3.3). The running count is the server's; the
 * unread one is the browser's, so its span starts hidden and
 * `client/sidebar.ts` fills it in.
 */
function ProjectActivity({ running }: { running: number }) {
  return (
    <span
      class="project-activity"
      style={`display:${running > 0 ? "inline-flex" : "none"}; align-items:center; gap:5px; flex-shrink:0; margin-left:6px`}
    >
      {running > 0 ? (
        <span
          class="project-running"
          title="Agent running…"
          aria-label={`Agent running… (${String(running)})`}
          style="display:inline-flex; align-items:center; gap:3px; color:var(--accent); font-size:10px; font-family:var(--font-mono)"
        >
          <SpinnerIcon size={10} />
          {String(running)}
        </span>
      ) : null}
      <span
        class="project-unread"
        title="New session activity"
        style="display:none; align-items:center; gap:3px; color:var(--info); font-size:10px; font-family:var(--font-mono)"
      >
        <span style="width:6px; height:6px; border-radius:50%; background:currentColor; display:inline-block" />
        <span class="project-unread-count" />
      </span>
    </span>
  );
}

/** One project row, and the working folders under it when there are several. */
function ProjectFolderGroup({
  project,
  selected,
  cwd,
  home,
}: {
  project: ProjectEntry;
  selected: boolean;
  cwd?: string;
  home?: string;
}) {
  const only = project.folders.length === 1 ? project.folders[0] : undefined;
  const foldersId = `folders-${encodeURIComponent(project.key)}`;
  // Exactly one folder in the whole menu carries the tick: the one the
  // sidebar is showing. A remembered folder that is not one of this
  // project's falls back to its newest, which is what the sidebar listed.
  const chosen = selected
    ? project.folders.some((folder) => folder.path === cwd)
      ? cwd
      : project.entryPath
    : undefined;
  return (
    <div class="project-folder-group" data-project-key={project.key}>
      {only === undefined ? (
        <>
          <button
            type="button"
            class="menu-item project-folder-row"
            aria-expanded={selected ? "true" : "false"}
            aria-controls={foldersId}
          >
            <ChevronRightIcon />
            <FolderLabel
              name={baseName(project.key)}
              path={project.key}
              {...(home === undefined ? {} : { home })}
            />
            <ProjectActivity running={project.running} />
          </button>
          <div id={foldersId} hidden={!selected}>
            {project.folders.map((folder) => (
              <ProjectFolderRow
                project={project}
                path={folder.path}
                name={baseName(folder.path)}
                current={folder.path === chosen}
                child
                {...(home === undefined ? {} : { home })}
              />
            ))}
          </div>
        </>
      ) : (
        <ProjectFolderRow
          project={project}
          path={only.path}
          name={baseName(project.key)}
          current={only.path === chosen}
          activity={<ProjectActivity running={project.running} />}
          {...(home === undefined ? {} : { home })}
        />
      )}
    </div>
  );
}

function FolderLabel({
  name,
  path,
  home,
}: {
  name: string;
  path: string;
  home?: string;
}) {
  return (
    <span class="project-folder-label">
      <span>{name}</span>
      {/* pi-web's ProjectFolderGroup shortens only paths *under* home
          (`startsWith(homeDir + "/")`), so the home folder itself keeps its
          full spelling here where the workspace pill would write "~". */}
      <span class="project-folder-path">
        {path === home ? path : shortPath(path, home)}
      </span>
    </span>
  );
}

function ProjectFolderRow({
  project,
  path,
  name,
  current,
  child,
  activity,
  home,
}: {
  project: ProjectEntry;
  path: string;
  name: string;
  current: boolean;
  child?: boolean;
  activity?: unknown;
  home?: string;
}) {
  const query = new URLSearchParams({ project: project.key, cwd: path });
  return (
    <button
      type="button"
      class={
        child === true
          ? "menu-item project-folder-row project-folder-child"
          : "menu-item project-folder-row"
      }
      {...(current ? { "aria-current": "true" } : {})}
      title={path}
      hx-get={`/sidebar?${query.toString()}`}
      hx-target="#project-nav"
      hx-swap="outerHTML"
    >
      <ProjectFolderIcon />
      <FolderLabel
        name={name}
        path={path}
        {...(home === undefined ? {} : { home })}
      />
      {activity}
      {current ? <span aria-hidden="true">✓</span> : null}
    </button>
  );
}

/**
 * The project list owns its stream. A project switch replaces both; a folder
 * switch can replace just the stream without losing the loaded rows.
 */
export function ProjectNav({
  view,
  activeId,
  cwd,
}: {
  view: SidebarView;
  activeId?: string | undefined;
  cwd?: string | undefined;
}) {
  return (
    <div
      id="project-nav"
      style="display:flex; min-height:0; flex:1 1 0; flex-direction:column"
    >
      <SidebarEvents project={view.selected} cwd={cwd} />
      <SessionList
        view={view}
        {...(activeId === undefined ? {} : { activeId })}
      />
    </div>
  );
}

export function SidebarEvents({
  project,
  cwd,
}: {
  project?: string | undefined;
  cwd?: string | undefined;
}) {
  const query = new URLSearchParams();
  if (project !== undefined) query.set("project", project);
  if (cwd !== undefined) query.set("cwd", cwd);
  return (
    <div
      id="sidebar-events"
      hx-sse:connect={`/events?${query.toString()}`}
      hx-trigger="web-pi:sse-start"
      hx-swap="none"
    />
  );
}

/** The explorer's tree is fetched separately into #file-explorer. */
export function ExplorerSection({
  sessionId,
  cwd,
}: {
  /** Absent before a session is open: the folder alone roots the tree. */
  sessionId?: string;
  cwd: string;
}) {
  const scope =
    sessionId === undefined
      ? `cwd=${encodeURIComponent(cwd)}`
      : `session=${encodeURIComponent(sessionId)}`;
  const explorerUrl = `/files/explorer?${scope}`;
  // The section's flex, the toggle's min-height and the chevron's rotation
  // are pi-web's per-state inline values; areas/sidebar.css writes them from
  // aria-expanded, which client/sidebar.ts flips and remembers.
  return (
    <div
      id="explorer-section"
      style="border-top:1px solid var(--border); display:flex; flex-direction:column; min-height:0; overflow:hidden"
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
            style="display:flex; transition:transform 0.15s"
          >
            <SmallChevronIcon />
          </span>
          Explorer
        </button>
        {/* Swaps the changes list in for the tree; the files area fills it in
            and hides this button while nothing is changed. */}
        <button
          type="button"
          class="sidebar-toolbar-button"
          id="explorer-changes-toggle"
          aria-pressed="false"
          title="Changed files"
          aria-label="Changed files"
          hidden
        >
          <ChangedFilesIcon />
        </button>
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
          title="Refresh explorer"
          aria-label="Refresh explorer"
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
        {/* pi-web keeps the field out of the tree until the magnifier in the
            header opens it (FileExplorer.tsx, `fileSearchOpen`). */}
        <div
          id="file-search-field"
          style="padding:6px 8px; border-bottom:1px solid var(--border)"
          hidden
        >
          <div style="position:relative">
            <span style="position:absolute; left:8px; top:50%; transform:translateY(-50%); display:flex; color:var(--text-dim); pointer-events:none">
              <SearchIcon size={12} />
            </span>
            <input
              id="file-search"
              type="search"
              name="q"
              placeholder="Search files…"
              aria-label="Search files"
              autocomplete="off"
              style="width:100%; box-sizing:border-box; padding:6px 24px; border:1px solid var(--border); border-radius:5px; outline:none; background:var(--bg); color:var(--text); font-family:var(--font-mono); font-size:11px"
              hx-get={`/files/search?${scope}`}
              hx-trigger="input changed delay:150ms, search"
              hx-target="#file-tree"
              hx-swap="outerHTML"
            />
          </div>
        </div>
        <div
          id="file-explorer"
          class="explorer"
          data-cwd={cwd}
          hx-get={explorerUrl}
          hx-trigger="revealed, settled from:body"
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
  home,
}: {
  view: SidebarView;
  activeId?: string;
  cwd?: string;
  home?: string;
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
              data-session-link
              title="New session"
              aria-label="New session"
              aria-keyshortcuts="Meta+K Control+K"
            >
              <kbd
                class="new-session-shortcut"
                data-shortcut="K"
                aria-hidden="true"
                style="display:none; font-family:var(--font-mono); font-size:10px"
              >
                ⌘K
              </kbd>
              <span class="new-session-plus" style="display:flex">
                <PlusIcon />
              </span>
            </a>
            {/* The list is pushed by the shared stream; this is for a session
                started in the terminal, which nothing here can hear about. */}
            <button
              type="button"
              id="sidebar-refresh"
              class="sidebar-refresh-button"
              title="Refresh"
              aria-label="Refresh"
              hx-get="/sidebar"
              hx-target="#project-nav"
              hx-swap="outerHTML"
              style="display:flex; align-items:center; justify-content:center; background:var(--bg-hover); border:1px solid var(--border); color:var(--text-muted); cursor:pointer; width:32px; height:32px; border-radius:7px; padding:0; flex-shrink:0; transition:background 0.3s, color 0.3s, border-color 0.3s"
            >
              <span class="sidebar-refresh-done" style="display:none">
                <CheckIcon size={15} width={2.5} />
              </span>
              <span class="sidebar-refresh-idle" style="display:flex">
                <RefreshIcon size={15} width={2} />
              </span>
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
        <ProjectSelect
          view={view}
          {...(cwd === undefined ? {} : { cwd })}
          {...(home === undefined ? {} : { home })}
        />
      </div>
      <ProjectNav
        view={view}
        cwd={cwd}
        {...(activeId === undefined ? {} : { activeId })}
      />
      {/* pi-web shows the explorer for whichever folder is selected, with or
          without a session open (AppShell.tsx L2429). */}
      {cwd === undefined || cwd === "" ? null : (
        <ExplorerSection
          {...(activeId === undefined ? {} : { sessionId: activeId })}
          cwd={cwd}
        />
      )}
    </div>
  );
}
