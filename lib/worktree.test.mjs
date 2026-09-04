import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
let agentDir;
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
test.before(async () => {
  agentDir = await mkdtemp(path.join(os.tmpdir(), "pi-web-worktree-agent-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
});
test.after(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(agentDir, { recursive: true, force: true });
});

async function loadSubject() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./worktree.ts");
}

async function git(cwd, args) {
  await execFileAsync("git", ["-C", cwd, ...args]);
}

test("main and linked worktrees share one canonical project root", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pi-web-worktree-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));

  const repo = path.join(tempRoot, "repo");
  const linked = path.join(tempRoot, "linked");
  await execFileAsync("git", ["init", repo]);
  await git(repo, ["config", "user.name", "Pi Web Test"]);
  await git(repo, ["config", "user.email", "pi-web-test@example.invalid"]);
  await git(repo, ["config", "commit.gpgsign", "false"]);
  await writeFile(path.join(repo, "README.md"), "# test\n");
  await git(repo, ["add", "README.md"]);
  await git(repo, ["commit", "-m", "initial"]);
  await git(repo, ["worktree", "add", "-b", "feature/test", linked]);

  const { findCurrentWorktreePath, listWorktrees, resolveProject } = await loadSubject();
  const mainProject = await resolveProject(`${repo}${path.sep}`);
  const linkedProject = await resolveProject(linked);

  assert.equal(mainProject.isTopLevel, true);
  assert.equal(mainProject.isWorktree, false);
  assert.equal(linkedProject.isTopLevel, true);
  assert.equal(linkedProject.isWorktree, true);
  assert.equal(linkedProject.branch, "feature/test");
  assert.equal(mainProject.projectRoot, linkedProject.projectRoot);

  const worktrees = await listWorktrees(linked);
  const listedLinked = worktrees.find((worktree) => worktree.branch === "feature/test");
  assert.ok(listedLinked);
  assert.equal(findCurrentWorktreePath(worktrees, `${linked}${path.sep}`), listedLinked.path);
});


test("bare repositories group peer worktrees and remember deleted folders across cache resets", async (t) => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "pi-web-bare-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, "project.git");
  const first = path.join(root, "first");
  const second = path.join(root, "second with spaces");
  await execFileAsync("git", ["init", "--bare", repo]);
  await git(repo, ["worktree", "add", "--orphan", "-b", "first", first]);
  await git(first, ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "fixture"]);
  await git(first, ["worktree", "add", "--detach", second]);
  const { listWorktrees, resolveProject, isWorkingDirectoryAvailable, assertWorkingDirectoryAvailable } = await loadSubject();
  assert.equal((await resolveProject(first)).projectRoot, repo);
  assert.equal((await resolveProject(second)).projectRoot, repo);
  assert.equal((await resolveProject(repo)).projectRoot, repo);
  assert.deepEqual((await listWorktrees(first)).map(w => w.path), [first, second]);
  await git(first, ["worktree", "remove", second]);
  globalThis.__piProjectCache = undefined;
  assert.equal((await resolveProject(second)).projectRoot, repo);
  assert.equal(isWorkingDirectoryAvailable(second), false);
  const { createJiti } = await import("jiti");
  const { attachSessionProjectInfo } = await createJiti(import.meta.url).import("./session-reader.ts");
  const [missing] = await attachSessionProjectInfo([{ id: "old", cwd: second }]);
  assert.equal(missing.cwdAvailable, false);
  assert.equal(missing.projectRoot, repo);
  assert.throws(() => assertWorkingDirectoryAvailable(second), /read-only/);
  assert.deepEqual((await listWorktrees(first)).map(w => w.path), [first]);
  await git(first, ["worktree", "add", "--detach", second]);
  assert.equal(isWorkingDirectoryAvailable(second), true);
  assert.equal((await attachSessionProjectInfo([{ id: "old", cwd: second }]))[0].cwdAvailable, true);
  assert.doesNotThrow(() => assertWorkingDirectoryAvailable(second));
  assert.equal((await resolveProject(second)).projectRoot, repo);
  // A file at the old path must not count as a restored working directory.
  await git(first, ["worktree", "remove", second]);
  await writeFile(second, "not a directory");
  assert.equal(isWorkingDirectoryAvailable(second), false);
});
