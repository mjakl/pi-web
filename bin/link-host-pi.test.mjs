import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { SHIMMED_PACKAGES, writeHostPiShims } = require("./link-host-pi.js");

function hostPackage(root, name, version) {
  const dir = path.join(root, "host", ...name.split("/"));
  fs.mkdirSync(path.join(dir, "dist"), { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({
    name,
    version,
    type: "module",
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
  }));
  fs.writeFileSync(path.join(dir, "dist", "index.js"), `export const marker = ${JSON.stringify(`${name}@${version}`)};\n`);
  fs.writeFileSync(path.join(dir, "dist", "index.d.ts"), "export declare const marker: string;\n");
  return { dir, entry: path.join(dir, "dist", "index.js"), exports: undefined };
}

function tempDir(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-link-host-pi-")));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("every imported Pi package resolves to the host entry through the checkout", (t) => {
  const base = tempDir(t);
  const checkout = path.join(base, "checkout");
  const packages = Object.fromEntries(SHIMMED_PACKAGES.map((name) => [name, hostPackage(base, name, "9.9.9")]));

  writeHostPiShims({ packages }, checkout);

  const imports = SHIMMED_PACKAGES.map((name, index) => `import * as p${index} from ${JSON.stringify(name)};`).join(" ");
  const markers = SHIMMED_PACKAGES.map((_, index) => `p${index}.marker`).join(", ");
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", `${imports} console.log([${markers}].join(" "))`],
    { cwd: checkout, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), SHIMMED_PACKAGES.map((name) => `${name}@9.9.9`).join(" "));
});

test("declarations point at the host package and a stale install is replaced", (t) => {
  const base = tempDir(t);
  const checkout = path.join(base, "checkout");
  const packages = Object.fromEntries(SHIMMED_PACKAGES.map((name) => [name, hostPackage(base, name, "9.9.9")]));
  const shimDir = path.join(checkout, "node_modules", ...SHIMMED_PACKAGES[0].split("/"));
  fs.mkdirSync(path.join(shimDir, "dist", "bundle"), { recursive: true });
  fs.writeFileSync(path.join(shimDir, "dist", "bundle", "cli.js"), "process.exit(1);");

  writeHostPiShims({ packages }, checkout);

  assert.equal(fs.existsSync(path.join(shimDir, "dist")), false);
  assert.equal(
    fs.readFileSync(path.join(shimDir, "index.d.ts"), "utf8").includes(
      path.join(packages[SHIMMED_PACKAGES[0]].dir, "dist", "index").split(path.sep).join("/"),
    ),
    true,
  );
});

test("an incomplete runtime fails before writing anything", (t) => {
  const base = tempDir(t);
  const checkout = path.join(base, "checkout");
  const packages = { [SHIMMED_PACKAGES[0]]: hostPackage(base, SHIMMED_PACKAGES[0], "9.9.9") };

  assert.throws(
    () => writeHostPiShims({ packages }, checkout),
    /Validated host Pi runtime is missing @earendil-works\//,
  );
  assert.equal(fs.existsSync(path.join(checkout, "node_modules")), false);
});
