import {
  assistantEntry,
  createFakeWorld,
  userEntry,
} from "@adapters/fake/index";
import type { LiveEvent, LiveSnapshot } from "@core/ports";
import { createWorkspace } from "@core/workspace";
import { createWebApp } from "@web/app";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

/** Manually advanced snapshots, real workspace projections and HTTP routes. */
export async function streamingFixture() {
  const world = createFakeWorld();
  const workspace = createWorkspace(world);
  const id = await workspace.createSession("/fixture");
  const live = world.runtime.get(id);
  if (!live) throw new Error("Missing fixture runtime");
  let snapshot = live.snapshot();
  let snapshotReads = 0;
  const listeners = new Set<(event: LiveEvent) => void>();
  live.snapshot = () => {
    snapshotReads += 1;
    return snapshot;
  };
  live.subscribe = (listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const app = createWebApp({
    workspace,
    defaultCwd: "/fixture",
    staticRoot: "static",
    renderIntervalMs: 1,
  });
  const emit = (type: LiveEvent["type"] = "activity") => {
    for (const listener of listeners) listener({ type });
  };
  const update = (change: Partial<LiveSnapshot>, event?: LiveEvent["type"]) => {
    snapshot = { ...snapshot, ...change };
    if (event) emit(event);
  };
  let sequence = 0;
  const finish = (text: string, notify = true) => {
    sequence += 1;
    const user = userEntry(
      `u${String(sequence)}`,
      snapshot.branch.at(-1)?.id ?? null,
      `question ${String(sequence)}`,
    );
    const answer = assistantEntry(`a${String(sequence)}`, user.id, text, 100);
    const branch = [...snapshot.branch, user, answer];
    update({
      branch,
      entries: branch,
      turnStart: branch.length,
      partial: undefined,
      status: { ...snapshot.status, running: false, tools: [] },
    });
    if (notify) emit("turn_done");
  };
  const runningTools = () => {
    const user = userEntry(
      "running-user",
      snapshot.branch.at(-1)?.id ?? null,
      "run tools",
    );
    const assistant = assistantEntry("tools", user.id, "", 100);
    if (assistant.type !== "message" || assistant.message.role !== "assistant")
      throw new Error("Invalid assistant fixture");
    assistant.message.content = [
      {
        type: "toolCall",
        id: "call-complete",
        name: "read",
        arguments: { path: "large.txt" },
      },
      {
        type: "toolCall",
        id: "call-changing",
        name: "read",
        arguments: { path: "next.txt" },
      },
    ];
    const result: SessionEntry = {
      type: "message",
      id: "tool-result",
      parentId: assistant.id,
      timestamp: new Date().toISOString(),
      message: {
        role: "toolResult",
        toolCallId: "call-complete",
        toolName: "read",
        content: [{ type: "text", text: "selectable output\n".repeat(2000) }],
        isError: false,
        timestamp: Date.now(),
      },
    };
    const branch = [...snapshot.branch, user, assistant, result];
    const partial = assistantEntry("unused", result.id, "streaming text", 100);
    if (partial.type !== "message" || partial.message.role !== "assistant")
      throw new Error("Invalid partial fixture");
    update({
      branch,
      entries: branch,
      partial: partial.message,
      status: {
        ...snapshot.status,
        running: true,
        tools: [{ id: "call-changing", name: "read" }],
      },
    });
  };
  return {
    app,
    world,
    workspace,
    id,
    live,
    emit,
    update,
    finish,
    runningTools,
    resetSnapshotReads() {
      snapshotReads = 0;
    },
    get snapshot() {
      return snapshot;
    },
    get snapshotReads() {
      return snapshotReads;
    },
    get subscribers() {
      return listeners.size;
    },
  };
}
