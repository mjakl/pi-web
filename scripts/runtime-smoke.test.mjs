import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Run separately from the unit suite, against an installed runtime-only tarball.
test("Node 22.19 serves a persisted session through the packaged bin and host Pi", { timeout: 90_000 }, async () => {
  assert.equal(process.versions.node, "22.19.0");
  assert.ok(process.env.PI_WEB_SMOKE_PACKAGE, "Set PI_WEB_SMOKE_PACKAGE to the installed package directory");
  const pkg = path.resolve(process.env.PI_WEB_SMOKE_PACKAGE);
  // Inspect the install, not Node's global lookup paths in the invoking shell.
  for (const modules of [path.join(pkg, "node_modules"), path.resolve(pkg, "../..")]) {
    for (const dependency of ["typescript", "@earendil-works"]) {
      await assert.rejects(access(path.join(modules, dependency)), { code: "ENOENT" });
    }
  }

  const dir = await mkdtemp(path.join(os.tmpdir(), "pi-web-runtime-smoke-"));
  let child;
  let closed;
  try {
    const home = path.join(dir, "home");
    const agentDir = path.join(home, ".pi", "agent");
    const sessionDir = path.join(agentDir, "sessions", "--runtime-smoke--");
    await mkdir(sessionDir, { recursive: true });
    const sessionId = "11111111-1111-4111-8111-111111111111";
    const timestamp = "2026-01-01T00:00:00.000Z";
    await writeFile(path.join(sessionDir, `${timestamp.replaceAll(":", "-")}_${sessionId}.jsonl`), [
      { type: "session", version: 3, id: sessionId, timestamp, cwd: home },
      { type: "message", id: "11111111", parentId: null, timestamp,
        message: { role: "user", content: [{ type: "text", text: "Runtime smoke fixture" }], timestamp: Date.parse(timestamp) } },
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");

    // Ask the OS for an available loopback port; do not use a developer's port.
    const reservation = createServer();
    reservation.listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const port = reservation.address().port;
    await new Promise((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));

    child = spawn(process.execPath, [path.join(pkg, "bin", "pi-web.js"), "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: home,
      // Do not inherit credentials, loader overrides, project hooks, or live Pi state.
      env: {
        PATH: process.env.PATH,
        HOME: home,
        PI_CODING_AGENT_DIR: agentDir,
        NODE_ENV: "production",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    closed = once(child, "close");
    let output = "";
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error(`Server readiness timed out:\n${output}`)), 30_000);
      const onExit = (code, signal) => finish(new Error(`Server exited (${code ?? signal}):\n${output}`));
      const onOutput = (chunk) => {
        output += chunk;
        if (/Ready in/i.test(output)) finish();
      };
      function finish(error) {
        clearTimeout(timer);
        child.off("error", finish);
        child.off("exit", onExit);
        child.stdout.off("data", onOutput);
        child.stderr.off("data", onOutput);
        if (error) reject(error);
        else resolve();
      }
      child.once("error", finish);
      child.once("exit", onExit);
      child.stdout.on("data", onOutput);
      child.stderr.on("data", onOutput);
    });
    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);

    const base = `http://127.0.0.1:${port}`;
    const page = await fetch(base, { signal: AbortSignal.timeout(15_000) });
    assert.equal(page.status, 200);
    await page.arrayBuffer();
    // This route calls SessionManager.open(), not merely the JSONL list scanner.
    const response = await fetch(`${base}/api/sessions/${sessionId}`, { signal: AbortSignal.timeout(15_000) });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.sessionId, sessionId);
    assert.equal(body.context.messages.length, 1);
    assert.equal(body.context.messages[0].role, "user");
    assert.deepEqual(body.context.messages[0].content, [{ type: "text", text: "Runtime smoke fixture" }]);
    assert.equal(body.filePath.startsWith(sessionDir + path.sep), true);
    console.log(`Packaged startup and host Pi session read passed on Node ${process.versions.node}`);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      // The launcher forwards SIGTERM and bounds Next.js shutdown itself.
      child.kill("SIGTERM");
    }
    if (closed) await closed;
    await rm(dir, { recursive: true, force: true });
  }
});
