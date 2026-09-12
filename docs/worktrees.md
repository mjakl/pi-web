# Worktrees in web-pi

web-pi discovers existing Git worktrees and lets you choose their folders.
Create, remove, and prune worktrees with Git or another tool. web-pi does not
perform those operations or change a worktree's branch.

## Choose a working folder

Open the project picker in the sidebar and expand a repository to see its
working folders. The original checkout and linked worktrees are equal choices. A
bare repository identifies the group, but its bare directory is not offered as a
working checkout. A repository subdirectory keeps its own project identity.
Ordinary folders are available through **Custom path…**.

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

The folder route probes Git when requested, rather than polling in the
background. Reopen the picker or expand the repository to refresh the list.
Discovery reads worktree metadata, not every checkout's files. Missing,
prunable, and bare entries are excluded from selectable working folders.

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
- `GET /workspaces/folders?cwd=<directory>` renders a project's worktree
  choices.
- `GET /workspaces/picker` opens the custom-folder dialog.
- `GET /workspaces/browse?path=<directory>` renders directory names without
  granting file-content access.
- `POST /workspaces/validate`, with a `cwd` form field, validates a custom
  choice. HTMX receives navigation to `/new?cwd=…`; non-HTMX callers receive
  JSON and selection cookies. This is not compatible with `/api/worktrees`.

The route owner is `src/web/routes/sidebar.tsx`; selection behavior is covered
by `tests/web/session-navigation.test.ts`.
