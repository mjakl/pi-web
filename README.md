# Pi Web

**A local workspace for Pi, built for clarity and responsiveness.**

Pi Web puts your [Pi coding agent](https://github.com/earendil-works/pi) conversations, project files, and changes in one browser window. Follow the agent's work, inspect a diff beside its explanation, and pick up an existing session. It uses the Pi configuration and session files already on your computer, so you can move between the terminal and browser without importing conversations or maintaining a second set of settings.

![Pi Web in dark mode, with session history, agent tool calls, and a working-tree diff beside the conversation](./docs/images/file-diff.png)

*Review the change beside the conversation. Screenshots show the current UI with fictional demo sessions in a local example project.*

## Why Pi Web

- **Little magic.** Pi's session files stay authoritative. Live turns run through Pi's SDK in the server process, and tools and orchestration come from Pi and your extensions. The browser gives you access to that work without adding another agent system.
- **Care in the details.** Process details fold away when you want the answer. Tool output, diffs, and subagent results have their own views. Model and reasoning controls sit in the composer; history, context, and files stay within reach.
- **Work only when needed.** Browsing saved sessions does not start an agent. The session list reads bounded metadata, conversation history loads progressively, and live updates stream to the browser. This avoids agent startup just to browse and limits how much history the browser has to render at once.

This is a personalized fork of [agegr/pi-web](https://github.com/agegr/pi-web), shaped around its maintainer's daily workflow. It is not intended to stay compatible with upstream.

## What you can do

- Browse, resume, rename, export, fork, clone, and delete Pi sessions. Rewind a conversation to an earlier message or explore its full history. Sessions from the same repository stay together.
- Run agent turns with model, reasoning-level, and tool controls. You can steer work in progress, queue a follow-up, compact context, stop a run, attach images, and use slash commands.
- Read the result without losing the process. Expand reasoning, tool calls, command output, and subagent results, with token usage, context, and active time available alongside them.
- Work with project files beside the conversation. Browse or upload files, preview common source and document formats, inspect Git changes, and insert file or line references into the composer.
- Select existing working folders and Git worktrees from one project picker. A session remains readable even if its original folder no longer exists.
- Manage Pi skills and plugin packages for the global scope or a trusted project. Choose between Chat only, Read only, Default, and Full tool presets.
- Install Pi Web as a PWA and receive browser notifications when a task finishes or an extension needs input.

![Expanded subagent review with completion status, formatted results, and disclosures for the prompt, run details, and raw data](./docs/images/session-tools.png)

*Inspect a subagent's result, then open its prompt, run details, or raw output. Subagent tools come from your installed Pi extensions.*

<details>
<summary>Appearance and settings</summary>

![Pi Web in light mode with appearance, context-warning threshold, tool presets, and completion sound settings](./docs/images/settings.png)

*Settings keep common controls together; project skills and plugins load only after you trust the project.*

</details>

## Get started

Pi Web requires Node.js 22.19.0 or newer, npm, and a separate Pi installation. Install Pi and make sure its `pi` executable is on `PATH`:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

If Pi does not have a model provider yet, configure one in the Pi terminal. Pi Web ignores the checkout-local `node_modules/.bin/pi`, then uses the first matching `pi` executable on `PATH` (with executable extensions from `PATHEXT` on Windows) and loads Pi's packages in-process.

Pi Web supports Linux, macOS, and Windows. Android and Termux are not supported.

Clone this fork and start the development server:

```bash
git clone https://github.com/mjakl/pi-web.git
cd pi-web
npm install
npm run dev
```

Open [http://127.0.0.1:30141](http://127.0.0.1:30141) when the server is ready. For the production server and installable PWA, stop the development server, then run:

```bash
npm run build
npm start
```

To update a checkout, stop the server and refresh the code and dependencies:

```bash
git pull --ff-only
npm install
```

Then restart the development server, or rebuild before starting the production server. The Pi packages installed with the checkout are build-time dependencies; both modes still use the host Pi selected from `PATH`.

## What stays with Pi and Git

- **Worktrees and branches:** Pi Web discovers existing worktrees and switches between their folders. It does not create, delete, prune, or change branches in a worktree. Use Git or another worktree tool for those operations. See [Worktrees in Pi Web](./docs/worktrees.md).
- **Provider accounts and model configuration:** Sign in, add API keys, and edit provider or model metadata in the Pi terminal. Pi Web does not read, write, or serve credentials; it lists the models made available by Pi and lets you select one for a session.
- **Agent extensions:** Tools and subagent orchestration come from Pi and the extensions you install. This fork does not add a separate subagent runtime or profile editor.
- **Updates:** Update the checkout and your host Pi installation with their normal tools, then restart Pi Web. There is no browser-based updater.

## Data, files, and network access

- Pi Web reads Pi data from `~/.pi/agent` by default. Set `PI_CODING_AGENT_DIR` before startup to use another agent directory.
- Session files stay under Pi's `sessions/<encoded-cwd>/` directories. Pi Web must be able to read the recorded working directories.
- The file browser is limited to working directories and known project or session roots. It is not a general filesystem browser.
- Type `@` in the composer to find project files. `@~/`, `@/`, `@./`, and `@../` complete paths one directory at a time within paths Pi Web can list.
- Server-side model and API requests honor `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY`.

Checkout scripts, including the explicit LAN variants, are listed in [`package.json`](./package.json).

## Security

Pi Web can run agent tools and project commands. It has no user accounts, login screen, or built-in authentication, and does not restrict request Host or Origin headers. Keep the default `127.0.0.1` binding unless you have a trusted network or an external access-control layer.

Project resources can run local code. Pi Web leaves project extensions, skills, and other trust-requiring resources disabled until you trust the project. Trust only repositories you control or have reviewed.

## Maintaining a fork

This repository is not seeking outside contributions. If Pi Web suits you, fork it and adapt your copy. Architecture notes, module ownership, maintenance checks, and development constraints are in [`AGENTS.md`](./AGENTS.md).

## License

[MIT](./LICENSE)
