import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Loaded through jiti so the module's own extensionless imports resolve the way
// the app resolves them (tsconfig moduleResolution: "bundler"); bare
// `import("./path-security.ts")` only works while that file has no imports.
async function loadSubject() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./path-security.ts");
}

test("derives allowed roots from bounded session headers and ignores malformed files", async (t) => {
  const { getAllowedFileRoots } = await (async () => {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url, { moduleCache: false }).import("./file-access.ts");
  })();
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-file-roots-"));
  const projectDir = path.join(agentDir, "sessions", "project");
  const cwd = path.join(agentDir, "workspace");
  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(cwd);
  fs.writeFileSync(path.join(projectDir, "valid.jsonl"), `${JSON.stringify({
    type: "session",
    version: 3,
    id: "valid-session",
    timestamp: "2026-01-01T00:00:00.000Z",
    cwd,
  })}\n${"x".repeat(1024 * 1024)}`);
  fs.writeFileSync(path.join(projectDir, "malformed.jsonl"), "not json\n");
  fs.writeFileSync(path.join(projectDir, "object-cwd.jsonl"), `${JSON.stringify({
    type: "session",
    version: 3,
    id: "object-cwd",
    timestamp: "2026-01-01T00:00:00.000Z",
    cwd: { path: cwd },
  })}\n`);
  fs.writeFileSync(path.join(projectDir, "numeric-parent.jsonl"), `${JSON.stringify({
    type: "session",
    version: 3,
    id: "numeric-parent",
    timestamp: "2026-01-01T00:00:00.000Z",
    cwd: path.join(agentDir, "unauthorized"),
    parentSession: 42,
  })}\n`);
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousRoots = globalThis.__piAdditionalAllowedRoots;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  globalThis.__piAdditionalAllowedRoots = undefined;
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    globalThis.__piAdditionalAllowedRoots = previousRoots;
    fs.rmSync(agentDir, { recursive: true, force: true });
  });

  const roots = await getAllowedFileRoots();

  assert.equal(roots.has(cwd), true);
  assert.equal(roots.has(path.join(agentDir, "unauthorized")), false);
  assert.equal([...roots].some((root) => root.includes("malformed")), false);
});

test("authorizes a linked worktree session's main project root", async (t) => {
  const { createJiti } = await import("jiti");
  const { getAllowedFileRoots } = await createJiti(import.meta.url, { moduleCache: false }).import("./file-access.ts");
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-worktree-roots-"));
  const repo = path.join(agentDir, "repo");
  const worktree = path.join(agentDir, "worktree");
  const projectDir = path.join(agentDir, "sessions", "project");
  fs.mkdirSync(repo);
  execFileSync("git", ["init", "-q", repo]);
  execFileSync("git", ["-C", repo, "config", "user.email", "test@example.com"]);
  execFileSync("git", ["-C", repo, "config", "user.name", "Test"]);
  execFileSync("git", ["-C", repo, "commit", "--allow-empty", "-qm", "init"]);
  execFileSync("git", ["-C", repo, "worktree", "add", "-qb", "feature", worktree]);
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, "worktree.jsonl"), `${JSON.stringify({
    type: "session",
    version: 3,
    id: "worktree-session",
    timestamp: "2026-01-01T00:00:00.000Z",
    cwd: worktree,
  })}\n`);
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousRoots = globalThis.__piAdditionalAllowedRoots;
  const previousProjects = globalThis.__piProjectCache;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  globalThis.__piAdditionalAllowedRoots = undefined;
  globalThis.__piProjectCache = undefined;
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    globalThis.__piAdditionalAllowedRoots = previousRoots;
    globalThis.__piProjectCache = previousProjects;
    fs.rmSync(agentDir, { recursive: true, force: true });
  });

  const roots = await getAllowedFileRoots();

  assert.equal(roots.has(worktree), true);
  assert.equal(roots.has(repo), true);
});

test("rejects an existing path that escapes an allowed root through a symlink", async (t) => {
  const { isExistingPathWithinRoots, isPathWithinRoots } = await loadSubject();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-file-access-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const allowed = path.join(base, "allowed");
  const outside = path.join(base, "outside");
  fs.mkdirSync(allowed);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
  const link = path.join(allowed, "link");
  fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
  const target = path.join(link, "secret.txt");
  const roots = new Set([allowed]);

  assert.equal(isPathWithinRoots(target, roots), true);
  assert.equal(isExistingPathWithinRoots(target, roots), false);
});

test("authorizeDirectory denies before revealing existence and after symlinks resolve", async (t) => {
  const { createJiti } = await import("jiti");
  const { allowFileRoot, authorizeDirectory, isExistingPathAllowed } = await createJiti(import.meta.url, {
    moduleCache: false,
  }).import("./file-access.ts");
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-authorize-agent-"));
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-authorize-")));
  const allowed = path.join(base, "allowed");
  const outside = path.join(base, "outside");
  const file = path.join(allowed, "file.txt");
  const link = path.join(allowed, "link");
  fs.mkdirSync(path.join(agentDir, "sessions"), { recursive: true });
  fs.mkdirSync(allowed);
  fs.mkdirSync(outside);
  fs.writeFileSync(file, "content");
  fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousRoots = globalThis.__piAdditionalAllowedRoots;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  globalThis.__piAdditionalAllowedRoots = undefined;
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    globalThis.__piAdditionalAllowedRoots = previousRoots;
    fs.rmSync(agentDir, { recursive: true, force: true });
    fs.rmSync(base, { recursive: true, force: true });
  });
  allowFileRoot(allowed);

  assert.deepEqual(await authorizeDirectory(""), { status: 400, error: "cwd must be an absolute path" });
  assert.deepEqual(await authorizeDirectory("relative/dir"), { status: 400, error: "cwd must be an absolute path" });
  assert.deepEqual(await authorizeDirectory(path.join(outside, "missing")), { status: 403, error: "Access denied" });
  assert.deepEqual(await authorizeDirectory(path.join(allowed, "missing")), { status: 404, error: "Directory not found" });
  assert.deepEqual(await authorizeDirectory(file), { status: 400, error: "Not a directory" });
  assert.deepEqual(await authorizeDirectory(link), { status: 403, error: "Access denied" });
  assert.deepEqual(await authorizeDirectory(allowed), { directory: allowed });

  assert.equal(await isExistingPathAllowed(link), false);
  assert.equal(await isExistingPathAllowed(path.join(allowed, "missing")), false);
  assert.equal(await isExistingPathAllowed(file), true);
});
