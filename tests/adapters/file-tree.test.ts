import { createFileTree } from "@adapters/fs/file-tree";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "web-pi-files-"));
  await mkdir(join(root, "src", "web"), { recursive: true });
  await mkdir(join(root, "node_modules", "junk"), { recursive: true });
  await writeFile(join(root, "README.md"), "hi");
  await writeFile(join(root, "src", "web", "app.tsx"), "x");
  await writeFile(join(root, "src", "ignored.log"), "x");
  await writeFile(join(root, "node_modules", "junk", "index.js"), "x");
  await writeFile(join(root, ".gitignore"), "*.log\nnode_modules/\n");
  execFileSync("git", ["init", "-q"], { cwd: root });
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("file tree", () => {
  it("lists tracked and untracked files while honouring .gitignore", async () => {
    const index = await createFileTree().index(root);
    expect(index.files).toContain("src/web/app.tsx");
    expect(index.files).toContain("README.md");
    expect(index.files).not.toContain("src/ignored.log");
    expect(index.files.some((file) => file.startsWith("node_modules"))).toBe(
      false,
    );
    expect(index.truncated).toBe(false);
  });

  it("falls back to a directory walk outside a repository", async () => {
    const plain = await mkdtemp(join(tmpdir(), "web-pi-plain-"));
    await mkdir(join(plain, "node_modules"), { recursive: true });
    await writeFile(join(plain, "node_modules", "skip.js"), "x");
    await writeFile(join(plain, "kept.txt"), "x");
    const index = await createFileTree().index(plain);
    expect(index.files).toEqual(["kept.txt"]);
    await rm(plain, { recursive: true, force: true });
  });

  it("completes immediate children by prefix, directories first", async () => {
    const files = createFileTree();
    const children = await files.children("./src/", root);
    expect(children.map((entry) => entry.path)).toEqual([
      join(root, "src", "web"),
      join(root, "src", "ignored.log"),
    ]);
    const filtered = await files.children("./src/w", root);
    expect(filtered).toEqual([{ path: join(root, "src", "web"), isDir: true }]);
  });

  it("reads a capture file and refuses a directory", async () => {
    const files = createFileTree();
    await writeFile(join(root, "capture.log"), "output");
    expect(await files.readOutput(join(root, "capture.log"))).toBe("output");
    await expect(files.readOutput(join(root, "src"))).rejects.toThrow();
  });
});
