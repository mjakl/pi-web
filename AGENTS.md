# Pi Web Repository Guide

Pi Web is a local Next.js interface over Pi's existing agent configuration and
session files. It browses persisted sessions without starting an agent and runs
live turns through in-process Pi SDK `AgentSession` instances.

## Working agreement

- Use `npm`; requirements and available scripts are authoritative in
  `package.json` and `package-lock.json`.
- Treat `~/.pi/agent` (or `PI_CODING_AGENT_DIR`) as user-owned state. Tests and
  experiments that write sessions, settings, credentials, or skills must use a
  temporary agent directory or an explicit fixture. Do not alter the user's
  live Pi state unless the task requires it.
- Do not hand-edit generated output such as `.next/`, `next-env.d.ts`, or
  `*.tsbuildinfo`.
- `AGENTS.md` is the repository instruction source. `CLAUDE.md` is its symlink
  for Claude compatibility; keep it a symlink rather than maintaining a copy.
  Workflow skills are authored under `.agents/skills/`; `.claude/skills/`
  contains compatibility symlinks.

## Runtime and ownership map

```text
Browser components/hooks
        | HTTP + SSE
        v
Next.js routes in app/api
        |                         persisted, read-only browsing
        +--> lib/session-reader.ts ----------------------------> Pi session JSONL
        |
        +--> lib/rpc-manager.ts --> in-process AgentSession ---> Pi session JSONL
```

- Persisted session access is owned by `lib/session-reader.ts`: listing scans
  bounded JSONL metadata, while detail and context reads may use SDK
  `SessionManager` helpers. Neither path creates a live `AgentSession`.
- Top-level live commands and turns enter through `app/api/agent/**` and are
  owned by `lib/rpc-manager.ts`. Inspect all runtime callers before changing
  startup or lifecycle behavior. Browser synchronization is owned by
  `hooks/useAgentSession.ts` and the `lib/agent-event-*` modules.
- `globalThis` registries and caches survive Next.js hot reload but are
  process-local acceleration, not durable truth. Session JSONL and Pi's SDK
  stores remain authoritative.
- Keep route handlers focused on HTTP validation and translation. Put shared
  session, filesystem, model, credential, or process policy in the existing
  `lib/` owner instead of reimplementing it in another route or component.

Start with these owners instead of a broad file inventory:

| Change area | Start here |
| --- | --- |
| Persisted session reading, metadata, families, or context | `lib/session-reader.ts`, `lib/session-*.ts`, `app/api/sessions/**` |
| Live session startup, commands, tools, fork/clone, or cleanup | `lib/rpc-manager.ts`, `app/api/agent/**` |
| Browser streaming and reconciliation | `hooks/useAgentSession.ts`, `lib/agent-event-*.ts`, `lib/agent-client.ts` |
| File access, path identity, Git, or worktrees | `lib/file-access.ts`, `lib/path-security.ts`, `lib/paths.ts`, `lib/worktree.ts` |
| Project resources, trust, plugins, or skills | `lib/project-trust.ts`, `lib/chat-only.ts`, `app/api/{project-trust,plugins,skills}/**` |
| Models, startup preferences, or provider authentication | `lib/model-*.ts`, `lib/startup-preferences.ts`, `lib/provider-*.ts`, `app/api/{models,models-config,auth}/**` |
| Application shell and session workspace UI | `components/AppShell.tsx`, `components/SessionSidebar.tsx`, `components/ChatWindow.tsx`, `components/ChatInput.tsx` |

## High-risk invariants

### Session lifecycle and branching

- Keep one live wrapper per source session id in the `globalThis` registry, and
  keep concurrent startup coalesced by the shared start locks. Destruction must
  remove registry entries and release owned resources on success and failure.
- Fork and clone replace the source wrapper's usable runtime. Reject conflicting
  active work, create the branched session, then shut the source wrapper down
  through `shutdownAfterSessionReplacement()`; never continue using that
  wrapper under the old registry key.
- Keep independent session forks distinct from in-session tree navigation.
  `parentSession` is family/display metadata, not chat context. `entryIds[]`
  remains parallel to displayed `messages[]` so fork and navigation target the
  correct JSONL entry.
- Normalize persisted Pi tool-call blocks in `lib/session-reader.ts` and
  completed streamed messages in `hooks/useAgentSession.ts` through
  `lib/normalize.ts`. Do not create a third wire/file message shape in a UI
  component.

### Streaming and reconciliation

- Subscribe to SSE before taking or publishing the initial runtime snapshot so
  events cannot fall into the connection gap.
- Do not treat the first `agent_end` as prompt completion. Retries, compaction,
  and extension-queued work can continue; terminal UI state comes from
  `prompt_done` or `agent_settled`, with runtime-state reconciliation as the
  missed-event fallback.
