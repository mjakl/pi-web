# Parity plan

Goal: every pi-web feature, on a leaner Hono + HTMX code base. Phases run in
order; each ends with `just qa` green, a browser check against the fake
runtime, and a commit. `docs/architecture.md` lists what is still missing and
is updated at the end of every phase.

Conventions for every phase:

- Server owns UI state. A feature adds a use case to `src/core/workspace.ts`
  (or a sibling core module), a port if it needs Pi, files, Git, or the
  network, an adapter, a route, and views. No route talks to an adapter.
- Fragments over JSON. HTMX swaps rendered HTML; JSON endpoints exist only
  where a client script genuinely needs data (path completion, file index).
- Client scripts live in `src/web/client/*.ts`, bundled by esbuild into
  `static/client.js`. Libraries are fine when they replace real code
  (highlight.js, mermaid). Progressive enhancement where cheap.
- Tests: core rules as unit tests, routes through `app.request()` against the
  fake world, adapters against temporary directories. Never touch
  `~/.pi/agent`.
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
  light/dark/system toggle persisted in `localStorage`, keyboard shortcuts
  (Esc aborts, Ctrl/Cmd+K new session, Ctrl/Cmd+1..9 switch session).

## Phase 1: sessions

Titles from the first user message (bounded read), rename, delete with child
reparenting, export to HTML, fork, clone, rewind, in-session branch
navigation (leaf switch with tree of user messages), stars (star/unstar/clear,
sidebar counts), session families (parent grouping), sidebar search, lazy row
metadata (message count, modified), unread indicator for sessions that
finished while not viewed, running-session list, stop runtime.

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
composer, Git status and per-file diffs, live refresh through SSE file
watching, download, allowed-root containment with symlink safety.

## Phase 5: workspace and configuration

Folder picker with Git worktree discovery, custom path, validation,
missing-folder read-only notice, project trust dialog, skills (list, toggle
`disable-model-invocation`, search, install, check, update), plugins (list,
install, remove, update, enable, disable), tool definitions panel, system
prompt panel, settings panel.

## Phase 6: extensions and notifications

Extension dialogs (select, confirm, input, editor) answered from the browser,
custom extension UI where feasible, PWA manifest and service worker, Web Push
with VAPID keys in the agent directory, in-page notifications and completion
sound, idle shutdown of live sessions, project command environment isolation.

## Phase 7: packaging

`web-pi` bin, prebuilt assets in the published package, LAN variant, proxy
support, runtime smoke test, documentation pass.
