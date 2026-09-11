# web-pi

A server-rendered web interface for the
[Pi coding agent](https://github.com/earendil-works/pi), built with Hono, Hono
JSX and HTMX, styled by pi-web's own stylesheets. It reads the session files Pi
already keeps under `~/.pi/agent` and runs live turns in-process through Pi's
SDK, so the terminal and the browser are two views of the same sessions.

The server owns all UI state: pages and fragments are rendered on the server and
swapped by HTMX, and one SSE stream per open session pushes re-rendered
fragments while a turn runs. The browser keeps no copy of the conversation.

## Install and run

Install Pi first and keep it on your `PATH`. web-pi compiles and runs against
that install rather than a pinned copy: it links `@earendil-works/*` to the `pi`
you already have, so the CLI and the browser never disagree about the session
format. Node 24 or newer is required.

web-pi is not on npm. Build a tarball from a checkout and install that:

```bash
just build && pnpm pack          # web-pi-<version>.tgz
npm install -g ./web-pi-0.1.0.tgz
web-pi                           # http://127.0.0.1:30142
```

The `web-pi` bin relinks the Pi SDK into its own install whenever the links are
missing or point at an older Pi, so upgrading Pi needs nothing but a restart.

| Flag               | Default                       |
| ------------------ | ----------------------------- |
| `--host <name>`    | `127.0.0.1`, or `WEB_PI_HOST` |
| `--port <number>`  | `30142`, or `WEB_PI_PORT`     |
| `--lan`            | bind `0.0.0.0`; read Security |
| `--runtime <name>` | `pi`, or `fake` for a demo    |
| `--help`           | the flags                     |
| `--version`        | the web-pi and Pi versions    |

Environment: `WEB_PI_HOST`, `WEB_PI_PORT`, `WEB_PI_RUNTIME`,
`WEB_PI_DEFAULT_CWD` (the folder new sessions start in, home by default),
`PI_CODING_AGENT_DIR` (Pi's agent directory). Server-side HTTP honours
`HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY`.

To run it as a service, see [docs/deployment.md](docs/deployment.md).

## Security

web-pi runs agent tools and project commands. It has no accounts, no login, and
no built-in authentication, and it does not check the `Host` or `Origin` header.
Keep it on `127.0.0.1` unless you have a trusted network or an external access
layer in front of it; `--lan` prints a warning for the same reason.

Project resources can run local code. Extensions, skills, and other
trust-requiring resources of a project stay dormant until you trust that
project. Trust only repositories you wrote or have read.

## Work on it

```bash
mise install
pnpm install         # links the Pi SDK; needs `pi` on PATH
just doctor          # which pi this checkout resolved
just dev             # http://127.0.0.1:30142, with reload and asset watchers
```

`just dev` runs the TypeScript sources through `tsx` and watches the stylesheet
and the client bundle. `just build` produces what the package ships — `dist/`
from esbuild plus the built assets in `static/` — and `just start` serves it the
way the installed bin does. Tests always run against the sources, never against
`dist/`.

After upgrading Pi, run `just link-pi` (or any `just` recipe) to repoint the
links.

## Checks

`just qa` applies fixes then runs lint, typecheck, and tests. `just ci` runs the
same without writing, plus `just smoke`, which packs the package, installs the
tarball into a throwaway project, and serves a fixture session from it.
`just test-one tests/web` runs a subset.

See `AGENTS.md` for boundaries and `docs/architecture.md` for the design.
