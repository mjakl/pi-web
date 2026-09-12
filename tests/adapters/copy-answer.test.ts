import { createFakeWorld } from "@adapters/fake/index";
import { createWorkspace } from "@core/workspace";
import { createWebApp } from "@web/app";
import { afterEach, expect, it } from "vitest";
import { RAW_ANSWER } from "#/web/fixtures/copy-answer";
import {
  createHarness,
  gate,
  type Harness,
  next,
  reply,
} from "./pi-harness.ts";

let h: Harness | undefined;
afterEach(async () => {
  await h?.dispose();
});

it("copies the SDK's completed active branch, excludes partials, and survives runtime disposal", async () => {
  h = await createHarness();
  const world = createFakeWorld();
  const workspace = createWorkspace({
    ...world,
    runtime: h.runtime,
    sessions: h.catalog,
  });
  const app = createWebApp({
    workspace,
    defaultCwd: h.cwd,
    staticRoot: "static",
  });
  const session = await h.open();
  const lookup = async () =>
    (await app.request(`/sessions/${session.id}/last-assistant-text`)).text();
  expect(await lookup()).toBe("");
  h.script(reply(RAW_ANSWER));
  let done = next(session, "turn_done");
  await session.prompt("offline first question");
  await done;
  expect(await lookup()).toBe(RAW_ANSWER);
  const persisted = await h.catalog.read(session.id);
  expect(
    persisted?.branch.some(
      (entry) =>
        entry.type === "message" &&
        entry.message.role === "assistant" &&
        entry.message.content.some(
          (part) => part.type === "text" && part.text === RAW_ANSWER,
        ),
    ),
  ).toBe(true);

  const finish = gate();
  h.script(async (turn) => {
    turn.text("  next **answer**\n");
    await finish.wait;
    turn.done();
  });
  done = next(session, "turn_done");
  await session.prompt("offline second question");
  await expect
    .poll(() => session.snapshot().partial?.content)
    .toEqual([{ type: "text", text: "  next **answer**\n" }]);
  expect(await lookup()).toBe(RAW_ANSWER);
  finish.open();
  await done;
  expect(await lookup()).toBe("  next **answer**\n");
  await session.stop();
  expect(h.runtime.get(session.id)).toBeUndefined();
  expect(await lookup()).toBe("  next **answer**\n");
  expect(h.calls).toHaveLength(2);
});
