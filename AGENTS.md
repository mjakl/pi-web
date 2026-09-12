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
  `settings.json`. Anything that writes settings, trust, skills or packages —
  every adapter in the configuration layer — takes the agent directory as an
  argument for exactly this reason; never call `getAgentDir()` from one.
- `npx skills add` is the one exception that cannot be redirected: it resolves
  Pi's agent directory itself and installs into the real `~/.pi/agent/skills`
  and `~/.agents/.skill-lock.json` whatever `PI_CODING_AGENT_DIR` says. Do not
  run a skill install from a test or an unattended check.
- The Pi SDK is never pinned: `src/host-pi.ts` points
  `node_modules/@earendil-works/*` at the `pi` on `PATH`. In a checkout
  `prepare` and every `just` recipe that compiles or runs code re-link first; in
  an installed package the bin does it on every start. Pi must be installed
  separately; `just doctor` reports which install was resolved. Never add an
  `@earendil-works/*` dependency to `package.json`.
- `dependencies` are only what stays external in `dist/server.js` (the Pi SDK,
  `mammoth`, `web-push`, `undici`); everything else esbuild bundles and belongs
  in `devDependencies`. Changing either list means running `just smoke`.
- `CLAUDE.md` is a symlink to this file.

## Layout and boundaries

```text
src/core       rules and ports: transcript projection, session derivations
               (stars, statistics, branches), project selection, the
               conversation rail layout, terminal-output conversion, context
               usage, composer input rules, path containment and local file
               links, HTML escaping, file kinds, Git status parsing,
               patches, frontmatter, worktree identity,
               the skill frontmatter toggle, skill install metadata, package
               list semantics, startup model preferences, tool schemas,
               pending extension dialogs and custom-UI frames, terminal key
               encoding, the run-completion rule, workspace
src/adapters   Pi SDK, filesystem, Git, and in-memory implementations of the
               ports
src/web        Hono routes, JSX views, HTMX/SSE delivery, client bundle, the
               generated service worker and manifest. routes/, views/ and
               client/ are split one module per area of the screen — sidebar,
               shell, transcript, composer, files — so five ports can run at
               once; routes/shared.ts holds what they all need
src/web/styles pi-web's stylesheets, verbatim, plus areas/<area>.css
src/container.ts  the only file that wires adapters into the core
src/server.ts  process entrypoint; src/cli.ts the flags and startup behind the
               bin, src/host-pi.ts the SDK resolution both of them use,
               src/http.ts the proxy-aware global dispatcher
bin/web-pi.js  the published entry point: imports dist/cli.js, nothing else
tests/         vitest, mirrors src/ and scripts/; tests/client runs the
               bundle's modules in happy-dom, tests/smoke only from `just smoke`
scripts/       repository tooling: host Pi linking, doctor, doc checks
```

Rules enforced by `.oxlintrc.json`:

- `src/core` may import SDK **types** but never call the SDK, Node, or Hono.
- `src/adapters` never import `src/web`.
- `src/web` never imports adapters or the SDK; it talks to `Workspace`.
- No parent-relative imports; use `@/*` (src root), `@core/*`, `@adapters/*`,
  `@web/*`, `#/*` (tests).
- One escaper: `escapeHtml` in `src/core/html.ts`. Views, the ANSI converter,
  and the client bundle all build markup from untrusted text, and a second
  escaper is how one of them ends up missing an entity.
- Hono JSX uses `class`, never `className`. No dynamic imports in `src/`; the
  two exceptions carry a narrowed lint override — `src/web/client/mermaid.ts`
  loads the separately bundled `static/mermaid.js` by URL, and `src/cli.ts`
  loads the server only after the SDK links are in place.
- `src/web/client/*` is bundled by esbuild and may import `@core/*`; anything it
  imports must run in a browser (no Node, no SDK). `main.ts` and
  `mermaid-lib.ts` are the two bundle entry points.
- Anything a page can do without script does: the workspace menu is a native
  `popover` anchored in CSS, and the subagent fold and the extension widget
  panel are `<details>` elements the server fills on demand.
- Web Push keys and subscriptions live in the agent directory (`web-push.json`).
  Never let a test or an unattended check reach the real one:
  `createWebPushNotifier` takes the directory, and its `send` is injectable so
  nothing has to talk to a push service.

## Styling

web-pi is a pixel port of pi-web, so pi-web's CSS is the specification, not an
inspiration:

- `src/web/styles/base.css`, `globals.css`, `settings.css` and `embedded.css`
  are pi-web's own files. **Never edit them.** They are re-copied when pi-web
  changes.
- Markup carries pi-web's class names and pi-web's inline styles (camelCase to
  kebab, numbers to px), so those stylesheets apply unchanged. The UI map in the
  porting notes names the class of every region; when it names one, use it.
- There is no utility framework. A `class="flex gap-2 text-sm"` is a bug: reach
  for the pi-web class, or an inline style with the values pi-web uses.
- New rules go in `src/web/styles/areas/<area>.css`, the one stylesheet an area
  may edit, or in `web-pi.css` for something pi-web gets from Next.js — with a
  comment saying why. `index.css` fixes the cascade order.
- Icons come from `src/web/views/icons.tsx`, which holds every SVG pi-web draws.
  Add one there, copied from pi-web, rather than inline in a view.
- An HTMX swap has to replace a whole owner subtree (`.chat-transcript`,
  `.session-row`, `#file-panel`): pi-web's CSS keys on container relationships,
  and a partial swap breaks them silently.

Read `docs/architecture.md` before changing a port, the SSE contract, or context
accounting. Shell commands run with a sanitised environment; read
`docs/adr/0001-project-command-environment.md` before changing that.

Every file request goes through `authorize` in `src/core/workspace.ts`; add a
root through the allowed-root flow there, never a check in a route handler.
`docs/specs/files-git.md` is the behaviour it mirrors.

## Validation

- `just test` runs vitest. Web tests call `app.request()` against the fake world
  in `src/adapters/fake/index.ts`; no Pi installation is needed. A new port
  method lands there in the same change, or every web test stops running.
- Tests that write session files build them with `SessionManager` in a `mkdtemp`
  directory and pass that as the agent directory.
- `tests/client` mounts the markup a view renders and dispatches DOM events at
  the client module; `setup.ts` fakes htmx and undoes every listener after each
  test. happy-dom has no layout, so a test that needs geometry sets it.
- Add or update the nearest test for changed behaviour; assert on rendered
  output or port behaviour, never on source text.
- `just build` writes `dist/` and the built assets; `just smoke` packs the
  package, installs the tarball into a throwaway project, and serves a fixture
  session from it. Run it after touching `bin/`, `files`, dependencies, the
  build, or startup. `just ci` includes it.
- Inspect `git status` and the diff before handoff.
