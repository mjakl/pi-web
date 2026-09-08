# Agent runtime

Read this before changing persisted session access, live session behavior,
models, resource loading, or host Pi resolution. The module ownership map is in
[AGENTS.md](../AGENTS.md#ownership-map).

## Host Pi resolution

Pi Web uses the first host `pi` on `PATH`, ignoring copies in the checkout. Do
not pin Pi packages in `package.json`: that would make checks validate a
checkout copy while the server runs a different installation. Matching host
packages pinned outside the checkout in
[CI](../.github/workflows/validation.yml) are test fixtures, not a supported
version restriction.

Start Next.js only through `npm run dev`, `npm run build`, `npm start`, or the
`pi-web` bin. `bin/run-next.js` validates the installation with
`bin/host-pi.js`, serializes it into `PI_WEB_HOST_PI`, and preloads
`bin/host-pi-runtime.js`. That preload redirects the imported Pi packages to the
validated host installation.

TypeScript, Turbopack, and webpack resolve Pi through `node_modules` and do not
see the preload. `bin/link-host-pi.js` writes small re-export packages pointing
at the validated host entry. They are refreshed by `npm install` (`prepare`),
`npm run dev`, `npm run build`, and full or focused tests. Turbopack compiles
only files inside the workspace root, so these must remain real files in the
checkout; symlinks to the host installation do not resolve.

Turbopack requests server externals through hashed aliases such as
`@earendil-works/pi-tui-<hash>`. The preload normalizes these before matching.
Keep alias and bare-name resolution working, and keep `next.config.ts`
`serverExternalPackages` in step when changing resolution.

## Persisted sessions and live ownership

Listing scans bounded JSONL metadata in `lib/session-reader.ts`. Detail and
context reads may use SDK `SessionManager` helpers. Neither path creates a live
`AgentSession`.

Top-level live commands enter through `app/api/agent/**` and are owned by
`lib/rpc-manager.ts`. Inspect all runtime callers before changing startup or
lifecycle behavior.

- Keep one live wrapper per source session id in the `globalThis` registry.
  Coalesce concurrent startup with the shared start locks. Destruction must
  remove registry entries and release owned resources on success and failure.
- Fork and clone create independent children while keeping the source wrapper
  active under its original id. Reject conflicting active work and copy history
  through a separate `SessionManager` so the source runtime keeps its session
  file and branch.
- Independent forks are distinct from in-session tree navigation.
  `parentSession` is family/display metadata, not chat context. Keep
  `entryIds[]` parallel to displayed `messages[]` so navigation and forks target
  the correct JSONL entry.
- Normalize persisted Pi tool-call blocks in `lib/session-reader.ts` and
  completed streamed messages in `hooks/useAgentSession.ts` through
  `lib/normalize.ts`. Do not create a third wire/file message shape in a UI
  component.

## Streaming and reconciliation

Browser synchronization is owned by `hooks/useAgentSession.ts` and the
`lib/agent-event-*` modules.

- Subscribe to SSE before taking or publishing the initial runtime snapshot so
  events cannot fall into the connection gap.
- Do not treat the first `agent_end` as prompt completion. Retries, compaction,
  and extension-queued work can continue. Terminal UI state comes from
  `prompt_done` or `agent_settled`, with runtime-state reconciliation as the
  missed-event fallback.
- Preserve monotonic run identity. Late events and stale HTTP responses from an
  older run must not revive or complete a newer run.
- Keep `compaction_start` and `compaction_end` handling for automatic and manual
  compaction.

## Tools, resources, and project commands

Keep tool and resource defaults owned by Pi. Append Pi Web's rendering note
through the resource loader's `appendSystemPromptOverride`, preserving the
normal system prompt and discovered append instructions for new and resumed
runtimes. Do not inject it into conversation history.

The trust gate in `lib/project-trust.ts` covers project-controlled extensions,
project settings resources, and project skills. A trust change takes effect by
rebuilding the affected runtime, not by partially mutating it.

For built-in project shell changes, also read the
[shell environment boundary](adr/0001-isolate-project-command-environments.md).
Keep Next host variables out of project commands, preserve the SDK-managed
environment and agent-bin `PATH`, and let an earlier user extension that owns
`bash` take precedence.

## Models and startup preferences

The SDK resolves credentials inside `createAgentSessionServices()` during
session construction. Keep model scope delegated to Pi's SDK semantics; do not
compare `enabledModels` patterns literally. Apply explicit startup model and
thinking choices during construction so the first turn cannot run with a
transient default.

`auth.json` and `models.json` change outside Pi Web, so the models cache cannot
be invalidated on write. Expire it with `readAgentConfigStamp()` instead, or a
terminal login stays invisible for the cache TTL.
