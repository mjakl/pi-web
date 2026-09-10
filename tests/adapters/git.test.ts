import { createGit } from "@adapters/git/git";
import { execFileSync } from "node:child_process";
import { mkdtemp, rename, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let root = "";
const git = createGit();

function run(...args: string[]): void {
  execFileSync("git", args, { cwd: root, stdio: "ignore" });
}

/** The status entry for one file, so a missing one fails loudly. */
async function change(name: string) {
  const status = await git.status(root);
  const file = status.files.find((entry) => entry.path.endsWith(name));
  if (!file) throw new Error(`no status entry for ${name}`);
  return file;
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "web-pi-git-"));
  run("init", "-q", "-b", "main");
  run("config", "user.email", "test@example.com");
  run("config", "user.name", "Test");
  await writeFile(join(root, "kept.txt"), "one\ntwo\nthree\n");
  await writeFile(join(root, "gone.txt"), "bye\n");
  await writeFile(join(root, "moved.txt"), "same content here\n");
  await writeFile(join(root, "logo.bin"), Buffer.from([0, 1, 2, 0, 3]));
  run("add", "-A");
  run("commit", "-qm", "first");
  // Modified, deleted, renamed, untracked, and a binary change.
  await writeFile(join(root, "kept.txt"), "one\nTWO\nthree\nfour\n");
  await unlink(join(root, "gone.txt"));
  await rename(join(root, "moved.txt"), join(root, "renamed.txt"));
  await writeFile(
    join(root, "renamed.txt"),
    "same content here\nplus one line\n",
  );
  run("add", "-A");
  await writeFile(join(root, "fresh.txt"), "a\nb\n");
  await writeFile(join(root, "logo.bin"), Buffer.from([0, 9, 9, 0, 3]));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("git status", () => {
  it("classifies every kind of change and counts the lines", async () => {
    const status = await git.status(root);
    expect(status.isRepository).toBe(true);
    expect(status.root).toBe(root);
    const byName = new Map(
      status.files.map((file) => [file.path.slice(root.length + 1), file]),
    );
    expect(byName.get("kept.txt")?.status).toBe("M");
    expect(byName.get("gone.txt")?.status).toBe("D");
    expect(byName.get("renamed.txt")?.status).toBe("R");
    expect(byName.get("renamed.txt")?.original).toBe(join(root, "moved.txt"));
    expect(byName.get("fresh.txt")?.status).toBe("U");
    // 2 added in kept.txt, 2 in the untracked file; the binary row is skipped.
    expect(status.additions).toBeGreaterThanOrEqual(4);
    expect(status.deletions).toBeGreaterThanOrEqual(2);
  });

  it("reports an empty shape outside a repository", async () => {
    const plain = await mkdtemp(join(tmpdir(), "web-pi-plain-git-"));
    expect(await git.status(plain)).toEqual({
      isRepository: false,
      root: null,
      files: [],
      additions: 0,
      deletions: 0,
    });
    await rm(plain, { recursive: true, force: true });
  });
});

describe("git diff", () => {
  it("diffs a modified file against HEAD", async () => {
    const patch = await git.diff(root, await change("kept.txt"));
    expect(patch).toContain("@@ ");
    expect(patch).toContain("-two");
    expect(patch).toContain("+TWO");
  });

  it("keeps a deleted file's contents on the removed side", async () => {
    const patch = await git.diff(root, await change("gone.txt"));
    expect(patch).toContain("-bye");
  });

  it("uses both paths for a rename", async () => {
    const patch = await git.diff(root, await change("renamed.txt"));
    expect(patch).toContain("moved.txt");
    expect(patch).toContain("renamed.txt");
    expect(patch).toContain("+plus one line");
  });

  it("builds a synthetic patch for an untracked file", async () => {
    const patch = await git.diff(root, await change("fresh.txt"));
    expect(patch).toContain("new file mode 100644");
    expect(patch).toContain("--- /dev/null");
    expect(patch).toContain("+a\n+b");
  });

  it("refuses a binary file", async () => {
    expect(await git.diff(root, await change("logo.bin"))).toBeNull();
  });
});
