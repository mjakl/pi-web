# Pi Web

Pi Web is my personalized fork of [agegr/pi-web](https://github.com/agegr/pi-web), built as a local browser interface for the [Pi coding agent](https://github.com/earendil-works/pi). It uses Pi's existing configuration and session files, lets me work with those sessions in a browser, and runs live turns through Pi's SDK.

This fork follows my own workflow and is not intended to stay compatible with upstream. I am not seeking outside contributions. If it is useful to you, fork the repository and adapt your copy to your needs.

## What it does

- Browse, resume, rename, export, branch, and delete Pi sessions, with context, cost, compaction, and running-state details.
- Run agent turns with model, thinking-level, and tool controls; manage provider credentials, models, plugins, and skills from the browser.
- Keep assistant text and images visible with structured tool and process details.
- Browse and upload project files, inspect Git changes, and preview source, Markdown, images, audio, PDFs, and DOCX files.
- Switch, create, and remove Git worktrees while keeping related sessions grouped. See [Worktrees in Pi Web](./docs/worktrees.md).

## Host Pi requirement

Pi Web runs Pi's SDK in-process but does not ship Pi. Install a compatible host Pi and make its executable available on `PATH`:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@~0.84.3
```

Pi Web requires `@earendil-works/pi-coding-agent` `>=0.84.3 <0.85.0`. It supports Linux, macOS, and Windows; Android and Termux are not supported.

At startup, Pi Web ignores only its checkout-local `node_modules/.bin/pi`, then uses the first `pi` found in `PATH` and `PATHEXT` order. If that executable or its Pi package graph is missing, incompatible, or inconsistent, startup fails with instructions instead of trying a later executable. After you install or upgrade Pi, restart Pi Web so it validates the new runtime.

## Run from a checkout

Pi Web requires Node.js 22.19.0 or newer and npm, plus the host Pi installation described above. Clone the fork you intend to maintain. For this repository:

```bash
git clone https://github.com/mjakl/pi-web.git
cd pi-web
npm install
npm run dev
```

Open [http://127.0.0.1:30141](http://127.0.0.1:30141) after the development server is ready. It does not open a browser automatically. If no model provider is configured, use the **Models** panel to sign in or add an API key.

To update an existing checkout, stop the server, pull the branch you maintain, refresh dependencies, and start it again:

```bash
git pull --ff-only
npm install
npm run dev
```

The Pi packages installed by `npm install` are build-time development dependencies. `npm run dev` and `npm start` still use the host `pi` selected from `PATH`.

Use `npm run dev:lan` only when you intend to accept connections from other machines. The available scripts and Node.js requirement are defined in [`package.json`](./package.json). Architecture notes, the module ownership map, maintenance checks, and development constraints are in [`AGENTS.md`](./AGENTS.md).

## Run the published package

With Node.js and a compatible host Pi installed, run Pi Web without cloning the repository:

```bash
npx @agegr/pi-web
```

For a persistent command, install it globally and run `pi-web`:

```bash
npm install --global @agegr/pi-web
pi-web
```

Both commands validate the first host `pi` on `PATH` before starting. Open [http://127.0.0.1:30141](http://127.0.0.1:30141) when the server is ready.

## Local data and configuration

- Pi Web reads Pi data from `~/.pi/agent` by default. Set `PI_CODING_AGENT_DIR` before starting the server to use another agent directory.
- Sessions are stored below `sessions/<encoded-cwd>/`. Pi Web must be able to read the agent directory and the working directories recorded in those sessions.
- Model settings and credentials are shared with Pi. Changes made in the **Models** panel affect both interfaces.
- Server-side model and API requests honor `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY`.
- The file browser is limited to working directories and known project or session roots. It is not a general filesystem browser.

## Security

Pi Web can run agent tools and project commands. It has no built-in authentication and does not restrict request Host or Origin headers. The default development setup listens only on `127.0.0.1`; if you bind it to a non-loopback address, use a trusted network or an external security layer that restricts access.

Project resources can run local code. Pi Web leaves project extensions, skills, and other trust-requiring resources disabled until you trust the project. Only trust repositories you control or have reviewed.

## License

[MIT](./LICENSE)
