# Architecture

## Problem

pi-web (Next.js + React) keeps a second copy of the conversation in the browser
and reconciles it against the server with a three-layer protocol (deltas,
snapshot merges, polling recovery). Context usage was computed in five places
with three estimators. Every screen needed both a React component and an API
route.

web-pi removes the browser copy. Pi's session JSONL and the live `AgentSession`
are the only state; the browser shows whatever the server last rendered.

## Boundary and ports

Internal interfaces, all consumers in this repository. Defined in
`src/core/ports.ts`:

| Port               | Purpose                                                                                                                      | Adapter                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `SessionCatalog`   | List from headers only; read one branch; row metadata; rename, delete, star, fork, clone, rewind, export                     | `src/adapters/pi/session-catalog.ts` |
| `AgentRuntime`     | Open or resume a `LiveSession`; watch every session's lifecycle                                                              | `src/adapters/pi/agent-runtime.ts`   |
| `LiveSession`      | `snapshot()`, `prompt()`, `abort()`, `commands()`, `compact()`, `clearQueue()`, `runBash()`, `navigateTree()`, `subscribe()` | same                                 |
| `ModelCatalog`     | Models Pi has credentials for, narrowed by `enabledModels`, with the configured default and per-pattern reasoning pins       | `src/adapters/pi/model-catalog.ts`   |
| `ProjectResolver`  | The repository a working folder belongs to, and its branch                                                                   | `src/adapters/pi/projects.ts`        |
| `ProjectResources` | Prompt templates and skills of a folder, without starting an agent                                                           | `src/adapters/pi/resources.ts`       |
| `Files`            | The `@` completion index, directory listings, file bytes and text, `.docx` conversion, shell-output captures                 | `src/adapters/fs/file-tree.ts`       |
| `Git`              | `git status` of a folder and the patch for one file                                                                          | `src/adapters/git/git.ts`            |
| `Watcher`          | One file's changes on disk, deduplicated                                                                                     | `src/adapters/fs/watch.ts`           |
| `PushNotifier`     | VAPID keys and browser subscriptions in the agent directory; one encrypted message per finished run                          | `src/adapters/pi/web-push.ts`        |

`LiveSession` is the deep module: SDK event choreography (partial messages,
compaction, retries, queue, extension notices) stays inside; callers only read a
snapshot and receive `activity`, `turn_done`, and `stopped`.

`src/core/workspace/` is the inbound port: `createWorkspace(deps)` in
`src/core/workspace/index.ts` composes one flat `Workspace` object from four
use-case families that never import each other —
`src/core/workspace/sessions.ts` (the sidebar, one session's page, and the edits
Pi's `SessionManager` writes), `src/core/workspace/live.ts` (the running agent
and what only its entries can answer), `src/core/workspace/files.ts` (the file
panel and `@` completion) and `src/core/workspace/config.ts` (folder choice,
`/new`, trust, skills, packages). `src/core/workspace/deps.ts` holds the
`WorkspaceDeps` ports and the internals more than one family needs (session
lookup and decoration, folder availability, `authorize`), and
`src/core/workspace/views.ts` the view types a page renders. Every route calls
the workspace and renders the returned `SessionView`. The fake world in
`src/adapters/fake/index.ts` implements every outbound port in memory; web tests
and `WEB_PI_RUNTIME=fake` use it.

## One rendering of UI state

`SessionView` holds `items` (settled conversation), `turn` (the current turn,
including the in-progress assistant message), `settledTurn` (the turn that just
ended, for the one render that appends it to the log), `status`, `usage`, and
`models`. A turn is handed over exactly once: when the agent settles, the
runtime moves the boundary to the end of the branch, so the messages belong to
`items` from then on and any later re-render — a star, a rename, an extension
status — cannot put them on the page a second time. Page load, HTMX responses,
and SSE events all render the same three views:

- `#messages` receives settled turn items (`sse-swap="settled"`, `beforeend`),
  with the re-rendered conversation rail riding along out of band;
