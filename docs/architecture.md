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

| Port             | Purpose                                                          | Pi adapter                           |
| ---------------- | ---------------------------------------------------------------- | ------------------------------------ |
| `SessionCatalog` | List stored sessions from headers only; read one branch          | `src/adapters/pi/session-catalog.ts` |
| `AgentRuntime`   | Open or resume a `LiveSession`                                   | `src/adapters/pi/agent-runtime.ts`   |
| `LiveSession`    | `snapshot()`, `prompt()`, `abort()`, `setModel()`, `subscribe()` | same                                 |
| `ModelCatalog`   | Models Pi has credentials for                                    | `src/adapters/pi/model-catalog.ts`   |

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
- `#status` receives model, state, notices, and the context badge.

The SSE endpoint coalesces activity into one re-render per 100 ms. Because the
turn is re-rendered from the snapshot rather than patched from deltas, a missed
event costs nothing: the next render is complete.

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

- **Pi SDK as a pinned dependency**, not resolved from the host `pi` on `PATH`.
  Without a bundler there is no shim machinery to justify; `just doctor` flags a
  version gap. Trade-off: after `pi` upgrades, bump the pin.
- **Raw HTML in Markdown is escaped**, not sanitised. No allowlist to maintain,
  no script can pass.
- **No client-side JavaScript beyond htmx**, plus a 12-line scroll-follow script
  in `src/web/HtmlLayout.tsx`.

## Not carried over yet

pi-web features absent from this slice, roughly in order of value:

1. Session titles from the first message (listing reads headers only, so the
   sidebar shows ids); session rename, delete, export, fork, clone, rewind,
   branch navigation, stars.
2. File explorer, file viewer, Git status and diffs, `@` path completion.
3. Image attachments, slash-command menu, steer vs follow-up choice, queue
   recall, manual compaction button.
4. Extension dialogs (`select`, `confirm`, `input`, `editor`, custom UI) are
   auto-cancelled; widgets and footers are ignored. Extension statuses and
   notices are shown.
5. Worktree-aware folder picker, project trust dialog (trust is honoured
   read-only from Pi's store), skills and plugins management.
6. Syntax highlighting, Mermaid preview, lazy loading of long transcripts, a
   minimap rail, message actions (copy, star).
7. PWA, push notifications, completion sound, theme toggle (the stylesheet
   follows `prefers-color-scheme`).
8. Idle shutdown of live sessions and a running-session cap.
