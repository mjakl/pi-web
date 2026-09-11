import type { ProjectEntry } from "@core/sessions";
import type { FolderChoice, SidebarView } from "@core/workspace";

// Choosing the folder a new session starts in. The picker is one server-
// rendered `<dialog>`: the projects the store already knows, each expanding
// to the worktrees of its checkout, and a browse pane for anything else.

/** `/home/me/x` reads shorter as `~/x`, and the reader knows their own home. */
export function shortPath(path: string, home?: string): string {
  if (home === undefined || home === "" || !path.startsWith(home)) return path;
  const rest = path.slice(home.length);
  return rest === "" ? "~" : rest.startsWith("/") ? `~${rest}` : path;
}

/** Everything modal renders here; the client turns it into a real modal. */
export function DialogHost() {
  return <div id="dialogs" />;
}

function Dialog({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children?: unknown;
}) {
  return (
    <dialog id={id} data-modal open>
      <div>
        <div>
          <h2>{title}</h2>
          <form method="dialog">
            <button aria-label="Close">✕</button>
          </form>
        </div>
        {children}
      </div>
      <form method="dialog">
        <button aria-label="Close">close</button>
      </form>
    </dialog>
  );
}

/** The button that commits a folder: validating it is what grants access. */
function SelectFolder({
  cwd,
  label,
  current,
  home,
}: {
  cwd: string;
  label?: string;
  current?: boolean;
  home?: string;
}) {
  return (
    <button
      type="button"
      title={cwd}
      {...(current ? { "aria-current": "true" } : {})}
      hx-post="/workspaces/validate"
      hx-vals={JSON.stringify({ cwd })}
      hx-swap="none"
    >
      <span>{label ?? shortPath(cwd, home)}</span>
      {current ? <span>✓</span> : null}
    </button>
  );
}

/** The worktrees of one project, fetched when its row is opened. */
export function FolderList({
  choice,
  home,
}: {
  choice: FolderChoice;
  home?: string;
}) {
  if (choice.worktrees.length === 0) {
    return <p role="status">No working folders available</p>;
  }
  return (
    <ul>
      {choice.worktrees.map((tree) => (
        <li>
          <SelectFolder
            cwd={tree.path}
            home={home}
            current={tree.path === choice.current}
            label={`${tree.path.split("/").filter(Boolean).at(-1) ?? tree.path}${
              tree.branch === null ? "" : ` · ${tree.branch}`
            }`}
          />
          <p>{shortPath(tree.path, home)}</p>
        </li>
      ))}
    </ul>
  );
}

function ProjectRow({
  project,
  selected,
}: {
  project: ProjectEntry;
  selected: boolean;
}) {
  const query = new URLSearchParams({ cwd: project.entryPath });
  return (
    <li>
      <details>
        <summary
          aria-current={selected ? "true" : "false"}
          hx-get={`/workspaces/folders?${query.toString()}`}
          hx-trigger="click once"
          hx-target="next div"
          hx-swap="innerHTML"
        >
          {project.label}
        </summary>
        <div>
          <p role="status">Loading folders…</p>
        </div>
      </details>
    </li>
  );
}

/** The browse pane: names of directories, never their contents. */
export function BrowsePane({
  path,
  parentPath,
  directories,
  home,
  error,
}: {
  path: string;
  parentPath: string | null;
  directories: { name: string; path: string }[];
  home?: string;
  error?: string;
}) {
  const go = (target: string) =>
    `/workspaces/browse?path=${encodeURIComponent(target)}`;
  return (
    <div id="browse-pane">
      <div>
        <button
          type="button"

          aria-label="Parent folder"
          disabled={parentPath === null}
          hx-get={parentPath === null ? undefined : go(parentPath)}
          hx-target="#browse-pane"
          hx-swap="outerHTML"
        >
          ↑
        </button>
        <input
          id="browse-path"
          name="path"
          value={path}

          aria-label="Folder path"
          autocomplete="off"
          hx-get="/workspaces/browse"
          hx-trigger="keyup[key=='Enter']"
          hx-include="this"
          hx-target="#browse-pane"
          hx-swap="outerHTML"
        />
        <button
          type="button"

          hx-get="/workspaces/browse"
          hx-include="#browse-path"
          hx-target="#browse-pane"
          hx-swap="outerHTML"
        >
          Go
        </button>
      </div>
      {error === undefined ? null : <p role="alert">{error}</p>}
      <ul>
        {directories.length === 0 ? <li>No folders here</li> : null}
        {directories.map((entry) => (
          <li>
            <button
              type="button"

              hx-get={go(entry.path)}
              hx-target="#browse-pane"
              hx-swap="outerHTML"
            >
              📁 {entry.name}
            </button>
          </li>
        ))}
      </ul>
      <div>
        <span>{shortPath(path, home)}</span>
        <SelectFolder cwd={path} label="Use this folder" home={home} />
      </div>
    </div>
  );
}

/**
 * The whole picker. Projects first, because a reader almost always returns to
 * one they have worked in; browsing is one click away for the rest.
 */
export function WorkspacePicker({
  sidebar,
  browse,
  home,
}: {
  sidebar: SidebarView;
  browse: {
    path: string;
    parentPath: string | null;
    directories: { name: string; path: string }[];
  };
  home?: string;
}) {
  return (
    <Dialog id="workspace-picker" title="Choose a working folder">
      <div>
        <section>
          <h3>Projects</h3>
          <ul>
            {sidebar.projects.length === 0 ? <li>No projects yet</li> : null}
            {sidebar.projects.map((project) => (
              <ProjectRow
                project={project}
                selected={project.key === sidebar.selected}
              />
            ))}
          </ul>
        </section>
        <section>
          <h3>Browse</h3>
          <BrowsePane
            path={browse.path}
            parentPath={browse.parentPath}
            directories={browse.directories}
            home={home}
          />
        </section>
      </div>
    </Dialog>
  );
}

/**
 * Trust. Project resources are code Pi runs, so a repository nobody vouched
 * for stays dormant until someone says otherwise, here or in the terminal.
 */
export function TrustDialog({ cwd }: { cwd: string }) {
  return (
    <Dialog id="trust-dialog" title="Trust this project?">
      <p>
        Project resources can run local code. Trust only projects whose contents
        you know.
      </p>
      <code>{cwd}</code>
      <div>
        <form method="dialog">
          <button>Cancel</button>
        </form>
        <button
          type="button"

          hx-post="/workspaces/trust"
          hx-vals={JSON.stringify({ cwd })}
          hx-swap="none"
        >
          Trust project
        </button>
      </div>
    </Dialog>
  );
}

/** The toolbar badge that opens the dialog while a folder stays untrusted. */
export function TrustBadge({
  cwd,
  status,
}: {
  cwd: string;
  status: { requiresTrust: boolean; trusted: boolean };
}) {
  if (!status.requiresTrust || status.trusted) return <></>;
  return (
    <button
      type="button"

      title="Project resources are not loaded because this project is not trusted"
      hx-get={`/workspaces/trust?cwd=${encodeURIComponent(cwd)}`}
      hx-target="#dialogs"
      hx-swap="innerHTML"
    >
      🛡 Restricted mode
    </button>
  );
}

/** Shown wherever a session's folder is gone; every mutating route agrees. */
export function MissingFolderNotice({ cwd }: { cwd: string }) {
  return (
    <div role="status">
      <span>Read only</span>
      <span>Working folder is unavailable. This session is read-only.</span>
      <code>{cwd}</code>
    </div>
  );
}