- `#turn` receives the whole current turn (`sse-swap="turn"`, `innerHTML`);
- `#status` receives model, state, queue, compaction, and the context badge;
- `#shelf` receives the extension status line and widgets (`sse-swap="shelf"`),
  and only when one of them actually changed, because it holds an open panel;
- `#extension-dialog` receives the modal an extension is waiting on, and
  `#custom-ui` the panel around a terminal component — both only when the
  request itself changed, or a re-render would wipe what the reader typed;
  `#custom-frame` inside the panel takes every new frame, so the keyboard stays
  where it is;
- `#toasts` receives notices (`sse-swap="notice"`, `beforeend`),
  `#editor-insert` text an extension put in the composer, and `#session-done`
  the id of a run that just finished.

The SSE endpoint coalesces activity into one re-render per 100 ms. Because the
turn is re-rendered from the snapshot rather than patched from deltas, a missed
event costs nothing: the next render is complete.

A second stream, `GET /events`, belongs to the sidebar rather than to one
session. It pushes a re-rendered row (`hx-swap-oob`) whenever a session of the
project on screen starts, finishes, or stops, the whole list when such a session
appears that has no row yet, the project selector whenever the running counts
change, and a `finished` event carrying the session id and its project. The
browser turns that into an unread dot in `localStorage` — on the row when the
session is listed, on the project when it is not; it replaces pi-web's 2.5 s
polling. The stream reads the project cookie at connect time, and the selector,
the list and the stream live in one `#project-nav` element, so switching project
replaces all three and reconnects.

`src/core/transcript.ts` projects one branch into items, and `src/core/turns.ts`
groups those items into turns, pages them, and writes the activity line. Every
transcript fragment — a page load, an earlier page, the settled turn appended to
the log, the running turn — renders through the one `Items` view, which
`src/web/views/Items.tsx` re-exports from `src/web/views/transcript/`: one
module per item kind (`user.tsx`, `assistant.tsx`, `tools.tsx`, `subagent.tsx`,
`notes.tsx`), `shared.tsx` for what they all use (Markdown, the copy button,
times, images, history actions) and `turns.tsx` for the grouping, the pages and
the running turn. The markup is pinned by `tests/web/transcript-items.test.tsx`
against a rendered fixture; the running turn renders flat and everything else
renders grouped.

`src/core/session-entries.ts` derives everything a session's raw entries imply:
starred answers, statistics and active time, the tip of every branch, and the
sidebar row summary. The catalog hands the core entries; no rule reads a file.

### Context usage

