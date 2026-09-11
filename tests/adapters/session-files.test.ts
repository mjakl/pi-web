import { assistantEntry } from "@adapters/fake/index";
import { exportSessionHtml } from "@adapters/pi/session-export";
import { createPiSessionCatalog } from "@adapters/pi/session-catalog";
import {
  branchToNewFile,
  removeSessionFile,
  rewindSessionFile,
} from "@adapters/pi/session-files";
import { readStars, rowMetadata, userMessageText } from "@core/session-entries";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// These run against real session files the Pi SDK wrote, in a throwaway agent
// directory. Never point them at ~/.pi/agent.

let root = "";
let sessionDir = "";
const cwd = "/repo/demo";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "web-pi-test-"));
  sessionDir = join(root, "sessions", "demo");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function answer(text: string) {
  const entry = assistantEntry("ignored", null, text, 1000);
  if (entry.type !== "message" || entry.message.role !== "assistant") {
    throw new Error("unreachable");
  }
  return entry.message;
}

/** A session with `count` user/assistant exchanges, written to disk. */
function makeSession(
  texts: string[],
  options: { parentSession?: string } = {},
): SessionManager {
  const manager = SessionManager.create(cwd, sessionDir, options);
  for (const text of texts) {
    manager.appendMessage({ role: "user", content: text, timestamp: 1 });
    manager.appendMessage(answer(`answer to ${text}`));
  }
  return manager;
}

function lines(filePath: string): SessionEntry[] {
  return readFileSync(filePath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SessionEntry);
}

function fileOf(manager: SessionManager): string {
  const file = manager.getSessionFile();
  if (!file) throw new Error("session has no file");
  return file;
}

describe("session file edits", () => {
  it("re-attaches children to the deleted session's own parent", () => {
    const grandparent = makeSession(["root"]);
    const parent = makeSession(["middle"], {
      parentSession: fileOf(grandparent),
    });
    const child = makeSession(["leaf"], { parentSession: fileOf(parent) });
    const subagent = makeSession(["subagent"], {
      parentSession: fileOf(parent),
    });
    const subagentFile = fileOf(subagent);
    writeFileSync(
      subagentFile,
      `${readFileSync(subagentFile, "utf8")}${JSON.stringify({
        type: "custom",
        customType: "pi-web:subagent",
        id: "s1",
        parentId: null,
        timestamp: "2026-01-01T00:00:00.000Z",
      })}\n`,
    );
    const before = readFileSync(subagentFile, "utf8");
    const childEntriesBefore = readFileSync(fileOf(child), "utf8")
      .split("\n")
      .slice(1)
      .join("\n");

    removeSessionFile(fileOf(parent));

    const header = lines(fileOf(child))[0] as unknown as {
      parentSession?: string;
    };
    expect(header.parentSession).toBe(fileOf(grandparent));
    // Only the header line is rewritten.
    expect(
      readFileSync(fileOf(child), "utf8").split("\n").slice(1).join("\n"),
    ).toBe(childEntriesBefore);
    // Legacy subagent transcripts are left byte for byte alone.
    expect(readFileSync(subagentFile, "utf8")).toBe(before);
  });

  it("rewinds to a user message, keeping earlier lines verbatim", () => {
    const manager = makeSession(["first", "second"]);
    const file = fileOf(manager);
    const entries = manager.getEntries();
    const firstAnswer = entries[1];
    const secondPrompt = entries[2];
    if (!firstAnswer || !secondPrompt) throw new Error("missing entries");
    manager.appendCustomEntry("pi-web:star", {
      targetId: firstAnswer.id,
      starred: true,
    });
    manager.appendSessionInfo("Named later");
    const kept = readFileSync(file, "utf8").split("\n").slice(0, 3).join("\n");

    const removed = rewindSessionFile(file, secondPrompt.id);

    expect(removed).toBe("second");
    const after = lines(file);
    expect(readFileSync(file, "utf8").split("\n").slice(0, 3).join("\n")).toBe(
      kept,
    );
    expect(after.map((entry) => entry.type)).toEqual([
      "session",
      "message",
      "message",
      "custom",
      "session_info",
      "custom",
    ]);
    const reopened = SessionManager.open(file);
    expect(reopened.getSessionName()).toBe("Named later");
    expect(readStars(reopened.getEntries())).toEqual(new Set([firstAnswer.id]));
    // The reopened branch no longer contains the removed message.
    expect(
      reopened.getBranch().some((entry) => entry.id === secondPrompt.id),
    ).toBe(false);
  });

  it("copies a branch into a new file with its stars", () => {
    const manager = makeSession(["first", "second"]);
    const file = fileOf(manager);
    const entries = manager.getEntries();
    const firstAnswer = entries[1];
    if (!firstAnswer) throw new Error("missing entry");
    manager.appendCustomEntry("pi-web:star", {
      targetId: firstAnswer.id,
      starred: true,
    });

    const forked = branchToNewFile(file, firstAnswer.id);

    const copy = SessionManager.open(forked.file);
    expect(copy.getSessionId()).toBe(forked.id);
    expect(
      copy
        .getEntries()
        .filter((entry) => entry.type === "message")
        .map((entry) => userMessageText(entry) ?? "answer"),
    ).toEqual(["first", "answer"]);
    expect(readStars(copy.getEntries()).size).toBe(1);
    const header = copy.getHeader();
    expect(header?.parentSession).toBe(file);
    // The source file is untouched.
    expect(SessionManager.open(file).getEntries()).toHaveLength(5);
  });
});

