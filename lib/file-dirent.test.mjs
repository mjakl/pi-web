import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

async function loadSubject() {
  return import("./file-dirent.ts");
}

test("uses Dirent types for regular files and directories", async () => {
  const { resolveDirentIsDirectory } = await loadSubject();
  const file = { isDirectory: () => false, isFile: () => true };
  const directory = { isDirectory: () => true, isFile: () => false };

  assert.equal(resolveDirentIsDirectory(file, "/unused/file"), false);
  assert.equal(resolveDirentIsDirectory(directory, "/unused/directory"), true);
});

test("falls back to stat when the Dirent type is unknown", async (t) => {
  const { resolveDirentIsDirectory } = await loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-dirent-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directoryPath = path.join(root, "directory");
  fs.mkdirSync(directoryPath);

  const unknown = { isDirectory: () => false, isFile: () => false };
  assert.equal(resolveDirentIsDirectory(unknown, directoryPath), true);
});

test("follows directory symlinks and skips dangling symlinks", async (t) => {
  const { resolveDirentIsDirectory } = await loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-dirent-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "target"));
  try {
    fs.symlinkSync("target", path.join(root, "directory-link"), "dir");
    fs.symlinkSync("missing", path.join(root, "dangling-link"), "file");
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("Creating symbolic links requires additional privileges on this platform");
      return;
    }
    throw error;
  }

  const symlink = { isDirectory: () => false, isFile: () => false };
  assert.equal(
    resolveDirentIsDirectory(symlink, path.join(root, "directory-link")),
    true,
  );
  assert.equal(
    resolveDirentIsDirectory(symlink, path.join(root, "dangling-link")),
    null,
  );
});

test("skips generated and tooling entries in directory listings", async () => {
  const { isIgnoredDirent } = await loadSubject();

  assert.equal(isIgnoredDirent("node_modules"), true);
  assert.equal(isIgnoredDirent(".git"), true);
  assert.equal(isIgnoredDirent("module.pyc"), true);
  assert.equal(isIgnoredDirent("src"), false);
  assert.equal(isIgnoredDirent("build.md"), false);
});
