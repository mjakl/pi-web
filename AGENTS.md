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
- The Pi SDK is a pinned dependency. `just doctor` compares the pin with the
  `pi` on `PATH`; bump all three `@earendil-works/*` pins together.
- `CLAUDE.md` is a symlink to this file.

## Layout and boundaries

```text
src/core       rules and ports: transcript projection, context usage, workspace
src/adapters   Pi SDK and in-memory implementations of the ports
src/web        Hono routes, JSX views, HTMX/SSE delivery
src/container.ts  the only file that wires adapters into the core
src/main.ts    process entrypoint
tests/         vitest, mirrors src/
```

Rules enforced by `.oxlintrc.json`:

- `src/core` may import SDK **types** but never call the SDK, Node, or Hono.
- `src/adapters` never import `src/web`.
- `src/web` never imports adapters or the SDK; it talks to `Workspace`.
- No parent-relative imports; use `@core/*`, `@adapters/*`, `@web/*`, `#/*`.
- Hono JSX uses `class`, never `className`. No dynamic imports in `src/`.

Read `docs/architecture.md` before changing a port, the SSE contract, or context
accounting.

## Validation

- `just test` runs vitest. Web tests call `app.request()` against the fake world
  in `src/adapters/fake/index.ts`; no Pi installation is needed.
- Add or update the nearest test for changed behaviour; assert on rendered
  output or port behaviour, never on source text.
- Inspect `git status` and the diff before handoff.
