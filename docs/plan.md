# Parity plan

Goal: every pi-web feature, on a leaner Hono + HTMX code base. Phases ran in
order; each ended with `just qa` green, a browser check against the fake
runtime, and a commit.

**All eight phases are done.** What each one covered is below, and what is still
missing — four deliberate gaps, no packaging ones — is in
`docs/architecture.md`.

| Phase                           | Commit               |
| ------------------------------- | -------------------- |
| Bootstrap: the vertical slice   | `4cd7074`            |
| 0: foundations                  | `6aa8ffd`            |
| pi-web behaviour specs          | `b22216e`            |
| 1: sessions                     | `aab1546`            |
| 2: composer                     | `65a79d8`            |
| 3: transcript                   | `65fced4`, `241ce10` |
| 4: files and Git                | `3f5a7a2`            |
| 5: workspace and configuration  | `255f8de`            |
| 6: extensions and notifications | `095badf`            |
| 7: packaging                    | `d18d98b`            |
| 8: parity audit fixes           | this commit          |

Conventions for every phase:

- Server owns UI state. A feature adds a use case to the family it belongs to in
  `src/core/workspace/` (or a sibling core module), a port if it needs Pi,
  files, Git, or the network, an adapter, a route, and views. No route talks to
  an adapter.
- Fragments over JSON. HTMX swaps rendered HTML; JSON endpoints exist only where
  a client script genuinely needs data (path completion, file index).
- Client scripts live in `src/web/client/*.ts`, bundled by esbuild into
  `static/client.js`. Libraries are fine when they replace real code
  (highlight.js, mermaid). Progressive enhancement where cheap.
- Tests: core rules as unit tests, routes through `app.request()` against the
  fake world, adapters against temporary directories. Never touch `~/.pi/agent`.
- One `Notice` mechanism for errors, one `Status` fragment for session state,
  one `contextUsage()` for numbers.

## Phase 0: foundations

- Resolve the Pi SDK from the `pi` on `PATH`; no `@earendil-works/*` pins.
  `scripts/link-host-pi.ts` finds the executable, validates the install, and
  symlinks its packages into `node_modules/@earendil-works/`. Runs from
  `prepare`, `just dev`, `just test`, `just lint`. `just doctor` reports the
  resolved path and version.
- esbuild bundle for client scripts; `just build-js`, watched by `just dev`.
- Layout shell: responsive (sidebar drawer on narrow screens), theme
  light/dark/system toggle persisted in `localStorage`, keyboard shortcuts (Esc
  aborts, Ctrl/Cmd+K new session, Ctrl/Cmd+1..9 switch session).

## Phase 1: sessions

Titles from the first user message (bounded read), rename, delete with child
reparenting, export to HTML, fork, clone, rewind, in-session branch navigation
(leaf switch with tree of user messages), stars (star/unstar/clear, sidebar
counts), session families (parent grouping), sidebar search, lazy row metadata
(message count, modified), unread indicator for sessions that finished while not
viewed, running-session list, stop runtime.

## Phase 2: composer

Slash command menu (runtime commands, prompt templates, built-ins), `@` file
completion with fuzzy index, image attachments (multipart upload, server-side
downscale, sent as image content), steer vs follow-up while running, queue
display/recall/clear, compact and abort-compaction, drafts per session in
`localStorage`, input history, Ctrl+Enter, mobile keyboard handling.

## Phase 3: transcript

Syntax highlighting, Mermaid preview toggle, copy message, star buttons on
answers, tool-result images, ANSI output, subagent tool rendering, bash
execution blocks, retry and compaction status, "load earlier" paging for long
sessions, prompt navigation rail with hover previews, jump to latest, per-turn
written-files summary, extension widgets and status shelf.

## Phase 4: files and Git

Explorer tree (lazy directories), file viewer (text with highlighting, images,
audio, PDF/docx preview, markdown), line-range selection inserted into the
composer, Git status and per-file diffs, live refresh through SSE file watching,
download, allowed-root containment with symlink safety.

## Phase 5: workspace and configuration

Folder picker with Git worktree discovery, custom path, validation,
missing-folder read-only notice, project trust dialog, skills (list, toggle
`disable-model-invocation`, search, install, check, update), plugins (list,
install, remove, update, enable, disable), tool definitions panel, system prompt
panel, settings panel.

## Phase 6: extensions and notifications

Extension dialogs (select, confirm, input, editor) answered from the browser,
custom extension UI where feasible, PWA manifest and service worker, Web Push
with VAPID keys in the agent directory, in-page notifications and completion
sound, workspace memory, idle shutdown of live sessions, project command
environment isolation.

## Phase 7: packaging

`web-pi` bin, an esbuild bundle and prebuilt assets in the published package,
LAN variant with its warning, proxy support, the version banner in Settings, a
runtime smoke test against the installed tarball, and the documentation pass.
`docs/deployment.md` covers running it as a service beside pi-web.

## Phase 8: parity audit fixes

A read of every spec against the code, then the fixes it found: the Queue
button, input history, the settled turn re-rendering itself, a leaked file
descriptor, trimmed dialog answers, a row whose file Pi had not written yet,
forking a message that is only images, the row cache, the Mermaid zoom as a real
modal, removing an attachment mid-downscale, the two halves of the queue, and
reading another branch of a running session from the runtime. Then the gaps:
Enter completing a menu entry, the compaction card's post-compaction estimate,
recalling queued images, the context-warning threshold actually reaching the
badge, `/copy` and `/session` from the Send button, the phone keyboard, worktree
probing behind the allowed roots, streaming tool arguments, subagent run
details, and the notification prompt. Seven rules that had two implementations
became one each.
