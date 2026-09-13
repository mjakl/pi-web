import {
  assistantEntry,
  createFakeWorld,
  userEntry,
} from "@adapters/fake/index";
import { createWorkspace } from "@core/workspace";
import { createWebApp } from "@web/app";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

/** A persisted branch whose real fake-catalog history operations can rewrite it. */
export async function rewritableSession() {
  const entries: SessionEntry[] = [];
  for (let i = 1; i <= 60; i += 1) {
    const user = userEntry(
      `u${String(i)}`,
      entries.at(-1)?.id ?? null,
      `Question ${String(i)}`,
    );
    const answer = assistantEntry(
      `a${String(i)}`,
      user.id,
      `Answer ${String(i)}`,
      100,
    );
    entries.push(user, answer);
  }
  const world = createFakeWorld({
    sessions: [
      {
        summary: {
          id: "rewrite",
          cwd: "/fixture",
          name: "Rewritable fixture",
          createdAt: "2026-09-01T00:00:00Z",
          modifiedAt: "2026-09-01T00:00:00Z",
          fileSize: 100,
        },
        entries,
      },
    ],
    reply: () => "Reply after rewrite",
    delayMs: 2,
  });
  const workspace = createWorkspace(world);
  await world.runtime.open({ sessionId: "rewrite" });
  const app = createWebApp({
    workspace,
    defaultCwd: "/fixture",
    staticRoot: "static",
    renderIntervalMs: 1,
  });
  return { app, workspace, world, id: "rewrite" };
}
