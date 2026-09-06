import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import test from "node:test";

const { writePrivateFileAtomicSync } = await import("./atomic-file.ts");

function createTempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-atomic-file-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("atomically replaces a file with restrictive permissions", (t) => {
  const root = createTempRoot(t);
  const destination = path.join(root, "models.json");
  fs.writeFileSync(destination, "old", { mode: 0o644 });

  writePrivateFileAtomicSync(destination, "new");

  assert.equal(fs.readFileSync(destination, "utf8"), "new");
  assert.deepEqual(fs.readdirSync(root), ["models.json"]);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(destination).mode & 0o777, 0o600);
  }
});

test("keeps the original operation error when temporary-file cleanup also fails", (t) => {
  const root = createTempRoot(t);
  const destination = path.join(root, "settings.json");
  fs.writeFileSync(destination, "old");
  const original = new Error("rename failed");
  const cleanup = new Error("cleanup failed");
  const rename = t.mock.method(fs, "renameSync", () => {
    throw original;
  });
  const unlink = t.mock.method(fs, "unlinkSync", () => {
    throw cleanup;
  });
  syncBuiltinESMExports();
  try {
    assert.throws(
      () => writePrivateFileAtomicSync(destination, "new"),
      (error) => error === original,
    );
    assert.equal(fs.readFileSync(destination, "utf8"), "old");
  } finally {
    rename.mock.restore();
    unlink.mock.restore();
    syncBuiltinESMExports();
  }
});

test("reports cleanup failure after a successful replacement", (t) => {
  const root = createTempRoot(t);
  const destination = path.join(root, "settings.json");
  const cleanup = new Error("cleanup failed");
  const unlink = t.mock.method(fs, "unlinkSync", () => {
    throw cleanup;
  });
  syncBuiltinESMExports();
  try {
    assert.throws(
      () => writePrivateFileAtomicSync(destination, "new"),
      (error) => error === cleanup,
    );
    assert.equal(fs.readFileSync(destination, "utf8"), "new");
  } finally {
    unlink.mock.restore();
    syncBuiltinESMExports();
  }
});

test("keeps the destination and removes the temporary file when replacement fails", (t) => {
  const root = createTempRoot(t);
  const destination = path.join(root, "models.json");
  fs.mkdirSync(destination);

  assert.throws(() => writePrivateFileAtomicSync(destination, "new"));
  assert.equal(fs.statSync(destination).isDirectory(), true);
  assert.deepEqual(fs.readdirSync(root), ["models.json"]);
});
