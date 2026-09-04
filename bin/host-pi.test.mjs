import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { resolveHostPi } = require("./host-pi.js");
const preload = fileURLToPath(new URL("./host-pi-runtime.js", import.meta.url));

function writePackage(root, name, version, extra = {}) {
  const dir = path.join(root, "node_modules", ...name.split("/"));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({
    name,
    version,
    type: "module",
    main: "./index.js",
    exports: { ".": { import: "./index.js" }, "./compat": { import: "./compat.js" } },
    ...extra,
  }));
  fs.writeFileSync(path.join(dir, "index.js"), `export default ${JSON.stringify(`${name}@${version}`)};`);
  fs.writeFileSync(path.join(dir, "compat.js"), `export default ${JSON.stringify(`${name}/compat@${version}`)};`);
  return dir;
}

function makePi(root, codingVersion = "0.84.3", dependencyVersion = "0.84.4", executableName = "pi") {
  const dependencies = Object.fromEntries([
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-tui",
  ].map((name) => [name, `^${codingVersion}`]));
  const codingDir = writePackage(root, "@earendil-works/pi-coding-agent", codingVersion, {
    bin: { pi: "cli.js" },
    dependencies,
  });
  const cli = path.join(codingDir, "cli.js");
  fs.writeFileSync(cli, `#!/usr/bin/env node\nconsole.log(${JSON.stringify(codingVersion)});\n`, { mode: 0o755 });
  for (const name of Object.keys(dependencies)) writePackage(root, name, dependencyVersion);
  const binDir = path.join(root, "node_modules", ".bin");
  fs.mkdirSync(binDir, { recursive: true });
  const executable = path.join(binDir, executableName);
  if (executableName === "pi") fs.symlinkSync(path.relative(binDir, cli), executable);
  else fs.writeFileSync(executable, "shim");
  return { binDir, codingDir, executable };
}

function tempDir(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-host-pi-")));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function assertActionable(run, executable) {
  assert.throws(run, (error) => {
    assert.match(error.message, /^Host Pi validation failed:/);
    if (executable) assert.ok(error.message.includes(`Executable: ${executable}.`));
    assert.match(error.message, /Install or update Pi.*first on PATH.*restart Pi Web/s);
    return true;
  });
}

test("Linux skips only the checkout candidate, not its independently listed symlink target directory", (t) => {
  const base = tempDir(t);
  const checkout = path.join(base, "checkout");
  const host = makePi(path.join(base, "host"), "0.84.3", "0.84.4");
  fs.mkdirSync(path.join(checkout, "node_modules"), { recursive: true });
  fs.symlinkSync(host.binDir, path.join(checkout, "node_modules", ".bin"), "dir");

  const runtime = resolveHostPi({
    platform: "linux",
    checkoutDir: checkout,
    env: { ...process.env, PATH: `${path.join(checkout, "node_modules", ".bin")}${path.delimiter}${host.binDir}${path.delimiter}${process.env.PATH}` },
  });

  assert.equal(runtime.executable, host.executable);
  assert.equal(runtime.version, "0.84.3");
  assert.equal(runtime.packages["@earendil-works/pi-ai"].dir.endsWith(path.join("@earendil-works", "pi-ai")), true);
  for (const descriptor of Object.values(runtime.packages)) assert.ok(fs.statSync(descriptor.entry).isFile());
});

test("the first non-checkout pi is authoritative when its graph is invalid", (t) => {
  const base = tempDir(t);
  const firstBin = path.join(base, "first");
  fs.mkdirSync(firstBin, { recursive: true });
  fs.writeFileSync(path.join(firstBin, "pi"), "#!/bin/sh\necho 0.84.3\n", { mode: 0o755 });
  const valid = makePi(path.join(base, "valid"));

  assertActionable(() => resolveHostPi({
    platform: "linux",
    checkoutDir: path.join(base, "checkout"),
    env: { ...process.env, PATH: `${firstBin}${path.delimiter}${valid.binDir}${path.delimiter}${process.env.PATH}` },
  }), path.join(firstBin, "pi"));
});

test("accepts Pi package versions without running the executable", (t) => {
  const base = tempDir(t);
  for (const version of ["0.1.0", "0.85.0", "1.0.0-beta.1", undefined]) {
    const host = makePi(path.join(base, String(version)), version, "2.0.0");
    const manifest = path.join(host.codingDir, "package.json");
    const packageJson = JSON.parse(fs.readFileSync(manifest, "utf8"));
    packageJson.version = version;
    fs.writeFileSync(manifest, JSON.stringify(packageJson));
    const marker = path.join(base, "executed");
    fs.writeFileSync(path.join(host.codingDir, "cli.js"), `#!/usr/bin/env node\nimport fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'executed'); process.exit(1);\n`);

    const runtime = resolveHostPi({
      platform: "linux",
      checkoutDir: path.join(base, "checkout"),
      env: { ...process.env, PATH: `${host.binDir}${path.delimiter}${process.env.PATH}` },
    });
    assert.equal(runtime.version, version ?? "unknown");
    assert.equal(Object.keys(runtime.packages).length, 4);
    assert.equal(fs.existsSync(marker), false);
  }
});

