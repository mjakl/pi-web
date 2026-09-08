# Development

## Setup

Use [mise](https://mise.jdx.dev/) for the development tool versions in
[mise.toml](../mise.toml). These pins do not change the runtime minimum in
[package.json](../package.json).

After cloning, install the tools:

```bash
mise trust
mise install
```

Make sure the separate host Pi described in the
[README](../README.md#get-started) is on `PATH`. Development, builds,
typechecking, and tests all need that installation. Leave `NODE_ENV` unset so
`npm ci` installs dev dependencies, then run:

```bash
mise exec -- npm ci
mise exec -- just ci
```

With mise active in your shell, omit `mise exec --`. On Windows, use a shell
supported by just, such as Git Bash.

## Development server

Before `npm run dev`, check for an existing listener:

```bash
lsof -nP -iTCP:30141 -sTCP:LISTEN
```

Use the platform's equivalent listener inspection if `lsof` is unavailable.
Reuse a healthy Pi Web process. A second dev server for the same checkout cannot
work around the port because both processes contend for `.next/dev/lock`.

Do not run `next build` or `npm run build` during normal development: they write
production state into `.next/` and interfere with the dev server. Development
uses Turbopack; do not use `next dev --webpack` as a fallback.

A browser-only `Module ... factory is not available` overlay commonly means a
stale HMR graph. Reload the page explicitly, then compare current server logs
and a direct HTTP/API request. Restart only if the failure reproduces from a
fresh page and server-side checks fail too. Stop the exact process gracefully,
move `.next/` to a temporary backup, and restart with `npm run dev`.

Next.js may append a generated `BEGIN:nextjs-agent-rules` block to `AGENTS.md`
when the dev server starts. Inspect `git status` afterward and exclude that
block from unrelated changes.

## Checks and fixes

[package.json](../package.json) owns the commands; [justfile](../justfile) is a
shorter entry point:

| Command                              | What it does                                                   |
| ------------------------------------ | -------------------------------------------------------------- |
| `just fix`                           | Apply supported Oxlint and ESLint fixes, then Oxfmt formatting |
| `just lint`                          | Check Oxfmt formatting, typed Oxlint, and Next ESLint rules    |
| `just typecheck`                     | Run TypeScript with `--noEmit`                                 |
| `just test-one bin/host-pi.test.mjs` | Run selected native Node tests with the host Pi preload        |
| `just test`                          | Run the full native Node suite                                 |
| `just qa` / `just ci`                | Run lint, typecheck, and tests, stopping on failure            |

QA and CI must remain non-mutating validation of source. Disposable generated
outputs are allowed: host shims in `node_modules`, TypeScript incremental state,
and temporary test fixtures. Neither command invokes `fix`.

Apply fixes explicitly with `just fix` or `npm run fix`, then inspect the diff.
Do not enable suggestion or dangerous fixes. Preserve intentional empty-string
and false defaults rather than replacing `||` with `??` mechanically.

For formatting alone, run `npm exec -- oxfmt .`; check without writing with
`npm exec -- oxfmt --check .`. Keep formatting policy and exclusions in
[.oxfmtrc.json](../.oxfmtrc.json), not per-command ignore lists. Keep semantic
lint rules scoped to TypeScript in [.oxlintrc.json](../.oxlintrc.json), with
compiler checking off; `tsc` owns compiler diagnostics.

TypeScript reads host Pi shims rather than writing them. After changing host Pi,
or if an `@earendil-works` import cannot resolve, run `npm run prepare` before a
standalone typecheck.

## Focused tests

Use `just test-one <file>` or `npm run test:one -- <file>`, not a raw Node test
command. These runners refresh shims and use the host preload, resolving Pi the
way the server does; shims alone cover only the package root.

Put Node runner options before file paths and quote name patterns:

```bash
just test-one --test-name-pattern "first pi" bin/host-pi.test.mjs
# Equivalent npm command:
npm run test:one -- --test-name-pattern "first pi" bin/host-pi.test.mjs
```

The unread-glow animation has a standalone Chromium regression check. With
`agent-browser` and its browser installed, run:

```bash
npm run test:one -- scripts/session-glow.browser.test.mjs
```

It renders the real session indicator with the application stylesheet, checks
the applied animation and reduced motion, then closes its browser and temporary
loopback server. It is separate from `just ci`, which does not require a
browser.

## CI

[GitHub Actions](../.github/workflows/validation.yml) runs source validation
(`npm ci`, then `just ci`) and a separate [package runtime smoke](packaging.md)
on pull requests and pushes to `main`. Both jobs install matching host Pi
packages outside the checkout and use isolated Pi state. The smoke runs
separately so routine checks do not build into `.next/` or start a service.