`src/core/context-usage.ts` is the only formula: tokens reported by Pi for the
last completed call (falling back to the transcript's last reported usage,
flagged as estimated), the model's window, a percent, and the thresholds — warn
at 60 %, critical at 80 %, and warn again once the count passes the reader's own
token threshold (pi-web's "dumb zone", 100,000 by default). That last one is a
browser preference the server has to know, because the server renders the badge,
so it travels in the `web-pi-warn-tokens` cookie and enters the formula as an
argument of `contextUsage()`; the settings page renders the current value and
the input writes the cookie. The badge, the compaction button, the statistics
panel, and any future warning read this one value.

## Dependency rules

Enforced by `.oxlintrc.json` (see `AGENTS.md`). `src/container.ts` is the
composition root and the only importer of Pi adapters.

## Decisions

- **pi-web's stylesheets are the pixel specification, copied verbatim.**
  `src/web/styles/` holds pi-web's `base.css`, `globals.css` and `settings.css`
  unchanged, plus `embedded.css` (the three `<style>` blocks pi-web keeps inside
  components) and `web-pi.css` (only what pi-web gets from Next.js: the
  self-hosted Noto Sans Mono faces behind `--font-noto-mono`, and htmx's
  in-flight class). `index.css` imports them in pi-web's own order and esbuild
  bundles that into `static/app.css`; there is no utility framework, because
  Tailwind and daisyUI kept re-introducing their own metrics under every
  component class and re-deriving 4,000 lines of hand-written CSS into utility
  strings is a lossier copy of the same data. A view therefore carries pi-web's
  class names and pi-web's inline styles, kebab-cased, and area agents add new
  rules only to `src/web/styles/areas/<area>.css` — one file per area, so two of
  them never edit the same stylesheet. The browserslist floor is pi-web's
  (chrome/edge ≥125, firefox ≥147, safari ≥26): native popovers, CSS anchor
  positioning, `@starting-style`, `:has()` and `field-sizing` are load-bearing,
  not progressive enhancement.
- **One module per area of the screen, on both sides.** `src/web/routes/` holds
  `sidebar`, `shell`, `transcript`, `composer` and `files`; `createWebApp`
  builds one `RouteContext` (the dependencies plus the request helpers that
  answer in more than one area) and composes them, and Hono matches on the path,
  so registration order carries no meaning. `src/web/client/main.ts` is an entry
  and nothing else: it imports the same five modules. The split exists so five
  agents can port five regions of pi-web at once without touching each other's
  files.
- **The theme is pi-web's, down to the storage key.** A pre-paint script in
  `<head>` reads `pi-theme` (`light` / `dark` / `auto`) and adds `dark` to
  `<html>` before the first paint; `src/web/client/theme.ts` keeps it in step
  with the system scheme and animates a switch as a circular clip-path wipe
  through the View Transitions API. The control lives in Settings → General, as
  a radio group the client marks on arrival — the server cannot know what the
  browser stored.

- **Pi SDK resolved from the host `pi` on `PATH`**, never pinned. web-pi reads
  and writes the same session files as the installed CLI, so a pin would let the
  two drift apart silently. `src/host-pi.ts` walks `PATH` for the first `pi`
  outside our own `node_modules/.bin`, finds the
  `@earendil-works/pi-coding-agent` package that owns it (a bare version-manager
  shim is rejected: it says nothing about the version), resolves `pi-ai`,
  `pi-agent-core`, and `pi-tui` through Node from that package, checks all four
  report the same version, and symlinks them into
  `node_modules/@earendil-works/`. A checkout links from `prepare` and from
  every `just` recipe that compiles or runs code; an installed package links
  into itself from the bin, on every start, so upgrading Pi needs only a
  restart. Trade-off: a fresh checkout needs Pi installed before `pnpm install`
  succeeds, and an installed package needs a writable install directory.
- **The package ships a bundle; the checkout runs the sources.** `just build`
  bundles `src/server.ts` and `src/cli.ts` with esbuild into `dist/`, leaving
  only the Pi SDK, `mammoth`, `web-push`, and `undici` external, so the
  published `dependencies` are those four lines and a consumer install has no
  toolchain in it. `just dev` and every test still run the TypeScript through
  `tsx`: tests that ran against `dist/` would test the bundler. The one check
  that does run against the package is `just smoke`
  (`tests/smoke/packaging.smoke.test.ts`), which packs, installs into a
  throwaway project, and serves a fixture session from the result — the only way
  to catch a missing `files` entry or an import that resolves solely in a
  checkout. `dist/` is not minified: a stack trace from an install should name
  real functions.
- **The bin is composition only.** `bin/web-pi.js` is three lines of JavaScript
  that need no build; `src/cli.ts` parses the flags into the environment
  `loadConfig()` already reads, links the host Pi, warns when the bind address
  is not loopback, and then imports `dist/server.js` — which must not load
  earlier, because its module graph reaches the SDK the link step has yet to put
  in place.
- **One HTTP dispatcher, proxy-aware.** `src/http.ts` installs undici's
  `EnvHttpProxyAgent` globally, so `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY`
  are honoured by every server-side fetch — Node's built-in fetch ignores them,
  and a model call behind a corporate proxy simply fails. It keeps undici's own
  300 s idle timeout, which a streaming turn pausing between tokens needs, and
  attaches an error listener to every client it creates: undici can emit an
  internal `error` while tearing a response body down, and an unhandled one
  would take the server with it.
- **Raw HTML in Markdown is escaped**, not sanitised. No allowlist to maintain,
  no script can pass.
- **The sidebar shows one project, in pages.** A real store holds ~2,750
  sessions across ~256 projects, and shipping all of them made a session page
  3.0 MB. `src/core/sessions.ts` owns the rules — project key, recent projects,
  which one is selected, the order within it — and the workspace returns one
  `SidebarView`. The selected project is the open session's, else the
  `web-pi-project` cookie, else the most recent. Three things are fetched only
  when asked for: the project list (when the selector opens), rows past the
  first 50 (`hx-trigger="intersect once"`, the transcript's own sentinel
  pattern), and each row's counts. That is 3.0 MB down to 48 KB of sidebar.
- **Sidebar rows load their own metadata.** Listing 2,700 sessions reads one
  header per file; a row's title, message count and star count need a pass over
  the whole file, so each row fetches its own (`hx-trigger="revealed"`) and the
  adapter streams the file line by line and caches the result by size and mtime.
  The real store renders in well under a second and a revisited row costs
  nothing.
- **pi-subagent runs are ordinary rows.** Half the files in a real store are
  `subagent.<hex>` sessions: transcripts of one tool call. pi-web lists them
  with everything else, so web-pi does too; the list pages fifty rows at a time,
  which is what keeps a store of thousands cheap to open.
- **The conversation rail is server-rendered and positioned in percentages.**
  `src/core/conversation-rail.ts` is pi-web's `lib/conversation-rail.ts` fed
  from the flat entry list rather than a compressed tree: web-pi already holds
  every entry with its parent, so the tree walk disappears and the layout
  (active path, lanes, rows, target leaf per lane) is what is left. Marks sit at
  `calc(12px + (100% - 42px) * row/rows)`, so the server needs no measurement of
  the reader's viewport, and the connector SVG is stretched over the same box.
  The rail covers the whole session from the first render — the marks come from
  the entries, not from the page — so paging never changes it and only a settled
  turn re-sends it. `src/web/client/rail.ts` measures the transcript for the
  active mark, the hover preview, and press-and-drag; a mark whose entry the
  page has not loaded is reached through the "load earlier" sentinel with
  `through=`.
- **An extension dialog is a pending request, not a message.**
  `src/core/extension-ui.ts` holds both state machines: unanswered dialogs with
  their timeouts and abort signals, and the custom UIs whose frames the panel
  shows. Several of each may be open — the SDK keys them by id and an extension
  may ask twice — and only the newest is on screen; an older one waits for its
  own timeout or for the session to stop, because answering an invisible dialog
  is worse than leaving it. `POST /sessions/:id/ui/:requestId` resolves the
  SDK's promise, so the first tab to answer wins and the others watch the dialog
  disappear on the next render. A cancel carries no value at all, which is
  exactly how the SDK spells its default (`undefined`, or `false` for
  `confirm`): an extension cannot tell a cancel from an empty answer.
- **A custom UI is a pi-tui component with no terminal under it.**
  `src/adapters/pi/extension-ui.ts` hands the factory a `TUI` that is a size and
  a `requestRender` callback, and a theme that applies no colour.
  `render(width)` returns lines; the panel unwraps the box the component drew
  for a terminal (`normalizeFrame` in `src/core/ansi.ts`) because the browser
  supplies its own, and converts what is left through the same ANSI converter as
  the shelf. Keystrokes go back as terminal bytes (`src/core/terminal-input.ts`,
  shared by the client bundle), percent-encoded rather than multipart, because a
  lone carriage return — which is what Enter sends — does not survive a
  multipart parser. Closing is Ctrl+C: a pi-tui component has no close command
  to receive.
- **A notification is offered once, at the moment it would have helped.** The
  browser asks for permission the first time a run finishes while nobody is
  looking, as a small prompt in the notice shelf with an Allow button — never a
  bare `requestPermission()` out of nowhere, and never again: the answer, or the
  decision not to answer, is remembered in `web-pi:notify-asked`. A browser that
  granted permission is subscribed to Web Push on every load, as pi-web does;
  there is no toggle, because pi-web has none.
- **Notifications key off the agent's own idle, not off the turn ending.**
  `src/core/turn-completion.ts` is pi-web's rule: a run has to have started, and
  the session has to be idle when it settles. A stop, an aborted turn or a shell
  command on its own never notifies. The adapter turns that into a `completed`
  runtime event; the server sends one Web Push from it, and the session stream
  sends `done` to the page, which plays the tone and — only when nobody is
  looking at the tab — shows a notification. The service worker shows its own
  only when no window is visible, so a reader never gets both.
- **The service worker is generated, not shipped.** Its precache list has to
  name this build's hashed asset URLs, so `src/web/pwa.ts` writes the script and
  `/sw.js` serves it uncached with the asset hash as its version. It caches
  `/static/*` and the offline page and nothing else: every session page, stream
  and command goes to the network, because a cached answer from this server is
  always the wrong one.
- **Extension output is converted server-side.** Extensions write status lines
  and widgets for a terminal. `src/core/ansi.ts` turns SGR colour and bold into
  `<span style>` and escapes everything else, so extension text can never become
  markup; every other escape sequence is dropped. The shelf below the composer
  holds the one status line and a chip per widget, with at most one panel open
  (`<details name>`, no script). A widget whose content is a component is
  rendered through the same headless pi-tui as a custom UI.
- **Session edits go through Pi's `SessionManager`.** Renames, stars, forks and
  clones are appends the SDK writes, so the CLI and web-pi never disagree about
  the format; stars are `pi-web:star` custom entries, the same ones pi-web
  reads. Only delete (re-parenting children) and rewind rewrite a file, because
  the SDK cannot remove entries.
- **HTML export spawns the Pi CLI**, as pi-web does: the SDK's exporter is
  behind the package export map. The exported page's recursive tree walks are
  rewritten as iterative ones, or a long session overflows the browser's stack;
  if a rewrite no longer matches the SDK's template the page is still served.
- **The transcript pages backwards, and defers old reasoning.** A page holds the
  last 50 items of the branch, extended back to a turn boundary, and a sentinel
  with `hx-trigger="intersect once"` swaps itself for the page before it; the
  client keeps the distance to the bottom so the text does not move under the
  reader. `through=<entryId>` widens a page until a given entry is on it, which
  is how a link into an unloaded part of a long session works. Once a page
  carries more than 20,000 characters of thinking, the older blocks are sent as
  placeholders that fetch their text when opened.
- **Two lazily-loaded libraries, each in its own bundle.** highlight.js is part
  of `static/client.js` and colours settled code blocks (never the running turn,
  whose text changes every frame). Mermaid is larger than everything else put
  together, so `src/web/client/mermaid-lib.ts` builds to `static/mermaid.js` and
  the page imports it by URL only when a reader asks for a diagram preview.
  Source is the default view, as in pi-web.
- **One client bundle besides htmx.** `src/web/client/main.ts` (scroll-follow,
  theme, keyboard shortcuts) is bundled by esbuild into `static/client.js` and
  loaded as a module with a content hash in its URL. The only inline script is
  the two-line theme read in `<head>`, which has to run before the first paint.
- **The composer's rules live in `src/core/composer.ts`**, and the client bundle
  imports them (esbuild resolves `@core` the same way tsconfig does). Slash
  ranking, `@`-token extraction, fuzzy scoring, insert text, history cycling,
  and the attachment limits are one implementation, unit-tested server-side and
  executed in the browser where a round trip would be felt. Only two JSON
  endpoints exist, both for the `@` menu: a keystroke cannot wait for a rendered
  fragment. Everything else the composer opens — the slash menu, the queue
  panel, the notice shelf — is server-rendered HTML.
- **One containment policy, in one function.** `authorize` in
  `src/core/workspace/deps.ts` answers every file request the same way, and
  `src/core/path-access.ts` holds the rules it applies: a lexical check before
  any file system call, then the same check on the resolved path against the
  resolved roots. The roots are the open session's folder and the repository it
  belongs to, plus the folders a reader validated through
  `POST /workspaces/validate` (in memory, forgotten on restart, as in pi-web); a
  path outside those widens the search to every session's folder before it is
  refused. The one exception is a file the session's transcript literally names
  (`referencesPath`): the agent already showed its contents, so it may be read —
  but never listed, because naming a file does not open its folder. Failures
  carry the status the route sends (400, 403, 404, 413). Shell-output captures
  need both a `<tmpdir>/pi-bash-*.log` name and a persisted `bashExecution`
  entry in that session that references the file.
- **The file panel is server-rendered; the browser keeps only the tabs.** Each
  directory is fetched when it is opened (`hx-get` per node), the changes list
  and the tree re-render when a turn settles (`sse:settled`), and the viewer is
  one fragment per mode. `src/web/client/files.ts` owns what the server cannot
  know: the panel width (`pi-right-panel-width`), which paths are open, each
  tab's mode, wrap and scroll position, the `EventSource` on the active tab, and
  the text selection a line-range mention comes from. Syntax colouring for a
  file happens on the server (`src/web/syntax.ts`, shared with the transcript's
  browser-side highlighter), because a whole file has to be split into numbered
  rows and highlight.js colours a block, not a line.
- **A settled tool call's body is fetched when it is opened.** A card is
  collapsed, so its arguments, output and diff do not have to be on the page:
  they arrive from `GET /sessions/:id/entries/:entryId/tool-result/:callId` on
  the first toggle, cut to 16 KB of text and 200 diff rows, with a button that
  asks for the rest. A real session page went from 1.05 MB to 480 KB. The
  running turn keeps its bodies inline, because it is re-rendered from the
  snapshot every 100 ms.
- **Project commands run in the project's environment.** See
  [ADR 0001](adr/0001-project-command-environment.md).
- **The chosen folder is a cookie, and validating it is what grants access.**
  `web-pi-cwd` holds the folder new sessions start in, `web-pi-project` the
  sidebar's project, `web-pi-settings` the open settings section, `web-pi-skill`
  the skill that folder was last reading, and `web-pi-warn-tokens` the context
  threshold the badge is coloured by. A preference the server renders from is a
  cookie; everything only the browser acts on stays in `localStorage`. The
  picker commits through `POST /workspaces/validate`, which adds the folder to
  the in-memory allowed roots — so the new-session composer gets `@` completion,
  the slash menu and a model picker, and `/new` re-validates its cookie on every
  load rather than trusting it. Browsing (`GET /workspaces/browse`) is
  deliberately outside that policy: it exposes directory _names_ only, and a
  reader has to be able to see a folder before asking for it. pi-web keeps the
  last custom path in `localStorage`; here the cookie is the memory and
  `web-pi:last-cwd` only pre-fills the browse box.
- **Worktree discovery is a rule plus a map.** `src/core/workspaces.ts` holds
  the identity rules (bare repositories, linked worktrees, subdirectories keep
  their own identity) and the parse of `git worktree list --porcelain -z`; the
  adapter runs git, caches for 60 s, checks availability _before_ the cache so a
  deleted folder can never be masked, and writes
  `<agentDir>/web-worktree-projects.json` atomically at mode 0600 and only when
  a mapping actually changed. Git forgets a worktree the moment it is deleted;
  that map is what keeps its sessions grouped under the repository.
- **A missing working folder is read-only, not an error.** The session still
  reads, exports, shows statistics and stops; sending, branching, forking,
  cloning, compacting, rewinding, switching model and activating all disappear,
  and `createWorkspace` refuses them server-side with the same sentence the page
  shows. One `requireFolder` guard, in the workspace, so a new route cannot
  forget it.
- **Trust is a gate, not a setting.** `hasTrustRequiringProjectResources`
  decides whether a folder is gated at all; a grant writes Pi's own `trust.json`
  through `ProjectTrustStore`, is refused while a session in that folder is
  mid-turn, and then **stops** that folder's sessions so they restart with
  project resources loaded. Untrusted projects keep working, with their
  extensions, skills and prompts dormant.
- **Settings is a route that renders as a dialog.** `/settings` re-renders the
  page the reader was on — the open session, else the new-session view — and
  puts the modal over it, because that is where pi-web keeps it. Its three
  sections (general, skills, plugins) are server-rendered, the last one
  remembered in a cookie rather than `localStorage`, and the mobile navigation
  is the same list as a native `<select>` — no script. A section that fails to
  load says so; falling back to general would quietly show the wrong page under
  the right tab.
- **Dialogs are `<dialog open>` from the server, upgraded in the browser.**
  `src/web/client/dialogs.ts` removes the `open` attribute and calls
  `showModal()` for backdrop, focus trap, top layer and focus restore, and
  removes the element when it closes. It must not call `close()` first: that
  queues a `close` event which would fire after the listener is attached and
  take the dialog straight back out of the page.
- **The skill toggle is a line edit, never a re-serialisation.**
  `src/core/skill-toggle.ts` inserts, rewrites or deletes one
  `disable-model-invocation` line inside the frontmatter block. Presence is
  tested, not truthiness, so an explicit `false` is rewritten in place instead
  of collecting a duplicate key — which would make the file unparseable and drop
  the skill. A shape the line edit cannot reach is refused rather than guessed
  at. The file belongs to whoever wrote it.
- **Startup model preferences are written only when Pi honoured them.**
  `src/core/models.ts` is pi-web's `persistExplicitStartupPreferences`: the
  default model is written when the session really started on the requested one,
  the reasoning level unless it was clamped to `off` on a model that cannot
  reason. The session is constructed with the choice, so `setModel` is never
  called a second time; repeating it would append a duplicate session entry and
  a duplicate extension event.
- **The models cache is stamped, not just timed.** Credentials and model
  metadata are edited in the Pi terminal, so the cache key carries the
  modification times of `auth.json` and `models.json`: a terminal login shows up
  on the next request instead of after the whole 60 s TTL. Granting trust, a
  plugin action, or writing a new default invalidates it outright.
- **Re-enabling a package loses its filters.** Disabling rewrites the entry as
  an object whose four resource lists are empty; enabling writes the plain
  source string back, so per-resource filters an entry carried do not survive
  the round trip. That is Pi's own spelling and pi-web's behaviour; the UI says
  so in the button's title rather than pretending otherwise.

## Not carried over yet

pi-web features absent from this slice, roughly in order of value:

1. Tool output in the transcript is preformatted text: ANSI is converted in the
   extension shelf and the custom-UI panel, not in a tool card.
2. The rail's branch marks move the session's leaf through `/navigate`, which
   offers the prompt there for editing, rather than opening that branch
   read-only. The explorer has no create, rename, delete or upload, and its
   expanded state is not remembered across a reload. The branch-sync line is an
   indicator, not a notice with a Retry button: nothing here can fail halfway.
3. A running-session cap. Idle shutdown exists for drafts Pi never wrote to disk
   (10 minutes, or immediately when the reader stops the turn), as in pi-web.
4. No live token counter or tokens-per-second in the assistant header: the
   number would be an estimate of an estimate, re-rendered ten times a second.

## Deliberately not carried over

Decisions, not gaps:

- **Drafts persist text, not attachments.** An image lives in the browser as
  bytes; keeping it across a reload would mean a second store for something the
  reader can drop in again in a second.
- **No message layer.** pi-web's 477 English keys are one locale behind an
  indirection; web-pi is English only and the strings live where they are read,
  in the views.
- **`addAutocompleteProvider` is a no-op**, as in pi-web. The `@` and `/` menus
  are server-rendered from the workspace, and an extension cannot reach into
  them. `getEditorText` returns the empty string for the same reason: the
  composer is the browser's, not the session's.
- **An extension cannot replace the session it runs in.** `newSession`, `fork`
  and `switchSession` on the command context answer `{cancelled: true}`; only
  `navigateTree`, `waitForIdle` and `reload` do anything. The page follows one
  session, and swapping it underneath the reader is not something HTMX could
  follow. A `shutdownHandler` request is honoured — a notice, then the session
  stops — because here that is a real operation.
- **Themes and the terminal chrome stay stubbed.** `setTheme` refuses,
  `getAllThemes` is empty, and the footer, header, working indicator and
  `setToolsExpanded` do nothing: they describe a terminal's furniture, and this
  one has none.