test("honors PATHEXT order", (t) => {
  const base = tempDir(t);
  const cmdRoot = path.join(base, "cmd");
  const cmd = makePi(cmdRoot, "0.84.3", "0.84.3", "pi.CMD");
  const adjacentCmd = path.join(cmdRoot, "pi.CMD");
  fs.renameSync(cmd.executable, adjacentCmd);
  fs.writeFileSync(path.join(cmdRoot, "pi.EXE"), "shim");

  const runtime = resolveHostPi({
    platform: "win32",
    checkoutDir: path.join(base, "checkout"),
    env: { PATH: cmdRoot, PATHEXT: ".CMD;.EXE" },
  });
  assert.equal(runtime.executable, adjacentCmd);
});

test("resolves Windows command shims when their PATH contains spaces", (t) => {
  const base = tempDir(t);
  const root = path.join(base, "Windows User");
  const host = makePi(root, "0.84.3", "0.84.3", "pi.CMD");

  const runtime = resolveHostPi({
    platform: "win32",
    checkoutDir: path.join(base, "checkout"),
    env: { ...process.env, PATH: host.binDir, PATHEXT: ".CMD" },
  });

  assert.equal(runtime.executable, host.executable);
  assert.equal(runtime.version, "0.84.3");
});

test("macOS resolves the first executable Pi from PATH", (t) => {
  const base = tempDir(t);
  const host = makePi(path.join(base, "host"));
  const runtime = resolveHostPi({
    platform: "darwin",
    checkoutDir: path.join(base, "checkout"),
    env: { ...process.env, PATH: `${host.binDir}${path.delimiter}${process.env.PATH}` },
  });
  assert.equal(runtime.executable, host.executable);
});

test("rejects Android and Termux before searching PATH", () => {
  assertActionable(() => resolveHostPi({ platform: "android", env: { PATH: "" } }));
  assertActionable(() => resolveHostPi({
    platform: "linux",
    env: { PATH: "", TERMUX_VERSION: "0.118" },
  }));
});

test("missing dependencies fail with host guidance", (t) => {
  const base = tempDir(t);
  const missing = makePi(path.join(base, "missing"));
  fs.rmSync(path.join(base, "missing", "node_modules", "@earendil-works", "pi-agent-core"), { recursive: true });
  assertActionable(() => resolveHostPi({
    platform: "linux",
    checkoutDir: path.join(base, "checkout"),
    env: { ...process.env, PATH: `${missing.binDir}${path.delimiter}${process.env.PATH}` },
  }), missing.executable);
});

test("validates package root entries during startup and rejects symlink escapes", (t) => {
  const base = tempDir(t);
  const host = makePi(path.join(base, "host"));
  const aiEntry = path.join(base, "host", "node_modules", "@earendil-works", "pi-ai", "index.js");
  const outside = path.join(base, "outside.js");
  fs.writeFileSync(outside, "export default 'outside';");
  fs.rmSync(aiEntry);
  fs.symlinkSync(outside, aiEntry);

  assertActionable(() => resolveHostPi({
    platform: "linux",
    checkoutDir: path.join(base, "checkout"),
    env: { ...process.env, PATH: `${host.binDir}${path.delimiter}${process.env.PATH}` },
  }), host.executable);
});

test("runtime hook imports validated host entries instead of checkout-local Pi", (t) => {
  const base = tempDir(t);
  const hostRoot = path.join(base, "host");
  const localRoot = path.join(base, "app");
  const hostDir = writePackage(hostRoot, "@earendil-works/pi-ai", "0.84.4");
  const hostTuiDir = writePackage(hostRoot, "@earendil-works/pi-tui", "0.84.4");
  writePackage(localRoot, "@earendil-works/pi-ai", "0.84.3");
  writePackage(localRoot, "@earendil-works/pi-tui", "0.84.3");
  const runtime = {
    version: "0.84.4",
    packages: {
      "@earendil-works/pi-ai": {
        dir: hostDir,
        entry: path.join(hostDir, "index.js"),
        exports: { ".": { import: "./index.js" }, "./compat": { import: "./compat.js" } },
      },
      "@earendil-works/pi-tui": {
        dir: hostTuiDir,
        entry: path.join(hostTuiDir, "index.js"),
      },
    },
  };

  const result = spawnSync(process.execPath, ["--require", preload, "--input-type=module", "--eval", "import value from '@earendil-works/pi-ai/compat'; import tui from '@earendil-works/pi-tui'; console.log(value, tui)"], {
    cwd: localRoot,
    encoding: "utf8",
    env: { ...process.env, PI_WEB_HOST_PI: JSON.stringify(runtime) },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "@earendil-works/pi-ai/compat@0.84.4 @earendil-works/pi-tui@0.84.4");
});
