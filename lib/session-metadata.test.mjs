import assert from "node:assert/strict";
import { appendFile, mkdtemp, rename, rm, stat, unlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { readSessionRowMetadata, readStableSessionFile, sessionTitleFromFirstMessage } = await jiti.import("./session-metadata.ts");
const { SESSION_TITLE_MAX_CHARS } = await jiti.import("./session-metadata-types.ts");

function line(entry) {
  return JSON.stringify(entry);
}

const fixedTime = new Date("2026-01-01T00:00:00.000Z");

async function createStableFile(t) {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-stable-read-"));
  const filePath = join(dir, "session.jsonl");
  await writeFile(filePath, "before");
  await utimes(filePath, fixedTime, fixedTime);
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, filePath };
}


test("streams exact row metadata and collapses a skill expansion before truncating", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-session-metadata-"));
  const filePath = join(dir, "session.jsonl");
  t.after(() => rm(dir, { recursive: true, force: true }));
  const expandedSkill = [
    '<skill name="review" location="/tmp/review/SKILL.md">',
    "References are relative to /tmp/review.",
    "",
    "Long reusable instructions.",
    "</skill>",
    "",
    "check this branch",
  ].join("\n");
  await writeFile(filePath, [
    line({ type: "session", id: "session-1", timestamp: "2026-01-01T00:00:00.000Z", cwd: dir }),
    line({ type: "session_info", id: "n1", parentId: null, timestamp: "2026-01-01T00:00:01.000Z", name: "Old name" }),
    line({ type: "message", id: "u1", parentId: "n1", timestamp: "2026-01-01T00:00:02.000Z", message: { role: "user", content: expandedSkill } }),
    line({ type: "message", id: "a1", parentId: "u1", timestamp: "2026-01-01T00:00:03.000Z", message: { role: "assistant", content: [{ type: "text", text: "done" }] } }),
    line({ type: "message", id: "t1", parentId: "a1", timestamp: "2026-01-01T00:00:04.000Z", message: { role: "toolResult", content: [{ type: "text", text: "result" }] } }),
    line({ type: "session_info", id: "n2", parentId: "t1", timestamp: "2026-01-01T00:00:05.000Z", name: "Current name" }),
    "",
  ].join("\n"));
  const file = await stat(filePath);

  const metadata = await readSessionRowMetadata(filePath, "session-1", {
    fileSize: file.size,
    modified: file.mtime.toISOString(),
  });

  assert.equal(metadata?.name, "Current name");
  assert.equal(metadata?.messageCount, 3);
  assert.equal(metadata?.firstMessage, "/skill:review check this branch");
});

test("rejects a stale inventory fingerprint without returning metadata", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-session-metadata-stale-"));
  const filePath = join(dir, "session.jsonl");
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(filePath, `${line({ type: "session", id: "session-1", timestamp: "2026-01-01T00:00:00.000Z", cwd: dir })}\n`);

  assert.equal(await readSessionRowMetadata(filePath, "session-1", {
    fileSize: 0,
    modified: "2026-01-01T00:00:00.000Z",
  }), null);
});

test("stable reads return values and preserve callback errors only when identity is unchanged", async (t) => {
  const { filePath } = await createStableFile(t);
  assert.equal(await readStableSessionFile(filePath, () => "value"), "value");

  const callbackError = new Error("snapshot failed");
  await assert.rejects(
    readStableSessionFile(filePath, () => { throw callbackError; }),
    (error) => error === callbackError,
  );
});

test("stable reads reject changed identity after callback success or error", async (t) => {
  const changes = {
    deleted: (filePath) => unlink(filePath),
    appended: (filePath) => appendFile(filePath, " changed"),
    metadata: (filePath) => utimes(filePath, fixedTime, new Date("2026-01-02T00:00:00.000Z")),
    replaced: async (filePath, dir) => {
      const before = await stat(filePath);
      const replacement = join(dir, "replacement.jsonl");
      await writeFile(replacement, "after!");
      await utimes(replacement, fixedTime, fixedTime);
      await rename(replacement, filePath);
      const after = await stat(filePath);
      assert.equal(after.size, before.size);
      assert.equal(after.mtime.toISOString(), before.mtime.toISOString());
    },
  };

  for (const [name, change] of Object.entries(changes)) {
    for (const callbackFails of [false, true]) {
      await t.test(`${name} after callback ${callbackFails ? "error" : "success"}`, async (t) => {
        const { dir, filePath } = await createStableFile(t);
        const result = await readStableSessionFile(filePath, async () => {
          await change(filePath, dir);
          if (callbackFails) throw new Error("snapshot failed");
          return "value";
        });
        assert.equal(result, null);
      });
    }
  }
});

test("stable reads reject a file appearing after a transient read", async (t) => {
  for (const callbackFails of [false, true]) {
    await t.test(`after callback ${callbackFails ? "error" : "success"}`, async (t) => {
      const dir = await mkdtemp(join(tmpdir(), "pi-web-stable-read-appeared-"));
      const filePath = join(dir, "session.jsonl");
      t.after(() => rm(dir, { recursive: true, force: true }));
      const result = await readStableSessionFile(filePath, async () => {
        await writeFile(filePath, "appeared");
        if (callbackFails) throw new Error("snapshot failed");
        return "value";
      });
      assert.equal(result, null);
    });
  }
});

test("stable reads treat an unavailable post-read fingerprint as a conflict", async (t) => {
  for (const callbackFails of [false, true]) {
    await t.test(`after callback ${callbackFails ? "error" : "success"}`, async (t) => {
      const { dir, filePath } = await createStableFile(t);
      const result = await readStableSessionFile(filePath, async () => {
        await unlink(filePath);
        await rm(dir, { recursive: true });
        await writeFile(dir, "not a directory");
        if (callbackFails) throw new Error("snapshot failed");
        return "value";
      });
      assert.equal(result, null);
    });
  }
});

test("stable reads preserve an initial fingerprint error without invoking the callback", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-stable-read-error-"));
  const notDirectory = join(dir, "not-a-directory");
  await writeFile(notDirectory, "file");
  t.after(() => rm(dir, { recursive: true, force: true }));
  let called = false;

  await assert.rejects(
    readStableSessionFile(join(notDirectory, "session.jsonl"), () => {
      called = true;
      return "value";
    }),
    (error) => error.code === "ENOTDIR",
  );
  assert.equal(called, false);
});

test("caps plain first-message titles", () => {
  const title = sessionTitleFromFirstMessage("x".repeat(SESSION_TITLE_MAX_CHARS + 100));
  assert.equal(title.length, SESSION_TITLE_MAX_CHARS);
});
