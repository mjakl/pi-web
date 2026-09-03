#!/usr/bin/env node
"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getUnsupportedNodeVersionMessage, isNodeVersionSupported } = require("./node-version");

if (!isNodeVersionSupported(process.versions.node)) {
  console.error(getUnsupportedNodeVersionMessage(process.versions.node));
  process.exit(1);
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("node:path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("node:fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getHelpText, parseLaunchOptions } = require("./pi-web-options");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { runNext } = require("./run-next");

let launchOptions;
try {
  launchOptions = parseLaunchOptions();
} catch (error) {
  fs.writeSync(
    process.stderr.fd,
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}

if (launchOptions.help) {
  fs.writeSync(process.stdout.fd, getHelpText());
  process.exit(0);
}

const { port, hostname } = launchOptions;

const pkgDir = path.join(__dirname, "..");
const loopbackHostnames = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

if (!loopbackHostnames.has(hostname)) {
  console.warn(
    `Warning: pi-web is listening on ${hostname} without built-in authentication. Only use this on a trusted network or behind an external security layer.`,
  );
}

try {
  runNext("start", ["-p", port, "-H", hostname], { pkgDir, requireBuild: true });
} catch (error) {
  console.error(`[pi-web] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
