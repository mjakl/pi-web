import {
  assistantEntry,
  createFakeWorld,
  userEntry,
} from "@adapters/fake/index";
import { createWorkspace } from "@core/workspace";
import { createWebApp } from "@web/app";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The file routes against a real checkout: a temporary Git repository is
// simpler than a fake file system, and it is the only way a diff means
// anything.

let repo = "";
let outside = "";
let pickable = "";
let app: ReturnType<typeof createWebApp>;
let hasZip = true;

function git(...args: string[]): void {
  execFileSync("git", args, { cwd: repo, stdio: "ignore" });
}

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), "web-pi-panel-"));
  // Never validated: it is what "outside every root" means in these tests.
  outside = await mkdtemp(join(tmpdir(), "web-pi-outside-"));
  pickable = await mkdtemp(join(tmpdir(), "web-pi-pickable-"));
  await writeFile(join(outside, "secret.txt"), "not yours\n");
  await writeFile(join(outside, "secret2.txt"), "nope\n");
  await mkdir(join(repo, "src"), { recursive: true });
  await writeFile(join(repo, "src", "main.ts"), "const a = 1;\nexport {};\n");
  await writeFile(
    join(repo, "notes.md"),
    "---\ntitle: Notes\ntags: [one, two]\n---\n\n# Heading\n\ntext\n",
  );
  await writeFile(join(repo, "logo.png"), PNG);
  await writeFile(join(repo, "a.svg"), "<svg xmlns='x'/>");
  await symlink(outside, join(repo, "escape"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("add", "-A");
  git("commit", "-qm", "first");
  await writeFile(join(repo, "src", "main.ts"), "const a = 2;\nexport {};\n");
  await writeFile(join(repo, "fresh.txt"), "new\n");

  // Built outside the repository so its parts do not show up as changes.
  const docxSource = await mkdtemp(join(tmpdir(), "web-pi-docx-"));
  try {
    await mkdir(join(docxSource, "word"), { recursive: true });
    await mkdir(join(docxSource, "_rels"), { recursive: true });
    await writeFile(
      join(docxSource, "[Content_Types].xml"),
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    );
    await writeFile(
      join(docxSource, "_rels", ".rels"),
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    );
    await writeFile(
      join(docxSource, "word", "document.xml"),
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello docx</w:t></w:r></w:p></w:body></w:document>',
    );
    execFileSync("zip", ["-q", "-r", join(repo, "report.docx"), "."], {
      cwd: docxSource,
      stdio: "ignore",
    });
  } catch {
    hasZip = false;
  }
  await rm(docxSource, { recursive: true, force: true });

  const world = createFakeWorld({
    delayMs: 1,
    sessions: [
      {
        summary: {
          id: "s1",
          cwd: repo,
          name: "Panel",
          createdAt: "2026-09-01T00:00:00.000Z",
          modifiedAt: "2026-09-02T00:00:00.000Z",
          fileSize: 10,
        },
        entries: [
          userEntry("u1", null, `look at ${join(outside, "secret.txt")}`),
          assistantEntry("a1", "u1", "done", 100),
        ],
      },
    ],
  });
  app = createWebApp({
    workspace: createWorkspace(world),
    staticRoot: "/nonexistent",
    defaultCwd: repo,
    renderIntervalMs: 1,
  });
});

