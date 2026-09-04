# Worktrees in Pi Web

Pi Web discovers existing Git worktrees and lets you switch between their
folders. Create and remove worktrees with Git or your other tools. Pi Web does
not create, delete, prune, or change branches in a worktree.

## Choose a working folder

Open the folder picker in the sidebar. Expand a repository to see its working
folders, then select one. Folder names and paths identify the choices; there is
no separate branch or worktree dropdown.

The original checkout and linked worktrees are equal choices. Repositories
backed by a bare Git directory are supported: the bare directory identifies the
group, but only its working folders appear as selectable checkouts. A repository
subdirectory keeps its own project identity. Ordinary folders remain selectable
through the same picker and **Custom path…**.

The closed picker shows the actual selected folder. Selecting a folder changes
where new sessions start and what the Explorer browses. Existing sessions keep
their original working folders. Opening a session selects that session's folder.
Sessions from the same repository stay together in the sidebar.

## Changes made by other tools

Pi Web refreshes the folder list when you open the picker or expand a repository.
Close and reopen it to see worktrees created or deleted by another agent. There
is no background worktree polling, including while the picker is open.

Discovery reads Git's worktree metadata; it does not scan the files in each
checkout. Missing and prunable worktrees are excluded from the folder choices.

## Sessions whose folders are missing

You can still read a session after its working folder disappears. Pi Web shows
a read-only notice and blocks activation, messages, fork, clone, compaction, and
other agent commands that change the session. Runtime inspection and stopping
an existing agent remain available. Pi Web does not recreate the folder or run
the session in a replacement folder.

Folder availability is checked when opening or refreshing a session and when
opening the picker. The backend checks again before activation and agent
commands. If the original folder becomes available again, opening the session or
refreshing the picker restores its controls. This does not activate the agent.

Pi Web records observed folder-to-repository associations in
`web-worktree-projects.json` inside the Pi agent directory (`~/.pi/agent`, or
`PI_CODING_AGENT_DIR`). This keeps history grouped after Git forgets a removed
worktree and after Pi Web restarts, without editing session transcripts. Old
`<repo>-worktrees/<folder>` paths created by Pi Web are also recognized. If an
arbitrarily located worktree was removed before Pi Web ever saw it, Git may no
longer provide its repository identity; its history remains available under its
original folder.

## HTTP interface

`GET /api/worktrees?cwd=<directory>` lists existing worktrees and reports project
identity and folder availability. The former `POST` and `DELETE` worktree
operations are removed and return HTTP 405.
