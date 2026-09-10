# web-pi repository guide

web-pi is a server-rendered browser interface for the Pi coding agent: Hono
renders HTML, HTMX swaps fragments, and one SSE stream per open session pushes
re-rendered fragments while a turn runs. The server owns all UI state; the
browser holds none.

## Working agreement

- Use `pnpm` and the tool pins in `mise.toml`. Automation lives in the
  `justfile`; do not add `package.json` scripts.
- `just qa` must pass before handoff. Rerun it after any later edit. `just ci`
  is the non-mutating variant.
- Never start the dev server on port 30141 or write into `~/.pi/agent` from
  tests. Experiments that run a model use `PI_CODING_AGENT_DIR` pointing at a
  temporary directory with copied `auth.json`, `models.json`, and a minimal
  `settings.json`.
- The Pi SDK is never pinned: `scripts/link-host-pi.ts` points
  `node_modules/@earendil-works/*` at the `pi` on `PATH`, and `prepare` plus
  every `just` recipe that compiles or runs code re-links first. Pi must be
  installed separately; `just doctor` reports which install was resolved. Never
  add an `@earendil-works/*` dependency to `package.json`.
- `CLAUDE.md` is a symlink to this file.

## Layout and boundaries

```text
src/core       rules and ports: transcript projection, session derivations
               (stars, statistics, branches), context usage, composer input
               rules, path containment, workspace
src/adapters   Pi SDK, filesystem, and in-memory implementations of the ports
src/web        Hono routes, JSX views, HTMX/SSE delivery, client bundle
src/container.ts  the only file that wires adapters into the core
src/main.ts    process entrypoint
tests/         vitest, mirrors src/ and scripts/
scripts/       repository tooling: host Pi linking, doctor, doc checks
```

Rules enforced by `.oxlintrc.json`:

- `src/core` may import SDK **types** but never call the SDK, Node, or Hono.
- `src/adapters` never import `src/web`.
- `src/web` never imports adapters or the SDK; it talks to `Workspace`.
- No parent-relative imports; use `@core/*`, `@adapters/*`, `@web/*`,
  `@scripts/*`, `#/*`.
- Hono JSX uses `class`, never `className`. No dynamic imports in `src/`.
- `src/web/client/*` is bundled by esbuild and may import `@core/*`; anything it
  imports must run in a browser (no Node, no SDK).

Read `docs/architecture.md` before changing a port, the SSE contract, or context
accounting. Shell commands run with a sanitised environment; read
`docs/adr/0001-project-command-environment.md` before changing that.

## Validation

- `just test` runs vitest. Web tests call `app.request()` against the fake world
  in `src/adapters/fake/index.ts`; no Pi installation is needed. A new port
  method lands there in the same change, or every web test stops running.
- Tests that write session files build them with `SessionManager` in a `mkdtemp`
  directory and pass that as the agent directory.
- Add or update the nearest test for changed behaviour; assert on rendered
  output or port behaviour, never on source text.
- Inspect `git status` and the diff before handoff.