afterAll(async () => {
  await rm(repo, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
  await rm(pickable, { recursive: true, force: true });
});

describe("explorer", () => {
  it("lists the root with the changes above it", async () => {
    const html = await (await app.request("/files/explorer?session=s1")).text();
    expect(html).toContain('role="tree"');
    expect(html).toContain('data-name="src"');
    expect(html).toContain('data-name="notes.md"');
    expect(html).toContain("changes-head");
    expect(html).toContain("src/main.ts (Modified)");
    expect(html).toContain("fresh.txt (Untracked)");
    // The modified file sits under src/, so the folder carries the dot.
    expect(html).toContain("tree-dot");
    expect(html).toContain('data-file-mode="diff"');
  });

  it("expands one directory at a time", async () => {
    const url = `/files/tree?session=s1&depth=1&path=${encodeURIComponent(join(repo, "src"))}`;
    const html = await (await app.request(url)).text();
    expect(html).toContain('data-name="main.ts"');
    expect(html).toContain(">M<");
    expect(html).not.toContain('data-name="notes.md"');
  });

  it("searches the index and puts the tree back on an empty query", async () => {
    const found = await (
      await app.request("/files/search?session=s1&q=main")
    ).text();
    expect(found).toContain("src/main.ts");
    expect(found).not.toContain('data-name="notes.md"');
    const cleared = await (
      await app.request("/files/search?session=s1&q=")
    ).text();
    expect(cleared).toContain('data-name="notes.md"');
  });
});

describe("viewer", () => {
  it("numbers the lines of a source file and colours it", async () => {
    const url = `/files/view?session=s1&path=${encodeURIComponent(join(repo, "src", "main.ts"))}`;
    const html = await (await app.request(url)).text();
    expect(html).toContain('data-mode="source"');
    expect(html).toContain('data-line="1"');
    expect(html).toContain("hljs-keyword");
    expect(html).toContain("2 lines");
  });

  it("defaults markdown to the rendered preview with its frontmatter", async () => {
    const url = `/files/view?session=s1&path=${encodeURIComponent(join(repo, "notes.md"))}`;
    const html = await (await app.request(url)).text();
    expect(html).toContain('data-mode="preview"');
    expect(html).toContain("frontmatter-chip");
    expect(html).toContain(">Notes</h2>");
    expect(html).toContain("<h1 id=");
    // The block itself never reaches the rendered body.
    expect(html).not.toContain("tags: [one, two]");
  });

  it("shows the diff of a changed file", async () => {
    const url = `/files/view?session=s1&mode=diff&path=${encodeURIComponent(join(repo, "src", "main.ts"))}`;
    const html = await (await app.request(url)).text();
    expect(html).toContain('data-mode="diff"');
    expect(html).toContain("diff-removed");
    expect(html).toContain("diff-added");
    expect(html).toContain("const a = 2;");
  });

  it("falls back to source when the requested diff does not exist", async () => {
    const url = `/files/view?session=s1&mode=diff&path=${encodeURIComponent(join(repo, "notes.md"))}`;
    const html = await (await app.request(url)).text();
    expect(html).toContain('data-mode="source"');
  });

  it("renders an image through the raw route", async () => {
    const url = `/files/view?session=s1&path=${encodeURIComponent(join(repo, "logo.png"))}`;
    const html = await (await app.request(url)).text();
    expect(html).toContain("media-image");
    expect(html).toContain("/files/raw?path=");
  });
});

describe("raw bytes", () => {
  const url = (extra = "") =>
    `/files/raw?session=s1&path=${encodeURIComponent(join(repo, "logo.png"))}${extra}`;

  it("streams with range headers and the right type", async () => {
    const res = await app.request(url());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-disposition")).toContain(
      'inline; filename="logo.png"',
    );
    expect((await res.arrayBuffer()).byteLength).toBe(PNG.length);
  });

  it("answers a byte range with 206 and the slice", async () => {
    const res = await app.request(url(), {
      headers: { Range: "bytes=0-3" },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(
      `bytes 0-3/${String(PNG.length)}`,
    );
    expect((await res.arrayBuffer()).byteLength).toBe(4);
  });

  it("rejects a range it cannot satisfy", async () => {
    const res = await app.request(url(), {
      headers: { Range: "bytes=99999-" },
    });
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe(
      `bytes */${String(PNG.length)}`,
    );
  });

  it("downloads as an attachment", async () => {
    const res = await app.request(url("&download=1"));
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toContain("attachment");
  });

  it("locks an SVG down so it cannot run in this origin", async () => {
    const res = await app.request(
      `/files/raw?session=s1&path=${encodeURIComponent(join(repo, "a.svg"))}`,
    );
    expect(res.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
  });
});

describe("meta and containment", () => {
  it("reports size, language, and kind", async () => {
    const res = await app.request(
      `/files/meta?session=s1&path=${encodeURIComponent(join(repo, "notes.md"))}`,
    );
    const meta = (await res.json()) as Record<string, unknown>;
    expect(meta["language"]).toBe("markdown");
    expect(meta["kind"]).toBe("text");
    expect(typeof meta["size"]).toBe("number");
  });

  it("maps a relative path to 400, a missing file to 404, and an outsider to 403", async () => {
    expect((await app.request("/files/view?session=s1&path=src")).status).toBe(
      400,
    );
    expect(
      (
        await app.request(
          `/files/view?session=s1&path=${encodeURIComponent(join(repo, "nope.ts"))}`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(
          `/files/view?session=s1&path=${encodeURIComponent(join(outside, "other.txt"))}`,
        )
      ).status,
    ).toBe(403);
  });

  it("lets a file the transcript names be read, but never listed", async () => {
    const path = join(outside, "secret.txt");
    const view = await app.request(
      `/files/view?session=s1&path=${encodeURIComponent(path)}`,
    );
    expect(view.status).toBe(200);
    expect(await view.text()).toContain("not yours");
    const listed = await app.request(
      `/files/tree?session=s1&depth=1&path=${encodeURIComponent(outside)}`,
    );
    expect(listed.status).toBe(403);
  });

  it("refuses a path that escapes through a symlink", async () => {
    // Lexically inside the repository, but it resolves outside it.
    const res = await app.request(
      `/files/view?session=s1&path=${encodeURIComponent(join(repo, "escape", "secret2.txt"))}`,
    );
    expect(res.status).toBe(403);
  });
});

describe("docx and watching", () => {
  it("converts a Word document behind a locked-down policy", async () => {
    if (!hasZip) return;
    const res = await app.request(
      `/files/docx?session=s1&path=${encodeURIComponent(join(repo, "report.docx"))}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe(
      "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
    );
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await res.text()).toContain("Hello docx");
  });

  it("refuses anything that is not a Word document", async () => {
    const res = await app.request(
      `/files/docx?session=s1&path=${encodeURIComponent(join(repo, "notes.md"))}`,
    );
    expect(res.status).toBe(400);
  });

  it("opens a watch stream and announces itself", async () => {
    const res = await app.request(
      `/files/watch?session=s1&path=${encodeURIComponent(join(repo, "notes.md"))}`,
    );
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body?.getReader();
    const chunk = await reader?.read();
    expect(new TextDecoder().decode(chunk?.value)).toContain(
      "event: connected",
    );
    await reader?.cancel();
  });

  it("tells the viewer when it may not watch a file", async () => {
    const res = await app.request(
      `/files/watch?session=s1&path=${encodeURIComponent(join(outside, "other.txt"))}`,
    );
    const reader = res.body?.getReader();
    const chunk = await reader?.read();
    expect(new TextDecoder().decode(chunk?.value)).toContain("event: error");
    await reader?.cancel();
  });
});

describe("workspace validation", () => {
  it("accepts a folder and refuses a file", async () => {
    const form = new FormData();
    form.set("cwd", pickable);
    const res = await app.request("/workspaces/validate", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      cwd: pickable,
      projectRoot: pickable,
      projectKey: pickable,
    });
    // Validating it is what makes it reachable.
    const listed = await app.request(
      `/files/tree?session=s1&depth=1&path=${encodeURIComponent(pickable)}`,
    );
    expect(listed.status).toBe(200);
  });

  it("refuses a path that is not a folder", async () => {
    const form = new FormData();
    form.set("cwd", join(repo, "notes.md"));
    const res = await app.request("/workspaces/validate", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(400);
  });
});
