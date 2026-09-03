"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require("node:fs");
const path = require("node:path");
const { registerHooks } = require("node:module");
const { pathToFileURL } = require("node:url");

function pickTarget(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return undefined;
  for (const condition of ["import", "node", "default"]) {
    const target = pickTarget(value[condition]);
    if (target) return target;
  }
  return undefined;
}

function exportedTarget(descriptor, subpath) {
  const key = `./${subpath}`;
  const exact = pickTarget(descriptor.exports?.[key]);
  if (exact) return exact;
  for (const [pattern, value] of Object.entries(descriptor.exports || {})) {
    const star = pattern.indexOf("*");
    if (star < 0 || !key.startsWith(pattern.slice(0, star)) || !key.endsWith(pattern.slice(star + 1))) continue;
    const matched = key.slice(star, key.length - (pattern.length - star - 1));
    return pickTarget(value)?.replaceAll("*", matched);
  }
  return undefined;
}

function installHostPiRuntime(serialized = process.env.PI_WEB_HOST_PI) {
  if (!serialized) throw new Error("Validated host Pi runtime is missing. Start Pi Web through its pi-web, dev, or start command.");
  const runtime = JSON.parse(serialized);

  registerHooks({
    resolve(specifier, context, nextResolve) {
      const packageName = Object.keys(runtime.packages).find((name) => specifier === name || specifier.startsWith(`${name}/`));
      if (!packageName) return nextResolve(specifier, context);
      const descriptor = runtime.packages[packageName];
      if (specifier === packageName) {
        return { shortCircuit: true, url: pathToFileURL(descriptor.entry).href };
      }
      const target = exportedTarget(descriptor, specifier.slice(packageName.length + 1));
      if (!target || !target.startsWith("./")) throw new Error(`${specifier} is not exported by the validated host ${packageName} package.`);
      let entry;
      try {
        entry = fs.realpathSync(path.resolve(descriptor.dir, target));
      } catch {
        throw new Error(`Validated host entry for ${specifier} does not exist.`);
      }
      const relative = path.relative(descriptor.dir, entry);
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !fs.statSync(entry).isFile()) {
        throw new Error(`Validated host entry for ${specifier} leaves ${packageName}.`);
      }
      return { shortCircuit: true, url: pathToFileURL(entry).href };
    },
  });

  return runtime;
}

const runtime = installHostPiRuntime();
module.exports = { installHostPiRuntime, runtime };
