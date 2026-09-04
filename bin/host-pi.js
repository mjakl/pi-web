"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require("node:fs");
const path = require("node:path");

const CODING_AGENT = "@earendil-works/pi-coding-agent";
const PI_SERVER = "@earendil-works/pi-server";
const PI_PACKAGES = [
  CODING_AGENT,
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-tui",
  PI_SERVER,
];

function validationError(reason, executable) {
  const found = executable ? ` Executable: ${executable}.` : "";
  return new Error(
    `Host Pi validation failed: ${reason}.${found} Pi Web supports Linux, macOS, and Windows and requires ${CODING_AGENT}. Install or update Pi with "npm install -g --ignore-scripts ${CODING_AGENT}", put the intended pi executable first on PATH, and restart Pi Web.`,
  );
}

function assertSupportedPlatform(platform, env) {
  const termux = platform === "linux" && (
    typeof env.TERMUX_VERSION === "string"
    || /^\/data\/data\/com\.termux(?:\/|$)/.test(env.PREFIX || "")
  );
  if (!["linux", "darwin", "win32"].includes(platform) || termux) {
    throw validationError(`unsupported platform ${termux ? "Termux" : platform}`);
  }
}

function comparablePath(value, platform) {
  const resolved = path.resolve(value);
  return platform === "win32" ? resolved.toLowerCase() : resolved;
}

function comparableDirectory(value, platform) {
  try {
    return comparablePath(fs.realpathSync(value), platform);
  } catch {
    return comparablePath(value, platform);
  }
}

