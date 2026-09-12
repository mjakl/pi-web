# Running web-pi as a service

web-pi is a long-running local server. On a workstation that means a systemd
user service: it starts with your session, restarts if it dies, and logs to the
journal.

## Install

Build a tarball from a checkout and install it globally, as
[the README](../README.md) describes. The install directory has to stay
writable: the bin symlinks the Pi SDK into its own `node_modules` at startup,
which is how a Pi upgrade reaches web-pi without a reinstall.

## The unit

`~/.config/systemd/user/web-pi.service`:

```ini
[Unit]
Description=web-pi
After=network.target

[Service]
Type=simple
ExecStart=%h/.local/share/npm/bin/web-pi
Environment=WEB_PI_HOST=127.0.0.1
Environment=WEB_PI_PORT=30142
Environment=PI_CODING_AGENT_DIR=%h/.pi/agent
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
```

`ExecStart` is wherever your package manager put the bin — `npm prefix -g` says
where. Then:

```bash
systemctl --user daemon-reload
systemctl --user enable --now web-pi
journalctl --user -u web-pi -f
loginctl enable-linger "$USER"   # keep it running while you are logged out
```

Upgrading is a new tarball, `npm install -g`, and
`systemctl --user restart web-pi`.

## Two apps, one agent directory

pi-web (the Next.js interface this one replaces) runs the same way, and both
read and write the same `~/.pi/agent`. That is the point — each sees the other's
sessions — but it has consequences:

- **Give them different ports.** pi-web defaults to 30141 and web-pi to 30142.
- **They share `web-push.json`**: one VAPID key pair and one list of browser
  subscriptions, in a file each app rewrites whole. Subscribing in one app can
  drop the other's subscriptions, and either app may notify a browser that
  subscribed through the other. Enable notifications in one of them.
- **Use one writer per session.** The apps and terminal Pi do not coordinate
  cross-process writes or live in-memory state. Do not run simultaneous live
  turns, rename, star, rewind, delete, or otherwise edit the same session from
  both. SDK appends are format-compatible, not a concurrency guarantee. Stop the
  other runtime before handing a session over.

Point either app at a different agent directory with `PI_CODING_AGENT_DIR` if
you would rather keep them apart.

## Preparing a future pi-web replacement

This branch prepares supporting material only. No history import, old-version
tag, repository merge, or GitHub setting change has occurred.

Before a later history-preserving import, an operator should verify the exact
old pi-web commit and create an agreed archival tag there. Do not invent a tag
name or treat the preparation branch as that archive. Retain both histories and
both license notices when performing the separately authorized import.

For a local trial without touching live state:

1. Stop writers before taking a consistent backup of the Pi agent directory.
   Keep the backup private: it can contain credentials, transcripts, trust
   decisions, and push keys.
2. Make a separate trial copy and set `PI_CODING_AGENT_DIR` to that copy. To
   test resource loading in isolation, also set `HOME` to a temporary home; Pi
   can discover `~/.agents/skills` independently of its agent directory. Review
   the copied settings and executable extensions before starting live turns.
3. Build and install the web-pi tarball using the README commands, with Node 24+
   and a compatible host Pi on `PATH`. Start it explicitly:

   ```bash
   PI_CODING_AGENT_DIR=/absolute/path/to/trial-agent \
     web-pi --host 127.0.0.1 --port 30142
   ```

4. Read representative saved sessions, stars, branches, and file paths. The
   local test suite covers Pi SessionManager fixtures, not every historical
   session or installed extension. Verify your needed extensions before moving
   normal work; the retained limitations are in [Behavior](behavior.md).
5. For the eventual cutover, stop the old server and terminal writers before
   pointing web-pi at the live directory. Change the service executable and
   environment deliberately; the command remains `web-pi`, with `WEB_PI_*`
   variables. Old Next.js startup commands and `PI_WEB_*` options are not
   aliases.

### Compatibility and rollback limits

Source and local adapter tests establish the shared Pi session JSONL format,
`pi-web:star` entries, and `pi-web-rewind` marker. Both apps use the host Pi
SDK; compatibility therefore also depends on the installed Pi version. No
database conversion is required, but this is not a guarantee that an older Pi
can read files changed by a newer Pi, nor a guarantee of all extension/UI
behavior.

Both implementations use `web-worktree-projects.json` for remembered worktree
identity and `web-push.json` for push keys/subscriptions. Pi settings, model
configuration, and trust remain user-owned. The installed-package smoke test
reads a disposable SessionManager session without a provider call.

The old and new HTTP interfaces differ. Ports also create different browser
origins: localStorage drafts, theme preferences, service workers, PWA installs,
and notification permissions are not automatically transferred from port 30141
to 30142. Cookies are **not port-scoped**; do not treat two ports on one
hostname as cookie isolation. If a later cutover reuses an origin, remove the
old PWA and service-worker registration and reload before installing the new
one. Re-enable notifications only in the chosen app.

Rollback means stopping web-pi and restarting the verified old version with a
compatible Pi install. Rewind/delete and newer writes are not undone by changing
the executable. Restore a backup only after deciding which later work would be
lost; never overwrite a live agent directory as an automatic rollback step.

### Validation workflow after import

The prepared GitHub workflow runs `just ci` on Node 24 with pnpm 12.3.4. That
command includes build, lint, typecheck, tests, and the installed-package smoke.
Its host Pi version is a CI fixture, not a pinned product SDK dependency.

The old required checks **Source validation** and **Node 22.19 runtime smoke**
need later GitHub reconciliation. The prepared workflow retains the first name
and folds package smoke into it; it does not emit the Node 22.19 check. Until an
operator updates branch protection after the import, that old required check can
block merging. This worktree has no remote or PR destination, so hosted Actions,
branch protection, publication, and remote review remain external checks.

## Exposing it

Only to a network you trust, and preferably behind something that authenticates.
web-pi has no accounts and no login; see the security note in
[the README](../README.md). `--lan` (or `WEB_PI_HOST=0.0.0.0`) binds every
interface and says so on startup.
