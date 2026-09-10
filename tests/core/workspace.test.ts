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

  it("groups stored sessions by project and marks live ones", async () => {
    const world = createFakeWorld({ delayMs: 2 });
    const workspace = createWorkspace(world);
    await workspace.startSession("/repo/a", "x");
    await settle(30);
    const groups = await workspace.listSessions();
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("repo/a");
    expect(groups[0]?.sessions[0]?.live).toBe(true);
  });
});
