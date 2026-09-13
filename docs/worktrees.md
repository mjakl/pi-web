# Worktrees in web-pi

web-pi groups sessions by project and lets you choose existing working folders.
Create, remove, and prune worktrees with Git or another tool. web-pi does not
perform those operations or change a worktree's branch.

## Choose a working folder

Open the project picker in the sidebar and expand a repository to see folders
represented by its known sessions. This list is derived from session history,
not a fresh Git worktree scan. For a newly created worktree without a session,
use **Custom path…** and select its folder. Ordinary folders use the same flow.

Sessions in the original checkout and linked worktrees can share a project
group, including worktrees backed by a bare repository. A repository
subdirectory keeps its own project identity.

Choosing another worktree in the same project changes where the **next new
session** starts. An already displayed session stays open with its original
working folder, and its file panel stays in that session's context. Choose New
Session to use the selected folder. Switching projects opens a new-session view;
selecting a custom path also navigates to that folder's new-session view.
Opening an existing session restores that session's folder context.

Validation grants file access to the selected folder for the running server
process. It does not rewrite an existing session's cwd. The grant is forgotten
on restart; the new-session route validates the chosen folder again.

## Changes made by other tools

Reopening the picker or expanding a repository does not discover worktrees
created by another tool. The picker fetches its session-derived list once per
mounted menu; expanding a group only reveals its existing choices. Use **Custom
path…** to select a new working folder.

The separate `GET /workspaces/folders` route performs fresh Git discovery when
requested, but no current picker control calls it. That endpoint reads worktree
metadata rather than checkout files, and filters missing, prunable, and bare
entries. Those filtering guarantees do not apply to the session-derived picker,
which can retain a missing folder because its history still exists.

web-pi records observed folder-to-repository associations in
`web-worktree-projects.json` inside the Pi agent directory. This keeps history
grouped after Git forgets a removed worktree and after web-pi restarts, without
editing transcripts. If the worktree disappeared before its association was
recorded, history remains under its original folder; the repository is not
guessed from the folder name.

## Sessions whose folders are missing

You can still read history, export it, inspect statistics, or stop an existing
runtime. web-pi shows a read-only notice and blocks folder-dependent actions:
activation, prompts, fork, clone, compaction, rewind, branch navigation, and
model changes. Tools and system-prompt inspection cannot resume a dormant
runtime when its folder is missing.

The backend checks availability again before these actions. web-pi neither
recreates the folder nor substitutes another one. Restore the folder and reload
the session to restore its controls; that alone does not activate an agent.

## Hono routes

These routes serve the browser workflow, not the old Next.js JSON API:

- `GET /sidebar/projects` renders the project choices. There is no
  `/sidebar/workspaces` route in this implementation.
- `GET /sidebar?project=<root>&cwd=<folder>` selects a project/folder through
  HTMX; a same-project worktree choice can retain the open session.
- `GET /workspaces/folders?cwd=<directory>` renders freshly discovered Git
  worktree choices. It is not wired into the current picker UI.
- `GET /workspaces/picker` opens the custom-folder dialog.
- `GET /workspaces/browse?path=<directory>` renders directory names without
  granting file-content access.
- `POST /workspaces/validate`, with a `cwd` form field, validates a custom
  choice. HTMX receives navigation to `/new?cwd=…`; non-HTMX callers receive
  JSON and selection cookies. This is not compatible with `/api/worktrees`.

The route owner is `src/web/routes/sidebar.tsx`; selection behavior is covered
by `tests/web/session-navigation.test.ts`.
