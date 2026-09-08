# Pi Web Repository Guide

Pi Web is a local Next.js interface over Pi's existing configuration and session
files. Browsing persisted sessions does not start an agent; live turns use
in-process Pi SDK `AgentSession` instances.

## Working agreement

- Use `npm` and the development tool pins in `mise.toml`. `package.json` owns
  commands; `justfile` delegates to them. Pi must be installed separately on
  `PATH`, never pinned as a checkout dependency.
- Treat `~/.pi/agent` (or `PI_CODING_AGENT_DIR`) as user-owned state. Tests and
  experiments that write sessions, settings, credentials, or skills must use a
  temporary agent directory or an explicit fixture. Do not alter live Pi state
  unless the task requires it.
- Do not hand-edit generated output such as `.next/`, `next-env.d.ts`, or
  `*.tsbuildinfo`. Do not build into a development checkout's `.next/` during
  normal development.
- `AGENTS.md` is the repository instruction source. Keep `CLAUDE.md` as its
  symlink. Workflow skills live in `.agents/skills/`; `.claude/skills/` contains
  compatibility symlinks, not copies.

## Read before the relevant work

Read the applicable guide before making changes or running its procedures:

| Task                                                                                                                   | Required guidance                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Set up a checkout, run checks, change validation tooling, or start/troubleshoot the dev server                         | [Development](docs/development.md)                                                                                             |
| Change session reading or lifecycle, live commands, streaming, models, project resource loading, or host Pi resolution | [Agent runtime](docs/agent-runtime.md)                                                                                         |
| Change dependencies, the build script, or the published `files` list                                                   | [Packaging and runtime smoke](docs/packaging.md)                                                                               |
| Change built-in project shell execution                                                                                | [Shell environment boundary](docs/adr/0001-isolate-project-command-environments.md) and [Agent runtime](docs/agent-runtime.md) |
| Change folder selection, worktree discovery, or missing-folder behavior                                                | [Worktrees](docs/worktrees.md)                                                                                                 |
| Add or change visible UI text or English formatting                                                                    | [English messages and formatting](docs/i18n.md)                                                                                |

## Ownership map

```text
Browser components/hooks
        | HTTP + SSE
        v
Next.js routes in app/api
        +--> lib/session-reader.ts --> persisted Pi session JSONL
        +--> lib/rpc-manager.ts ----> live AgentSession --> Pi session JSONL
```

Keep route handlers focused on HTTP validation and translation. Put shared
session, filesystem, model, and process policy in its existing `lib/` owner.
Session JSONL and Pi's SDK stores remain authoritative; `globalThis` registries
and caches are process-local acceleration, not durable truth.

Start with these owners instead of a broad file inventory:

| Change area                                        | Start here                                                                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Persisted sessions, metadata, families, or context | `lib/session-reader.ts`, `lib/session-*.ts`, `app/api/sessions/**`                                                          |
| Live commands, tools, fork/clone, or cleanup       | `lib/rpc-manager.ts`, `app/api/agent/**`                                                                                    |
| Extension dialogs, statuses, widgets, or custom UI | `lib/extension-ui-bridge.ts`                                                                                                |
| Browser streaming and reconciliation               | `hooks/useAgentSession.ts`, `lib/agent-event-*.ts`, `lib/agent-client.ts`                                                   |
| Files, paths, Git, or worktrees                    | `lib/file-access.ts`, `lib/path-security.ts`, `lib/paths.ts`, `lib/worktree.ts`                                             |
| Project resources, trust, plugins, or skills       | `lib/project-trust.ts`, `app/api/{project-trust,plugins,skills}/**`                                                         |
| Models and startup preferences                     | `lib/model-scope.ts`, `lib/models-cache.ts`, `lib/agent-config-stamp.ts`, `lib/startup-preferences.ts`, `app/api/models/**` |
| Application shell and workspace UI                 | `components/AppShell.tsx`, `components/SessionSidebar.tsx`, `components/ChatWindow.tsx`, `components/ChatInput.tsx`         |
| Host Pi resolution and Next.js startup             | `bin/host-pi.js`, `bin/host-pi-runtime.js`, `bin/link-host-pi.js`, `bin/run-next.js`                                        |

## Boundaries to preserve

- Pi Web has no built-in authentication and does not restrict request Host,
  Origin, or Content-Type headers. Non-loopback access requires a trusted
  network or an external security layer. Do not add hostname/origin allowlists
  or a Content-Type gate as a CSRF defence; this boundary is intentional even on
  loopback.
- Opening an untrusted project must not execute its code. Keep project resource
  loading gated by `projectTrustReloadOptions()` in `lib/project-trust.ts`.
- Pi Web never reads, writes, or serves provider credentials. Providers are
  configured in the Pi terminal; the SDK resolves credentials during session
  construction. Do not add a credential store or an authentication route.
- Keep file-content containment and symlink-safe authorization centralized in
  `lib/path-security.ts`. Add roots through the existing allowed-root flow, not
  route-local checks. The workspace picker and path completion can list
  directories outside those roots; they do not grant file-content access by
  listing them.
- Git emits POSIX-style paths even on Windows. Convert Git path output with
  `toNativePath()` and compare paths with `samePath()` or centralized
  containment helpers, never raw string equality. Do not convert branch names.
- Skill toggles edit only `disable-model-invocation` frontmatter. Preserve all
  unrelated user formatting and fields.
- Follow existing components and CSS variables. Preserve keyboard, focus,
  scroll, mobile, and browser lifecycle behavior when changing interactions.
- Keep the stronger checks in `tsconfig.json` enabled. Use explicit dictionary
  access and retain checked values when traversing arrays; do not add assertions
  or silently skip entries to satisfy indexed-access checking. Preserve
  message/entry-id alignment and existing empty states. Declare known build-time
  environment fields in `env.d.ts` so client constants retain Next.js's static
  substitution.

## Validation and handoff

- Add or update the nearest `*.test.mjs` regression test for changed behavior.
  Exercise exported behavior or rendered output, never source-text assertions.
- Before implementation handoff, run `just ci` or `npm run ci` using the setup
  in [Development](docs/development.md). If a check cannot run, report that
  explicitly rather than claiming validation.
- For documentation/instruction-only changes, code checks are not required:
  validate referenced paths, links, and commands instead. For instruction
  changes, also walk through a task that needs each moved rule and a nearby task
  that should not load it.
- Always inspect `git diff --stat`, `git diff --check`, and the final diff for
  generated state, user data, secrets, and unrelated rewrites before handoff.