- Preserve monotonic run identity when changing reconnect or reconciliation
  code. Late events and stale HTTP responses from an older run must not revive
  or complete a newer run.
- Keep `compaction_start` and `compaction_end` handling for both automatic and
  manual compaction.

### Tools, resources, and project execution

- When changing tool selection, Chat-only startup, resource snapshots, system
  prompts, or wrapper rebuilds, read
  [`docs/adr/0002-chat-only-tool-selection.md`](docs/adr/0002-chat-only-tool-selection.md).
  Resolve the persisted policy before session services load: no selection is a
  legacy default, while an explicit empty selection is Chat only. Crossing the
  Chat-only boundary rebuilds the wrapper; a nonempty preset change may update
  it in place.
- Gate project-controlled extensions, project settings resources, and project
  skills through `projectTrustReloadOptions()` in `lib/project-trust.ts`.
  Opening an untrusted project must not execute its code. A trust change takes
  effect by rebuilding the affected runtime, not by partially mutating it.
- When changing built-in project shell execution, read
  [`docs/adr/0001-isolate-project-command-environments.md`](docs/adr/0001-isolate-project-command-environments.md).
  Keep Next host variables out of project commands, preserve the SDK-managed
  environment and agent-bin `PATH`, and let an earlier user extension that owns
  `bash` take precedence.
- Skill toggles edit only the `disable-model-invocation` frontmatter field.
  Preserve all unrelated user formatting and frontmatter.

### Security, files, paths, and credentials

- Pi Web has no built-in authentication and does not restrict request Host or
  Origin headers. Non-loopback access requires a trusted network or an external
  security layer; do not add an application-level hostname or origin allowlist.
- Pi Web's file APIs are not a general filesystem browser. Keep containment and
  symlink-safe authorization centralized in `lib/path-security.ts`; add roots
  through the existing allowed-root flow rather than adding route-local path
  checks.
- Git emits POSIX-style paths even on Windows. Convert Git path output with
  `toNativePath()` and compare paths with `samePath()` or the centralized
  containment helpers, never raw string equality. Do not convert branch names.
- Derive provider listings from SDK-declared authentication capabilities and
  the stored credential type, not provider ids. Store and conditionally delete
  credentials through the locked credential helpers so one auth flow cannot
  remove another flow's newer credential. Never return raw credentials from an
  API.
- Keep model scope resolution delegated to Pi's SDK semantics; do not compare
  `enabledModels` patterns literally. Apply explicit startup model and thinking
  choices during session construction so the first turn cannot run with a
  transient default.

## UI and conditional guidance

- Follow existing components and CSS variables in source rather than a copied
  token inventory. Preserve keyboard, focus, scroll, mobile, and browser
  lifecycle behavior when changing interactions.
- When adding or changing user-visible UI text or English formatting, read
  [`docs/i18n.md`](docs/i18n.md) and update the English message package.

## Development server

- Before `npm run dev`, run
  `lsof -nP -iTCP:30141 -sTCP:LISTEN`. Reuse a healthy Pi Web process. A second
  dev server for the same checkout cannot work around the port because both
  processes contend for `.next/dev/lock`.
- Do not run `next build` or `npm run build` during normal development; they
  write production state into `.next/` and interfere with the dev server. Do
  not use `next dev --webpack` as a fallback; development uses Turbopack.
- A browser-only `Module ... factory is not available` overlay commonly means a
  stale HMR graph. Reload the page explicitly, then compare current server logs
  and a direct HTTP/API request. Restart only if the failure reproduces from a
  fresh page and server-side checks fail too. Stop the exact process
  gracefully, move `.next/` to a temporary backup, and restart with
  `npm run dev`.
- Next.js may append a generated `BEGIN:nextjs-agent-rules` block to this file
  when the dev server starts. Inspect `git status` after server use and exclude
  that generated block from unrelated changes.

## Validation and handoff

- Add or update the nearest `*.test.mjs` regression test for changed behavior.
  Use a focused `node --experimental-strip-types --test <file>` command while
  iterating.
- Regression tests exercise exported behavior or rendered output. Never read a
  source file and assert on its text.
- Before implementation handoff, run `npm test`,
  `node_modules/.bin/tsc --noEmit`, and `npm run lint`. If dependencies are not
  installed or a check cannot run, report that explicitly rather than claiming
  validation.
- For instruction-only or documentation-only changes, run `git diff --check`
  and validate every referenced path, link, and command; code checks are not
  required unless the change also affects code or configuration.
- Always inspect `git diff --stat`, `git diff --check`, and the final diff for
  generated state, user data, secrets, and unrelated rewrites before handoff.
