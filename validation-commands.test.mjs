import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.dirname(fileURLToPath(import.meta.url));
const { scripts } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

function temporaryDirectory(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pi-web-validation-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function just(args, cwd = root) {
  const env = { ...process.env };
  // This is a new CLI invocation, not another worker of the outer Node runner.
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync("just", [
    "--justfile", path.join(root, "justfile"), "--working-directory", cwd, ...args,
  ], { env, encoding: "utf8", timeout: 30_000 });
  assert.ifError(result.error);
  return { ...result, output: result.stdout + result.stderr };
}

test("bare just lists commands rather than applying fixes", () => {
  const result = just([]);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Available recipes:/);
});

test("test-one forwards a spaced name pattern and file path through the host preload", (t) => {
  const dir = temporaryDirectory(t);
  const selected = path.join(dir, "selected test.mjs");
  writeFileSync(selected, `
    import test from "node:test";
    import assert from "node:assert/strict";
    import { SessionManager } from "@earendil-works/pi-coding-agent";
    test("selected case", () => assert.equal(typeof SessionManager.open, "function"));
    test("not selected", () => assert.fail("name filtering was lost"));
  `);
  writeFileSync(path.join(dir, "unselected.test.mjs"), 'throw new Error("file selection was lost");');
  const result = just(["test-one", "--test-name-pattern", "^selected case$", selected]);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /selected case/);
});

test("test-one propagates test failure and rejects missing selection", (t) => {
  const dir = temporaryDirectory(t);
  const failing = path.join(dir, "failure.test.mjs");
  writeFileSync(failing, 'import test from "node:test"; test("intentional failure", () => { throw new Error("failure reached caller"); });');
  const result = just(["test-one", failing]);
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, /failure reached caller/);
  assert.notEqual(just(["test-one"]).status, 0);
});

function formattingFixture(t) {
  const dir = temporaryDirectory(t);
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts }));
  copyFileSync(path.join(root, ".oxfmtrc.json"), path.join(dir, ".oxfmtrc.json"));
  symlinkSync(path.join(root, "node_modules"), path.join(dir, "node_modules"), "junction");
  writeFileSync(path.join(dir, "eslint.config.mjs"), 'export default [{ rules: { "prefer-const": "error" } }];\n');
  return dir;
}

test("lint rejects unformatted source without changing it", (t) => {
  const dir = formattingFixture(t);
  const file = path.join(dir, "example.js");
  const source = "const value={label:'hello'};console.log(value)\n";
  writeFileSync(file, source);
  const result = just(["lint"], dir);
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, /example\.js/);
  assert.equal(readFileSync(file, "utf8"), source);
});

test("lint still rejects ESLint violations after formatting passes", (t) => {
  const dir = formattingFixture(t);
  const fixed = just(["fix"], dir);
  assert.equal(fixed.status, 0, fixed.output);
  const file = path.join(dir, "example.js");
  const source = 'let value = "hello";\nconsole.log(value);\n';
  writeFileSync(file, source);
  const result = just(["lint"], dir);
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, /prefer-const/);
  assert.equal(readFileSync(file, "utf8"), source);
});

test("explicit fix applies ESLint fixes and formatting, then lint passes without writes", (t) => {
  const dir = formattingFixture(t);
  const file = path.join(dir, "example.js");
  writeFileSync(file, "let value={label:'hello'};console.log(value)\n");
  const fixed = just(["fix"], dir);
  assert.equal(fixed.status, 0, fixed.output);
  const expected = 'const value = { label: "hello" };\nconsole.log(value);\n';
  assert.equal(readFileSync(file, "utf8"), expected);
  const checked = just(["lint"], dir);
  assert.equal(checked.status, 0, checked.output);
  assert.equal(readFileSync(file, "utf8"), expected);
  const repeated = just(["fix"], dir);
  assert.equal(repeated.status, 0, repeated.output);
  assert.equal(readFileSync(file, "utf8"), expected);
});

for (const recipe of ["qa", "ci"]) {
  for (const failure of [null, "lint", "typecheck", "test"]) {
    test(`${recipe} validates without fixing and stops at ${failure ?? "successful completion"}`, (t) => {
      const dir = temporaryDirectory(t);
      const fixtureScripts = { qa: scripts.qa, ci: scripts.ci };
      for (const name of ["lint", "typecheck", "test", "fix"]) {
        fixtureScripts[name] = `node step.cjs ${name}`;
      }
      writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: fixtureScripts }));
      writeFileSync(path.join(dir, "step.cjs"), `
        const name = process.argv[2];
        require("node:fs").appendFileSync("steps.log", name + "\\n");
        if (name === ${JSON.stringify(failure)}) process.exit(1);
      `);
      const result = just([recipe], dir);
      assert.equal(result.status === 0, failure === null, result.output);
      const steps = readFileSync(path.join(dir, "steps.log"), "utf8").trim().split("\n");
      const expected = ["lint", "typecheck", "test"];
      assert.deepEqual(steps, failure ? expected.slice(0, expected.indexOf(failure) + 1) : expected);
    });
  }
}
