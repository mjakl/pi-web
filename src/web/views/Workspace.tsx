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
    <dialog id={id} class="modal" data-modal open>
      <div class="modal-box max-w-2xl">
        <div class="mb-3 flex items-center gap-2">
          <h2 class="flex-1 text-lg font-semibold">{title}</h2>
          <form method="dialog">
            <button class="btn btn-ghost btn-sm" aria-label="Close">
              ✕
            </button>
          </form>
        </div>
        {children}
      </div>
      <form method="dialog" class="modal-backdrop">
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
      class={`btn w-full justify-start btn-ghost btn-sm ${current ? "btn-active" : ""}`}
      title={cwd}
      {...(current ? { "aria-current": "true" } : {})}
      hx-post="/workspaces/validate"
      hx-vals={JSON.stringify({ cwd })}
      hx-swap="none"
    >
      <span class="truncate">{label ?? shortPath(cwd, home)}</span>
      {current ? <span class="text-primary">✓</span> : null}
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
    return (
      <p class="px-3 py-2 text-xs text-base-content/60" role="status">
        No working folders available
      </p>
    );
  }
  return (
    <ul class="flex flex-col">
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
          <p class="truncate px-4 pb-1 font-mono text-[10px] text-base-content/50">
            {shortPath(tree.path, home)}
          </p>
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
    <li class="border-b border-base-200 last:border-0">
      <details>
        <summary
          class={`cursor-pointer px-2 py-2 text-sm ${selected ? "font-semibold" : ""}`}
          hx-get={`/workspaces/folders?${query.toString()}`}
          hx-trigger="click once"
          hx-target="next div"
          hx-swap="innerHTML"
        >
          {project.label}
        </summary>
        <div class="pb-1 pl-3">
          <p class="px-3 py-2 text-xs text-base-content/50" role="status">
            Loading folders…
          </p>
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
    <div id="browse-pane" class="flex min-h-0 flex-col gap-2">
      <div class="flex items-center gap-1">
        <button
          type="button"
          class="btn btn-ghost btn-sm"
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
          class="input w-full font-mono input-sm"
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
          class="btn btn-sm"
          hx-get="/workspaces/browse"
          hx-include="#browse-path"
          hx-target="#browse-pane"
          hx-swap="outerHTML"
        >
          Go
        </button>
      </div>
      {error === undefined ? null : (
        <p class="text-sm text-error" role="alert">
          {error}
        </p>
      )}
      <ul class="menu max-h-64 w-full flex-nowrap overflow-y-auto p-0 text-sm">
        {directories.length === 0 ? (
          <li class="px-3 py-2 text-xs text-base-content/50">
            No folders here
          </li>
        ) : null}
        {directories.map((entry) => (
          <li>
            <button
              type="button"
              class="rounded-none"
              hx-get={go(entry.path)}
              hx-target="#browse-pane"
              hx-swap="outerHTML"
            >
              📁 {entry.name}
            </button>
          </li>
        ))}
      </ul>
      <div class="flex items-center gap-2">
        <span class="flex-1 truncate font-mono text-xs text-base-content/60">
          {shortPath(path, home)}
        </span>
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
      <div class="flex flex-col gap-3">
        <section>
          <h3 class="px-1 pb-1 text-xs text-base-content/50">Projects</h3>
          <ul class="max-h-56 overflow-y-auto rounded-box border border-base-300">
            {sidebar.projects.length === 0 ? (
              <li class="px-3 py-2 text-xs text-base-content/50">
                No projects yet
              </li>
            ) : null}
            {sidebar.projects.map((project) => (
              <ProjectRow
                project={project}
                selected={project.key === sidebar.selected}
              />
            ))}
          </ul>
        </section>
        <section>
          <h3 class="px-1 pb-1 text-xs text-base-content/50">Browse</h3>
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
      <p class="text-sm">
        Project resources can run local code. Trust only projects whose contents
        you know.
      </p>
      <code class="mt-2 block rounded bg-base-200 px-2 py-1 text-xs break-all">
        {cwd}
      </code>
      <div class="modal-action">
        <form method="dialog">
          <button class="btn btn-sm">Cancel</button>
        </form>
        <button
          type="button"
          class="btn btn-primary btn-sm"
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
      class="btn btn-warning btn-xs"
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
    <div
      class="flex items-center gap-2 border-t border-base-300 px-4 py-3 text-sm"
      role="status"
    >
      <span class="badge badge-sm badge-warning">Read only</span>
      <span>Working folder is unavailable. This session is read-only.</span>
      <code class="truncate text-xs opacity-60">{cwd}</code>
    </div>
  );
}
