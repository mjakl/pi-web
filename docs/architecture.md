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
| `Files`            | The `@` completion index, directory children, shell-output captures                                                          | `src/adapters/fs/file-tree.ts`       |

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

- `#messages` receives settled turn items (`sse-swap="settled"`, `beforeend`);
- `#turn` receives the whole current turn (`sse-swap="turn"`, `innerHTML`);
- `#status` receives model, state, queue, compaction, and the context badge;
- `#toasts` receives notices (`sse-swap="notice"`, `beforeend`).

The SSE endpoint coalesces activity into one re-render per 100 ms. Because the
turn is re-rendered from the snapshot rather than patched from deltas, a missed
event costs nothing: the next render is complete.

A second stream, `GET /events`, belongs to the sidebar rather than to one
session. It pushes a re-rendered row (`hx-swap-oob`) whenever a session starts,
finishes, or stops, the whole list when a session appears that has no row yet,
and a `finished` event carrying the session id. The browser turns that id into
an unread dot in `localStorage` when the session is not the one on screen; it
replaces pi-web's 2.5 s polling.

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
- **Sidebar rows load their own metadata.** Listing 2,700 sessions reads one
  header per file; a row's title, message count and star count need a pass over
  the whole file, so each row fetches its own (`hx-trigger="revealed"`) and the
  adapter streams the file line by line and caches the result by size and mtime.
  The real store renders in well under a second and a revisited row costs
  nothing.
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
- **File requests are scoped to the session's working folder.**
  `directoryWithin` in `src/core/path-access.ts` is the only check, and Phase 4
  extends it with the full allowed-root policy rather than adding checks to
  routes. Shell-output captures need both a `<tmpdir>/pi-bash-*.log` name and a
  persisted `bashExecution` entry in that session that references the file.
- **Project commands run in the project's environment.** See
  [ADR 0001](adr/0001-project-command-environment.md).

## Not carried over yet

pi-web features absent from this slice, roughly in order of value:

1. File explorer, file viewer, Git status and diffs, download.
2. `@` completion and the slash menu need a session: the new-session composer
   offers neither until the session exists. Drafts persist text, not
   attachments. The model selector is a native `<select>` (its type-ahead
   replaces pi-web's filter box); startup model preferences are Pi's own
   defaults rather than a browser choice persisted into settings.
3. Extension dialogs (`select`, `confirm`, `input`, `editor`, custom UI) are
   auto-cancelled; widgets and footers are ignored. Extension statuses and
   notices are shown. Tool output is preformatted text; ANSI escapes are not
   converted anywhere yet.
4. Worktree-aware folder picker, project trust dialog (trust is honoured
   read-only from Pi's store), skills and plugins management. Sessions already
   group under the repository a worktree belongs to.
5. The conversation rail with hover previews, star markers and branch
   navigation, and the per-turn written-files summary. The branch switcher in
   the header is the placeholder for that rail, and it only refreshes on a page
   load. Extension widgets and the ANSI-rendered status shelf are still missing;
   extension statuses show as plain badges.
6. PWA, push notifications, completion sound.
7. A running-session cap. Idle shutdown exists only for drafts Pi never wrote to
   disk (10 minutes), as in pi-web.
