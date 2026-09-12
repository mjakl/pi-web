import { createFakeWorld, userEntry } from "@adapters/fake/index";
import { createWorkspace } from "@core/workspace";
import { describe, expect, it } from "vitest";

async function sendFirst(
  workspace: ReturnType<typeof createWorkspace>,
  cwd: string,
  text: string,
) {
  const id = await workspace.createSession(cwd);
  await workspace.send(id, text);
  return id;
}

const settle = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

describe("workspace over the fake runtime", () => {
  it("streams a turn and settles it into the transcript", async () => {
    const world = createFakeWorld({ delayMs: 2, reply: () => "one two three" });
    const workspace = createWorkspace(world);
    const id = await sendFirst(workspace, "/tmp/project", "hi");

    const during = await workspace.viewSession(id);
    expect(during?.status?.running).toBe(true);
    expect(during?.turn.map((item) => item.kind)).toEqual(["user"]);

    await settle(50);
    const after = await workspace.viewSession(id);
    expect(after?.status?.running).toBe(false);
    // A settled turn belongs to the log: it is handed over once, as
    // `settledTurn`, and a later re-render must not repeat it in `turn`.
    expect(after?.settledTurn.map((item) => item.kind)).toEqual([
      "user",
      "assistant",
    ]);
    expect(after?.turn).toEqual([]);
    expect(after?.items.map((item) => item.kind)).toEqual([
      "user",
      "assistant",
    ]);
    expect(after?.usage).toMatchObject({
      tokens: 1500,
      contextWindow: 100_000,
      level: "ok",
    });
    expect(Math.round(after?.usage.percent ?? 0)).toBe(2);
  });

  it("shows one project at a time and marks live sessions", async () => {
    const world = createFakeWorld({ delayMs: 2 });
    const workspace = createWorkspace(world);
    await sendFirst(workspace, "/repo/a", "x");
    await settle(30);
    await sendFirst(workspace, "/repo/b", "y");
    await settle(30);

    const sidebar = await workspace.sidebar();
    expect(sidebar.projects.map((project) => project.key)).toEqual([
      "/repo/b",
      "/repo/a",
    ]);
    expect(sidebar.selected).toBe("/repo/b");
    expect(sidebar.sessions).toHaveLength(1);
    expect(sidebar.sessions[0]?.live).toBe(true);

    const remembered = await workspace.sidebar({ remembered: "/repo/a" });
    expect(remembered.selected).toBe("/repo/a");
    expect(remembered.sessions[0]?.cwd).toBe("/repo/a");
  });

  it("does not re-render a settled turn when something else happens", async () => {
    const world = createFakeWorld({ delayMs: 2, reply: () => "answer" });
    const workspace = createWorkspace(world);
    const id = await sendFirst(workspace, "/tmp/project", "hi");
    await settle(50);

    // A star, a rename, an extension status: all of them are `activity`, and
    // none of them may put the turn that already settled back on screen.
    const answer = (await workspace.viewSession(id))?.items.find(
      (item) => item.kind === "assistant",
    );
    await workspace.setStar(id, answer?.entryId ?? "", true);
    const after = await workspace.viewSession(id);
    expect(after?.turn).toEqual([]);
    const ids = (after?.items ?? []).map((item) => item.entryId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reads another branch of a running session from the runtime", async () => {
    const world = createFakeWorld({ delayMs: 2, reply: () => "answer" });
    const workspace = createWorkspace(world);
    const id = await sendFirst(workspace, "/tmp/project", "first");
    await settle(50);
    const first = (await workspace.viewSession(id))?.items[0]?.entryId ?? "";
    // A live session owns its file; reading it from disk could serve a branch
    // Pi has not flushed yet, so the file must not be touched at all.
    world.sessions.read = () => {
      throw new Error("the file must not be read while the session is live");
    };

    const branch = await workspace.viewSession(id, { leaf: first });
    expect(branch?.otherBranch).toBe(true);
    expect(branch?.items.map((item) => item.kind)).toEqual(["user"]);
  });

  it("forks a user message that is only images before that message", async () => {
    const world = createFakeWorld({ delayMs: 2 });
    const workspace = createWorkspace(world);
    const id = await sendFirst(workspace, "/tmp/project", "first");
    await settle(50);
    await workspace.send(id, "", {
      images: [{ data: "AAAA", mimeType: "image/png" }],
    });
    await settle(50);

    const items = (await workspace.viewSession(id))?.items ?? [];
    const wordless = items.filter((item) => item.kind === "user").at(-1);
    const forked = await workspace.fork(id, wordless?.entryId ?? "");
    expect(forked).toMatchObject({
      text: "",
      // The fake runtime records a thumbnail rather than the uploaded bytes.
      images: [
        {
          data: "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
          mimeType: "image/gif",
        },
      ],
    });
    const view = await workspace.viewSession(forked.id);
    expect(view?.items.map((item) => item.entryId)).not.toContain(
      wordless?.entryId,
    );
    const recalled = await workspace.rewind(id, wordless?.entryId ?? "");
    expect(recalled).toEqual({ text: "", images: forked.images });
    expect(world.runtime.get(id)).toBeUndefined();
    expect(
      (await workspace.viewSession(id))?.items.map((item) => item.entryId),
    ).not.toContain(wordless?.entryId);
  });

  it("recalls the queue with the images its messages carried", async () => {
    const world = createFakeWorld({ delayMs: 20, reply: () => "slow answer" });
    const workspace = createWorkspace(world);
    const id = await sendFirst(workspace, "/tmp/project", "first");
    await workspace.send(id, "second", {
      behavior: "followUp",
      images: [{ data: "AAAA", mimeType: "image/png" }],
    });

    const recalled = workspace.recallQueue(id);
    expect(recalled.text).toBe("second");
    expect(recalled.images).toEqual([{ data: "AAAA", mimeType: "image/png" }]);
  });

  it("puts the post-compaction estimate on the compaction card", async () => {
    const world = createFakeWorld({
      delayMs: 2,
      sessions: [
        {
          summary: {
            id: "c1",
            cwd: "/repo/one",
            createdAt: "2026-09-01T00:00:00.000Z",
            modifiedAt: "2026-09-01T00:00:00.000Z",
            fileSize: 3,
          },
          entries: [
            userEntry("u1", null, "question"),
            {
              type: "compaction",
              id: "k1",
              parentId: "u1",
              timestamp: "2026-09-01T00:00:00.000Z",
              summary: "what happened",
              tokensBefore: 40_000,
              firstKeptEntryId: "u1",
            } as never,
          ],
        },
      ],
    });
    const workspace = createWorkspace(world);
    const view = await workspace.viewSession("c1");
    const card = view?.items.find((item) => item.kind === "compaction");
    expect(card?.tokensAfter).toBeGreaterThan(0);
  });
});