describe("Pi session catalog", () => {
  it("streams row metadata that matches the in-memory derivation", async () => {
    const manager = makeSession(["hello world", "again"]);
    const answers = manager
      .getEntries()
      .filter((entry) => entry.type === "message" && entry.id);
    const target = answers[1];
    if (!target) throw new Error("missing answer");
    manager.appendCustomEntry("pi-web:star", {
      targetId: target.id,
      starred: true,
    });
    manager.appendSessionInfo("  Named  ");

    const catalog = createPiSessionCatalog({ agentDir: root });
    const listed = await catalog.list();
    expect(listed.map((session) => session.cwd)).toEqual([cwd]);
    const id = manager.getSessionId();
    const row = await catalog.rowMetadata(id);
    const stored = await catalog.read(id);
    expect(row?.summary).toMatchObject({ id, cwd, name: "Named" });
    expect(row?.metadata).toEqual(
      rowMetadata(stored?.entries ?? [], {
        modifiedAt: row?.metadata.modifiedAt ?? "",
        fileSize: row?.metadata.fileSize ?? 0,
      }),
    );
    expect(row?.metadata).toMatchObject({
      name: "Named",
      firstMessage: "hello world",
      messageCount: 4,
      starCount: 1,
    });
  });

  it("renames, stars only answers, and deletes", async () => {
    const manager = makeSession(["hello"]);
    const catalog = createPiSessionCatalog({ agentDir: root });
    const id = manager.getSessionId();
    await catalog.list();

    await catalog.rename(id, "Renamed");
    expect((await catalog.rowMetadata(id))?.metadata.name).toBe("Renamed");

    const entries = manager.getEntries();
    const prompt = entries[0];
    const reply = entries[1];
    if (!prompt || !reply) throw new Error("missing entries");
    await expect(catalog.setStar(id, prompt.id, true)).rejects.toThrow(
      /assistant answer/,
    );
    await catalog.setStar(id, reply.id, true);
    expect((await catalog.rowMetadata(id))?.metadata.starCount).toBe(1);

    await catalog.remove(id);
    expect(await catalog.read(id)).toBeUndefined();
  });

  it("says nothing rather than throwing for a file Pi has not written", async () => {
    const catalog = createPiSessionCatalog({ agentDir: root });
    // The runtime remembers where a new session will live before Pi flushes
    // it; the sidebar row must not 500 over that.
    catalog.remember(
      "01999999-9999-7999-8999-999999999999",
      join(sessionDir, "not-written-yet.jsonl"),
    );
    expect(
      await catalog.rowMetadata("01999999-9999-7999-8999-999999999999"),
    ).toBeUndefined();
  });

  it("re-reads a file that changed instead of serving the cached counts", async () => {
    const manager = makeSession(["hello"]);
    const catalog = createPiSessionCatalog({ agentDir: root });
    const id = manager.getSessionId();
    await catalog.list();
    expect((await catalog.rowMetadata(id))?.metadata.messageCount).toBe(2);

    manager.appendMessage({ role: "user", content: "more", timestamp: 2 });
    // The cache is keyed by file and stamped by size and mtime, so the older
    // stamp cannot linger and win.
    expect((await catalog.rowMetadata(id))?.metadata.messageCount).toBe(3);
  });

  it("forks a user message with no text before the message itself", async () => {
    const manager = makeSession(["hello"]);
    manager.appendMessage({
      role: "user",
      content: [{ type: "image", data: "AAAA", mimeType: "image/png" }],
      timestamp: 3,
    });
    const catalog = createPiSessionCatalog({ agentDir: root });
    const id = manager.getSessionId();
    await catalog.list();
    const wordless = manager.getEntries().at(-1);
    if (!wordless) throw new Error("missing entry");

    const forked = await catalog.fork(id, wordless.id);
    const branch = (await catalog.read(forked.id))?.branch ?? [];
    expect(branch.map((entry) => entry.id)).not.toContain(wordless.id);
    expect(branch).toHaveLength(2);
  });

  it("estimates what a compaction left in context", async () => {
    const manager = makeSession(["hello"]);
    const catalog = createPiSessionCatalog({ agentDir: root });
    const id = manager.getSessionId();
    await catalog.list();
    const entries = manager.getEntries();
    const last = entries.at(-1);
    if (!last) throw new Error("missing entry");
    expect(catalog.contextTokensAt(id, entries, last.id)).toBeGreaterThan(0);
  });
});

describe("HTML export", () => {
  it("renders through the Pi CLI with the tree walks made iterative", async () => {
    const manager = makeSession(["hello"]);
    const exported = await exportSessionHtml(fileOf(manager));

    expect(exported.filename).toMatch(/^pi-session-.*\.html$/);
    // The transcript itself is embedded as encoded bytes, not as markup.
    expect(exported.html).toContain("<!DOCTYPE html>");
    // Deep sessions overflow the exported page's stack without these.
    expect(exported.html).toContain("function sortChildren(root)");
    expect(exported.html).not.toContain("tree.forEach(mapNodes)");
    expect(exported.html).not.toContain("roots.forEach(markActive)");
  });
});
