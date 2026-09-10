import { createFakeWorld } from "@adapters/fake/index";
import { createWorkspace } from "@core/workspace";
import { describe, expect, it } from "vitest";

const settle = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

describe("workspace over the fake runtime", () => {
  it("streams a turn and settles it into the transcript", async () => {
    const world = createFakeWorld({ delayMs: 2, reply: () => "one two three" });
    const workspace = createWorkspace(world);
    const id = await workspace.startSession("/tmp/project", "hi");

    const during = await workspace.viewSession(id);
    expect(during?.status?.running).toBe(true);
    expect(during?.turn.map((item) => item.kind)).toEqual(["user"]);

    await settle(50);
    const after = await workspace.viewSession(id);
    expect(after?.status?.running).toBe(false);
    expect(after?.turn.map((item) => item.kind)).toEqual(["user", "assistant"]);
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
    await workspace.startSession("/repo/a", "x");
    await settle(30);
    await workspace.startSession("/repo/b", "y");
    await settle(30);

    const sidebar = await workspace.sidebar();
    expect(sidebar.projects.map((project) => project.key)).toEqual([
      "/repo/b",
      "/repo/a",
    ]);
    expect(sidebar.selected).toBe("/repo/b");
    expect(sidebar.sessions).toHaveLength(1);
    expect(sidebar.sessions[0]?.summary.live).toBe(true);

    const remembered = await workspace.sidebar({ remembered: "/repo/a" });
    expect(remembered.selected).toBe("/repo/a");
    expect(remembered.sessions[0]?.summary.cwd).toBe("/repo/a");
  });
});