function executableNames(platform, env) {
  if (platform !== "win32") return ["pi"];
  return (env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .filter(Boolean)
    .map((extension) => `pi${extension.startsWith(".") ? extension : `.${extension}`}`);
}

function isExecutable(file, platform) {
  try {
    if (!fs.statSync(file).isFile()) return false;
    if (platform !== "win32") fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findPiExecutable(env, platform, checkoutDir) {
  const names = executableNames(platform, env);
  const localCandidates = new Set(names.map((name) => (
    comparablePath(path.join(checkoutDir, "node_modules", ".bin", name), platform)
  )));
  for (const rawDir of (env.PATH || "").split(platform === "win32" ? ";" : path.delimiter)) {
    const dir = rawDir.replace(/^"|"$/g, "") || ".";
    for (const name of names) {
      const candidate = path.resolve(dir, name);
      if (localCandidates.has(comparablePath(candidate, platform))) continue;
      if (isExecutable(candidate, platform)) return candidate;
    }
  }
  throw validationError("no pi executable was found on PATH");
}

function readPackage(packageDir, expectedName) {
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8"));
    if (packageJson.name !== expectedName) return undefined;
    return { dir: fs.realpathSync(packageDir), packageJson };
  } catch {
    return undefined;
  }
}

function ancestors(start) {
  const result = [];
  for (let current = path.resolve(start);;) {
    result.push(current);
    const parent = path.dirname(current);
    if (parent === current) return result;
    current = parent;
  }
}

function sameFile(left, right, platform) {
  try {
    return comparablePath(fs.realpathSync(left), platform) === comparablePath(fs.realpathSync(right), platform);
  } catch {
    return false;
  }
}

function findCodingAgent(executable, platform) {
  const realExecutable = fs.realpathSync(executable);
  const starts = [...new Set([path.dirname(realExecutable), path.dirname(executable)])];

  for (const start of starts) {
    for (const ancestor of ancestors(start)) {
      const direct = readPackage(ancestor, CODING_AGENT);
      if (direct) {
        const bin = typeof direct.packageJson.bin === "string"
          ? direct.packageJson.bin
          : direct.packageJson.bin?.pi;
        if (bin && sameFile(path.join(direct.dir, bin), realExecutable, platform)) return direct;
      }

      const dependency = readPackage(path.join(ancestor, "node_modules", ...CODING_AGENT.split("/")), CODING_AGENT);
      if (!dependency) continue;
      const bin = typeof dependency.packageJson.bin === "string"
        ? dependency.packageJson.bin
        : dependency.packageJson.bin?.pi;
      const executableDir = path.dirname(executable);
      const adjacentShim = comparableDirectory(executableDir, platform) === comparableDirectory(ancestor, platform)
        || path.basename(executableDir).toLowerCase() === ".bin";
      if (bin && (sameFile(path.join(dependency.dir, bin), realExecutable, platform) || adjacentShim)) return dependency;
    }
  }

  throw new Error(`the first non-checkout pi is not owned by ${CODING_AGENT}`);
}

function findDependency(codingDir, packageName) {
  for (const ancestor of ancestors(codingDir)) {
    const found = readPackage(path.join(ancestor, "node_modules", ...packageName.split("/")), packageName);
    if (found) return found;
  }
  throw new Error(`${packageName} is missing from ${CODING_AGENT}'s dependency graph`);
}

function findStandaloneDependency(env, platform, checkoutDir, packageName, version) {
  const checkout = comparableDirectory(checkoutDir, platform);
  for (const rawDir of (env.PATH || "").split(platform === "win32" ? ";" : path.delimiter)) {
    const start = rawDir.replace(/^"|"$/g, "") || ".";
    for (const ancestor of ancestors(start)) {
      const found = readPackage(path.join(ancestor, "node_modules", ...packageName.split("/")), packageName);
      if (!found || found.packageJson.version !== version) continue;
      const dir = comparableDirectory(found.dir, platform);
      if (dir !== checkout && !dir.startsWith(`${checkout}${path.sep}`)) return found;
    }
  }
  throw new Error(`${packageName} ${version} is missing from ${CODING_AGENT}'s dependency graph and PATH`);
}

function pickTarget(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return undefined;
  for (const condition of ["import", "node", "default"]) {
    const target = pickTarget(value[condition]);
    if (target) return target;
  }
  return undefined;
}

function rootEntry(found, packageName) {
  const packageJson = found.packageJson;
  const hasExports = packageJson.exports !== undefined;
  const exported = Object.prototype.hasOwnProperty.call(packageJson.exports || {}, ".")
    ? packageJson.exports["."]
    : packageJson.exports;
  const exportTarget = pickTarget(exported);
  const target = hasExports ? exportTarget : packageJson.main;
  if (typeof target !== "string" || path.isAbsolute(target) || (exportTarget && !target.startsWith("./"))) {
    throw new Error(`${packageName} has no valid root import export`);
  }
  const requestedEntry = path.resolve(found.dir, target.replace(/^\.\//, ""));
  let entry;
  try {
    entry = fs.realpathSync(requestedEntry);
    if (!fs.statSync(entry).isFile()) throw new Error();
  } catch {
    throw new Error(`${packageName} root import entry does not exist: ${requestedEntry}`);
  }
  const relative = path.relative(found.dir, entry);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${packageName} root import entry leaves its package: ${entry}`);
  }
  return entry;
}

function resolveHostPi({
  env = process.env,
  platform = process.platform,
  checkoutDir = path.join(__dirname, ".."),
} = {}) {
  assertSupportedPlatform(platform, env);
  const executable = findPiExecutable(env, platform, checkoutDir);

  try {
    const coding = findCodingAgent(executable, platform);
    const version = coding.packageJson.version;
    if (typeof version !== "string") throw new Error(`${CODING_AGENT} has no version`);
    const packages = {};
    for (const packageName of PI_PACKAGES) {
      let found;
      if (packageName === CODING_AGENT) found = coding;
      else {
        try {
          found = findDependency(coding.dir, packageName);
        } catch (error) {
          if (packageName !== PI_SERVER) throw error;
          found = findStandaloneDependency(env, platform, checkoutDir, packageName, version);
        }
      }
      if (found.packageJson.version !== version) {
        throw new Error(`${packageName} has version ${found.packageJson.version ?? "(missing)"}; required ${version}`);
      }
      packages[packageName] = {
        dir: found.dir,
        entry: rootEntry(found, packageName),
        exports: found.packageJson.exports,
      };
    }

    return { executable, packages };
  } catch (error) {
    throw validationError(error instanceof Error ? error.message : String(error), executable);
  }
}

module.exports = { PI_PACKAGES, resolveHostPi };
