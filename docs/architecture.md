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
| `ModelCatalog`     | Models Pi has credentials for, narrowed by `enabledModels`                                                                   | `src/adapters/pi/model-catalog.ts`   |
| `ProjectResolver`  | The repository a working folder belongs to, and its branch                                                                   | `src/adapters/pi/projects.ts`        |
| `ProjectResources` | Prompt templates and skills of a folder, without starting an agent                                                           | `src/adapters/pi/resources.ts`       |
| `Files`            | The `@` completion index, directory listings, file bytes and text, `.docx` conversion, shell-output captures                 | `src/adapters/fs/file-tree.ts`       |
| `Git`              | `git status` of a folder and the patch for one file                                                                          | `src/adapters/git/git.ts`            |
| `Watcher`          | One file's changes on disk, deduplicated                                                                                     | `src/adapters/fs/watch.ts`           |

`LiveSession` is the deep module: SDK event choreography (partial messages,
compaction, retries, queue, extension notices) stays inside; callers only read a
snapshot and receive `activity`, `turn_done`, and `stopped`.

`src/core/workspace.ts` is the inbound port. Every route calls it and renders
the returned `SessionView`. The fake world in `src/adapters/fake/index.ts`
implements every outbound port in memory; web tests and `WEB_PI_RUNTIME=fake`
use it.

## One rendering of UI state

`SessionView` holds `items` (settled conversation), `turn` (the current turn,
including the in-progress assistant message), `status`, `usage`, and `models`.
Page load, HTMX responses, and SSE events all render the same three views:

- `#messages` receives settled turn items (`sse-swap="settled"`, `beforeend`),
  with the re-rendered conversation rail riding along out of band;
- `#turn` receives the whole current turn (`sse-swap="turn"`, `innerHTML`);
- `#status` receives model, state, queue, compaction, and the context badge;
- `#shelf` receives the extension status line and widgets (`sse-swap="shelf"`),
  and only when one of them actually changed, because it holds an open panel;
- `#toasts` receives notices (`sse-swap="notice"`, `beforeend`).

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
the log, the running turn — renders through the one `Items` view in
`src/web/views/Items.tsx`; the running turn renders flat and everything else
renders grouped.

`src/core/session-entries.ts` derives everything a session's raw entries imply:
starred answers, statistics and active time, the tip of every branch, and the
sidebar row summary. The catalog hands the core entries; no rule reads a file.

### Context usage

`src/core/context-usage.ts` is the only formula: tokens reported by Pi for the
last completed call (falling back to the transcript's last reported usage,
flagged as estimated), the model's window, a percent, and one threshold pair
(warn 60 %, critical 80 %). The badge, the per-message footer, and any future
warning read this value.

## Dependency rules

Enforced by `.oxlintrc.json` (see `AGENTS.md`). `src/container.ts` is the
composition root and the only importer of Pi adapters.

## Decisions

- **Pi SDK resolved from the host `pi` on `PATH`**, never pinned. web-pi reads
  and writes the same session files as the installed CLI, so a pin would let the
  two drift apart silently. `scripts/link-host-pi.ts` walks `PATH` for the first
  `pi` outside this checkout, finds the `@earendil-works/pi-coding-agent`
  package that owns it (a bare version-manager shim is rejected: it says nothing
  about the version), resolves `pi-ai`, `pi-agent-core`, and `pi-tui` through
  Node from that package, checks all four report the same version, and symlinks
  them into `node_modules/@earendil-works/`. It runs from `prepare` and from
  every `just` recipe that compiles or runs code. Trade-off: a fresh checkout
  needs Pi installed before `pnpm install` succeeds.
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
- **pi-subagent runs are folded away.** Half the files in a real store are
  `subagent.<hex>` sessions: transcripts of one tool call, not conversations.
  They are kept out of the list and offered as one collapsed "N subagent runs"
  line — under their parent session when the header names one, otherwise at the
  top of the project — which loads the 50 newest when opened.
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
- **Extension output is converted server-side.** Extensions write status lines
  and widgets for a terminal. `src/core/ansi.ts` turns SGR colour and bold into
  `<span style>` and escapes everything else, so extension text can never become
  markup; every other escape sequence is dropped. The shelf below the composer
  holds the one status line and a chip per widget, with at most one panel open
  (`<details name>`, no script). Widgets whose content is a terminal component
  keep an inert chip until a headless pi-tui renders them in Phase 6.
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
  `src/core/workspace.ts` answers every file request the same way, and
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
  one fragment per mode. `src/web/client/panel.ts` owns what the server cannot
  know: the panel width (`web-pi:panel-width`), which paths are open, each tab's
  mode, wrap and scroll position, the `EventSource` on the active tab, and the
  text selection a line-range mention comes from. Syntax colouring for a file
  happens on the server (`src/web/syntax.ts`, shared with the transcript's
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

## Not carried over yet

pi-web features absent from this slice, roughly in order of value:

1. `@` completion and the slash menu need a session: the new-session composer
   offers neither until the session exists. Drafts persist text, not
   attachments. The model selector is a native `<select>` (its type-ahead
   replaces pi-web's filter box); startup model preferences are Pi's own
   defaults rather than a browser choice persisted into settings.
2. Extension dialogs (`select`, `confirm`, `input`, `editor`, custom UI) are
   auto-cancelled; footers and headers are ignored, and a widget whose content
   is a terminal component shows as an empty chip. Tool output is preformatted
   text: ANSI is converted in the extension shelf, not in the transcript.
3. Worktree-aware folder picker, project trust dialog (trust is honoured
   read-only from Pi's store), skills and plugins management. Sessions already
   group under the repository a worktree belongs to.
4. The rail's branch marks move the session's leaf through `/navigate`, which
   offers the prompt there for editing, rather than opening that branch
   read-only. The explorer has no create, rename, delete or upload, and its
   expanded state is not remembered across a reload.
5. PWA, push notifications, completion sound.
6. A running-session cap. Idle shutdown exists only for drafts Pi never wrote to
   disk (10 minutes), as in pi-web.
