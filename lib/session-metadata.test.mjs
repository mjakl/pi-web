import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { readSessionRowMetadata, sessionTitleFromFirstMessage } = await jiti.import("./session-metadata.ts");
const { SESSION_TITLE_MAX_CHARS } = await jiti.import("./session-metadata-types.ts");

function line(entry) {
  return JSON.stringify(entry);
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

test("caps plain first-message titles", () => {
  const title = sessionTitleFromFirstMessage("x".repeat(SESSION_TITLE_MAX_CHARS + 100));
  assert.equal(title.length, SESSION_TITLE_MAX_CHARS);
});
