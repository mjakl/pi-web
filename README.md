# Pi Web

Pi Web is my personalized fork of [agegr/pi-web](https://github.com/agegr/pi-web), built as a local browser interface for the [Pi coding agent](https://github.com/earendil-works/pi). It uses Pi's existing configuration and session files, lets me work with those sessions in a browser, and runs live turns through Pi's SDK.

This fork follows my own workflow and is not intended to stay compatible with upstream. I am not seeking outside contributions. If it is useful to you, fork the repository and adapt your copy to your needs.

## What it does

- Browse, resume, rename, export, branch, and delete Pi sessions, with context, cost, compaction, and running-state details.
- Run agent turns with model, thinking-level, and tool controls; manage provider credentials, models, plugins, and skills from the browser.
- Keep assistant text and images visible with structured tool and process details.
- Browse and upload project files, inspect Git changes, and preview source, Markdown, images, audio, PDFs, and DOCX files.
- Switch, create, and remove Git worktrees while keeping related sessions grouped. See [Worktrees in Pi Web](./docs/worktrees.md).

## Run from a checkout

Pi Web requires Node.js 22.19.0 or newer and npm. Clone the fork you intend to maintain. For this repository:

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

Use `npm run dev:lan` only when you intend to accept connections from other machines. The available scripts and Node.js requirement are defined in [`package.json`](./package.json). Architecture notes, the module ownership map, maintenance checks, and development constraints are in [`AGENTS.md`](./AGENTS.md).

## Local data and configuration

- Pi Web reads Pi data from `~/.pi/agent` by default. Set `PI_CODING_AGENT_DIR` before starting the server to use another agent directory.
- Sessions are stored below `sessions/<encoded-cwd>/`. Pi Web must be able to read the agent directory and the working directories recorded in those sessions.
- Model settings and credentials are shared with Pi. Changes made in the **Models** panel affect both interfaces.
- Server-side model and API requests honor `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY`.
- The file browser is limited to working directories and known project or session roots. It is not a general filesystem browser.

## Security

Pi Web can run agent tools and project commands. It has no built-in authentication and listens only on `127.0.0.1` in the default development setup. If you bind it to a non-loopback address, use a trusted network or an external security layer that restricts access. Host and Origin checks do not provide access control.

Project resources can run local code. Pi Web leaves project extensions, skills, and other trust-requiring resources disabled until you trust the project. Only trust repositories you control or have reviewed.

## License

[MIT](./LICENSE)
