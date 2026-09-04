import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

async function loadSubject() {
  return import("./directory-browser.ts");
}

test("lists directories and directory symlinks without returning files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-web-browse-"));
  try {
    await mkdir(path.join(root, "project"));
    await writeFile(path.join(root, "notes.txt"), "test", "utf8");
    await symlink(path.join(root, "project"), path.join(root, "linked-project"));

    const { listDirectories } = await loadSubject();
    const directories = await listDirectories(root);

    assert.deepEqual(directories.map((entry) => entry.name), ["linked-project", "project"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("expands home-relative paths and rejects missing directories", async () => {
  const {
    getBrowseStartDirectory,
    normalizeDirectory,
    resolveDirectory,
    shouldShowWindowsDrivePicker,
  } = await loadSubject();
  assert.equal(getBrowseStartDirectory(), homedir());
  assert.equal(getBrowseStartDirectory("/project"), "/project");
  assert.equal(shouldShowWindowsDrivePicker(undefined, "win32"), true);
  assert.equal(shouldShowWindowsDrivePicker(undefined, "darwin"), false);
  assert.equal(shouldShowWindowsDrivePicker(undefined, "linux"), false);
  assert.equal(shouldShowWindowsDrivePicker("C:\\Projects", "win32"), false);
  assert.equal(normalizeDirectory("~/project"), path.join(homedir(), "project"));
  await assert.rejects(resolveDirectory(path.join(tmpdir(), `pi-web-missing-${Date.now()}`)));
});

test("builds every Windows drive-letter candidate", async () => {
  const { getWindowsDriveCandidates } = await loadSubject();
  const drives = getWindowsDriveCandidates();

  assert.equal(drives.length, 26);
  assert.deepEqual(drives[0], { name: "A:", path: "A:\\" });
  assert.deepEqual(drives.at(-1), { name: "Z:", path: "Z:\\" });
});

test("completes only immediate files and folders outside the project, including hidden entries and links", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-web-completion-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = path.join(root, "project");
  await mkdir(project);
  await mkdir(path.join(root, "notes folder"));
  await writeFile(path.join(root, "notes folder", "nested.txt"), "");
  await writeFile(path.join(root, "notes.txt"), "");
  await writeFile(path.join(root, ".hidden"), "");
  await symlink(path.join(root, "notes folder"), path.join(root, "linked"));
  await symlink(path.join(root, "missing"), path.join(root, "broken"));
  const { completeFilePath } = await loadSubject();
  const entries = await completeFilePath("../", project);
  assert.deepEqual(entries.map((entry) => path.basename(entry.path)).sort(), [".hidden", "broken", "linked", "notes folder", "notes.txt", "project"]);
  assert.equal(entries.find((entry) => entry.path.endsWith("linked")).isDir, true);
  assert.equal(entries.find((entry) => entry.path.endsWith("broken")).isDir, false);
  assert.deepEqual(await completeFilePath(path.join(root, "NOTES"), project), [
    { path: path.join(root, "notes folder"), isDir: true },
    { path: path.join(root, "notes.txt"), isDir: false },
  ]);
  assert.deepEqual(await completeFilePath(path.join(root, "notes folder") + path.sep, project), [
    { path: path.join(root, "notes folder", "nested.txt"), isDir: false },
  ]);
  await assert.rejects(completeFilePath(path.join(root, "missing") + path.sep, project));
});

test("filters the whole directory before limiting completion results", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-web-completion-limit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all(Array.from({ length: 30 }, (_, i) => writeFile(path.join(root, `file-${String(i).padStart(2, "0")}`), "")));
  const { completeFilePath } = await loadSubject();
  assert.equal((await completeFilePath(root + path.sep)).length, 20);
  assert.deepEqual(await completeFilePath(path.join(root, "file-29")), [{ path: path.join(root, "file-29"), isDir: false }]);
});

test("finds parent directories across POSIX and Windows paths", async () => {
  const { getParentDirectory } = await loadSubject();

  assert.equal(getParentDirectory("/Users/alex/project"), "/Users/alex");
  assert.equal(getParentDirectory("/"), null);
  assert.equal(getParentDirectory("C:\\Users\\Alex\\project"), "C:\\Users\\Alex");
  assert.equal(getParentDirectory("C:\\"), null);
});
