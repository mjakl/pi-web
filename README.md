# web-pi

A server-rendered web interface for the
[Pi coding agent](https://github.com/earendil-works/pi), built with Hono, Hono
JSX, HTMX, Tailwind, and daisyUI. It reads the session files Pi already keeps
under `~/.pi/agent` and runs live turns in-process through Pi's SDK.

## Run

Install Pi first: web-pi compiles and runs against the `pi` on your `PATH`
rather than a pinned copy, and `pnpm install` links that install into
`node_modules/@earendil-works/`.

```bash
mise install
pnpm install
just doctor          # which pi on PATH this checkout resolved
just dev             # http://127.0.0.1:30142
```

After upgrading Pi, run `just link-pi` (or any `just` recipe) to repoint the
links.

Environment: `WEB_PI_PORT` (default 30142), `WEB_PI_HOST` (127.0.0.1),
`WEB_PI_DEFAULT_CWD` (home), `PI_CODING_AGENT_DIR` (Pi's agent directory),
`WEB_PI_RUNTIME=fake` for a scripted runtime that needs no model.

## Checks

`just qa` applies fixes then runs lint, typecheck, and tests. `just ci` runs the
same without writing. `just test-one tests/web` runs a subset.

See `AGENTS.md` for boundaries and `docs/architecture.md` for the design and the
list of pi-web features not yet carried over.
