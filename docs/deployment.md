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
- **A session open in both is edited by both.** Renames, stars, and forks are
  appends through Pi's own `SessionManager`, so they interleave safely, but two
  live turns in the same session do not: run a turn in one place at a time.

Point either app at a different agent directory with `PI_CODING_AGENT_DIR` if
you would rather keep them apart.

## Exposing it

Only to a network you trust, and preferably behind something that authenticates.
web-pi has no accounts and no login; see the security note in
[the README](../README.md). `--lan` (or `WEB_PI_HOST=0.0.0.0`) binds every
interface and says so on startup.
