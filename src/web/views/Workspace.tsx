import { shortPath } from "@core/workspaces";
import type { FolderChoice } from "@core/workspace";
import { ParentFolderIcon, PickerFolderIcon } from "./icons.tsx";

// "Custom path…" in the workspace menu: pi-web's DirectoryPicker
// (components/DirectoryPicker.tsx §3.7). One modal dialog that lists
// directory names, walks into them, and commits the folder it is standing in.
// Validating that folder is what grants access to it.

/** The worktrees of one project, probed on demand (§ the allowed-root flow). */
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
          <span
            {...(tree.path === choice.current
              ? { "aria-current": "true" }
              : {})}
          >
            {`${tree.path.split("/").filter(Boolean).at(-1) ?? tree.path}${
              tree.branch === null ? "" : ` · ${tree.branch}`
            }`}
          </span>
          <p>{shortPath(tree.path, home)}</p>
        </li>
      ))}
    </ul>
  );
}

const PANEL = "#directory-picker-panel";

/** The panel: header, path form, listing and footer. Navigation swaps it whole. */
export function BrowsePane({
  path,
  parentPath,
  directories,
  error,
}: {
  path: string;
  parentPath: string | null;
  directories: { name: string; path: string }[];
  error?: string;
}) {
  const go = (target: string) =>
    `/workspaces/browse?path=${encodeURIComponent(target)}`;
  return (
    <div
      id="directory-picker-panel"
      class="directory-picker-panel"
      style="width:520px; max-width:calc(100vw - 16px); height:min(620px, calc(100dvh - 16px)); max-height:calc(100dvh - 16px); display:flex; flex-direction:column; overflow:hidden; background:var(--bg); border:1px solid var(--border); border-radius:10px; box-shadow:0 8px 32px rgba(0,0,0,0.18)"
    >
      <div style="display:flex; align-items:center; justify-content:space-between; flex-shrink:0; padding:12px 18px; border-bottom:1px solid var(--border)">
        <div style="min-width:0; flex:1">
          <div style="color:var(--text); font-weight:700; font-size:15px">
            Select directory
          </div>
        </div>
        {/* pi-web closes with React; a form keeps the × working without
            script. display:flex stops it adding a text line box, which would
            make the header a pixel taller than pi-web's. */}
        <form method="dialog" style="display:flex">
          <button
            type="submit"
            title="Close"
            aria-label="Close"
            style="padding:2px 6px; border:0; background:none; color:var(--text-muted); font-size:20px; line-height:1; cursor:pointer"
          >
            ×
          </button>
        </form>
      </div>

      <form
        hx-get="/workspaces/browse"
        hx-include="#directory-path"
        hx-target={PANEL}
        hx-swap="outerHTML"
        style="display:flex; align-items:center; gap:8px; flex-shrink:0; padding:10px 14px; border-bottom:1px solid var(--border)"
      >
        <button
          class="directory-picker-back"
          type="button"
          title="Go to parent directory"
          aria-label="Go to parent directory"
          disabled={parentPath === null}
          {...(parentPath === null
            ? {}
            : {
                "hx-get": go(parentPath),
                "hx-target": PANEL,
                "hx-swap": "outerHTML",
              })}
          style={`width:36px; height:36px; padding:0; display:flex; align-items:center; justify-content:center; flex-shrink:0; border:1px solid var(--border); border-radius:6px; background:var(--bg-hover); color:var(--text-muted); cursor:${parentPath === null ? "default" : "pointer"}; opacity:${parentPath === null ? "0.45" : "1"}`}
        >
          <ParentFolderIcon />
        </button>
        <label
          for="directory-path"
          style="position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; border:0"
        >
          Directory path
        </label>
        <input
          class="directory-picker-path"
          id="directory-path"
          name="path"
          type="text"
          value={path}
          placeholder="/path/to/project or ~/project"
          autofocus
          autocomplete="off"
          spellcheck={false}
          style="min-width:0; flex:1; height:36px; padding:0 10px; border:1px solid var(--border); border-radius:6px; outline:none; background:var(--bg-panel); color:var(--text); font-family:var(--font-mono); font-size:12px"
        />
        <button
          class="directory-picker-action"
          type="submit"
          title="Go to directory"
          style="min-width:58px; height:36px; padding:0 12px; border:1px solid var(--border); border-radius:6px; background:var(--bg-hover); color:var(--text-muted); cursor:pointer"
        >
          Go
        </button>
      </form>

      <div
        class="directory-picker-list"
        style="flex:1; min-height:0; overflow:auto; padding:8px 10px"
      >
        {directories.length === 0 ? (
          <div style="padding:8px; color:var(--text-dim); font-size:11px">
            No subdirectories
          </div>
        ) : null}
        {directories.map((entry) => (
          <button
            class="directory-picker-entry"
            type="button"
            title={entry.path}
            hx-get={go(entry.path)}
            hx-target={PANEL}
            hx-swap="outerHTML"
            style="width:100%; min-height:30px; display:flex; align-items:center; gap:7px; padding:5px 8px; border:0; border-radius:5px; background:none; color:var(--text-muted); cursor:pointer; text-align:left; font-family:var(--font-mono); font-size:11px"
          >
            <PickerFolderIcon />
            <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">
              {entry.name}
            </span>
          </button>
        ))}
        {error === undefined ? null : (
          <div
            role="alert"
            style="padding:8px; color:var(--danger); font-size:11px"
          >
            {error}
          </div>
        )}
      </div>

      <div
        class="directory-picker-footer"
        style="display:flex; justify-content:flex-end; align-items:center; gap:10px; flex-shrink:0; padding:10px 18px; border-top:1px solid var(--border)"
      >
        <form method="dialog">
          <button
            class="directory-picker-action"
            type="submit"
            style="padding:6px 14px; border:1px solid var(--border); border-radius:6px; background:none; color:var(--text-muted); cursor:pointer; font-size:13px"
          >
            Cancel
          </button>
        </form>
        <button
          class="directory-picker-action"
          type="button"
          title="Select current directory"
          hx-post="/workspaces/validate"
          hx-vals={JSON.stringify({ cwd: path })}
          hx-swap="none"
          style="padding:6px 16px; border:0; border-radius:6px; background:var(--accent); color:var(--on-accent); font-size:13px; font-weight:600; cursor:pointer"
        >
          Select this folder
        </button>
      </div>
    </div>
  );
}

/** The dialog the panel lives in. `client/dialogs.ts` makes it a real modal. */
export function DirectoryPicker(props: {
  path: string;
  parentPath: string | null;
  directories: { name: string; path: string }[];
  error?: string;
}) {
  return (
    <dialog
      id="directory-picker"
      class="directory-picker-dialog"
      aria-label="Select directory"
      data-modal
      open
    >
      <BrowsePane {...props} />
    </dialog>
  );
}
