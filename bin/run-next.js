#!/usr/bin/env node
"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { resolveHostPi } = require("./host-pi");
const { writeHostPiShims } = require("./link-host-pi");
const { wireChildProcessLifecycle } = require("./process-lifecycle");

function runNext(mode, args, { pkgDir = path.join(__dirname, ".."), env = process.env, requireBuild = false } = {}) {
  const runtime = resolveHostPi({ env, checkoutDir: pkgDir });
  // Development and build resolve Pi through node_modules, where Turbopack,
  // webpack and TypeScript never see the preload's resolve hook. Prebuilt
  // output imports Pi by name, so "start" needs no writable checkout.
  if (mode !== "start") writeHostPiShims(runtime, pkgDir);
  if (requireBuild && !fs.existsSync(path.join(pkgDir, ".next"))) {
    throw new Error("Build artifacts not found. Please report this issue.");
  }
  const nextBin = require.resolve("next/dist/bin/next", { paths: [pkgDir] });
  const preload = path.join(__dirname, "host-pi-runtime.js");
  const child = spawn(process.execPath, ["--require", preload, nextBin, mode, ...args], {
    cwd: pkgDir,
    env: {
      ...env,
      PI_WEB_HOST_PI: JSON.stringify(runtime),
    },
    stdio: "inherit",
  });
  wireChildProcessLifecycle(child);
  return child;
}

if (require.main === module) {
  const [mode, ...args] = process.argv.slice(2);
  if (mode !== "dev" && mode !== "start" && mode !== "build") {
    console.error("Usage: run-next.js <dev|start|build> [Next.js options]");
    process.exit(1);
  }
  try {
    runNext(mode, args);
  } catch (error) {
    console.error(`[pi-web] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

module.exports = { runNext };
