import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Agent } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import {
  AgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { AgentSessionWrapper, getRpcSession } =
  await jiti.import("./rpc-manager.ts");
const { cacheSessionPath, invalidateSessionPathCache } = await jiti.import(
  "./session-reader.ts",
);
const { GET, PATCH } = await jiti.import("../app/api/sessions/[id]/route.ts");

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "pi-web-session-name-"));
  const agentDir = join(root, "agent");
  await mkdir(agentDir);
  const manager = SessionManager.create(root, join(root, "sessions"));
  manager.appendMessage({
    role: "user",
    content: "Question",
    timestamp: Date.now(),
  });
  manager.appendMessage(fauxAssistantMessage("Answer"));
  manager.appendSessionInfo("Original");
  const id = manager.getSessionId();
  const file = manager.getSessionFile();
  cacheSessionPath(id, file);
  const previousRegistry = globalThis.__piSessions;
  const previousLocks = globalThis.__piStartLocks;
  const previousLifecycles = globalThis.__piSessionLifecycles;
  globalThis.__piSessions = new Map();
  globalThis.__piStartLocks = new Map();
  globalThis.__piSessionLifecycles = new Map();
  let wrapper;
  t.after(async () => {
    await wrapper?.shutdown();
    globalThis.__piSessions = previousRegistry;
    globalThis.__piStartLocks = previousLocks;
    globalThis.__piSessionLifecycles = previousLifecycles;
    invalidateSessionPathCache(id);
    await rm(root, { recursive: true, force: true });
  });
  async function activate({ beforeTree } = {}) {
    const extensionEvents = [];
    const resourceLoader = new DefaultResourceLoader({
      cwd: root,
      agentDir,
      noSkills: true,
      noExtensions: true,
      extensionFactories: [
        (pi) => {
          pi.on("session_info_changed", (event) => {
            extensionEvents.push(event);
          });
          if (beforeTree) pi.on("session_before_tree", beforeTree);
        },
      ],
    });
    await resourceLoader.reload();
    const inner = new AgentSession({
      agent: new Agent(),
      sessionManager: manager,
      settingsManager: SettingsManager.inMemory(),
      cwd: root,
      resourceLoader,
      modelRuntime: {},
      initialActiveToolNames: [],
      extensionRunnerRef: {},
    });
    wrapper = new AgentSessionWrapper(inner);
    wrapper.start();
    await wrapper.waitUntilReady();
    globalThis.__piSessions.set(id, wrapper);
    const events = [];
    wrapper.onEvent((event) => events.push(event));
    return { wrapper, events, extensionEvents };
  }
  const params = { params: Promise.resolve({ id }) };
  return {
    id,
    file,
    manager,
    activate,
    rename: (name) =>
      PATCH(
        new Request(`http://localhost/api/sessions/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ name }),
        }),
        params,
      ),
    read: async () =>
      (
        await GET(new Request(`http://localhost/api/sessions/${id}`), params)
      ).json(),
  };
}

test("sidebar rename updates live detail, stats, persistence, and session-info notifications", async (t) => {
  const f = await fixture(t);
  const { wrapper, events, extensionEvents } = await f.activate();
  assert.equal((await f.rename("  Renamed  ")).status, 200);
  assert.equal((await f.read()).info.name, "Renamed");
  assert.equal(
    (await wrapper.send({ type: "get_session_stats" })).sessionName,
    "Renamed",
  );
  assert.equal(SessionManager.open(f.file).getSessionName(), "Renamed");
  assert.deepEqual(
    events.filter((event) => event.type === "session_info_changed"),
    [{ type: "session_info_changed", name: "Renamed" }],
  );
  assert.deepEqual(extensionEvents, [
    { type: "session_info_changed", name: "Renamed" },
  ]);
});

test("sidebar can clear a live name while /name still rejects empty input", async (t) => {
  const f = await fixture(t);
  const { wrapper, events } = await f.activate();
  await wrapper.send({ type: "set_session_name", name: "  Command name  " });
  assert.equal((await f.read()).info.name, "Command name");
  await assert.rejects(
    wrapper.send({ type: "set_session_name", name: "   " }),
    /Session name cannot be empty/,
  );
  assert.equal((await f.read()).info.name, "Command name");
  assert.equal((await f.rename("   ")).status, 200);
  assert.equal((await f.read()).info.name, undefined);
  assert.equal(
    (await wrapper.send({ type: "get_session_stats" })).sessionName,
    undefined,
  );
  assert.equal(SessionManager.open(f.file).getSessionName(), undefined);
  assert.deepEqual(
    events.filter((event) => event.type === "session_info_changed"),
    [
      { type: "session_info_changed", name: "Command name" },
      { type: "session_info_changed", name: undefined },
    ],
  );
});

test("renaming and clearing a stopped session persist without activating it", async (t) => {
  const f = await fixture(t);
  const messages = f.manager.buildSessionContext().messages;
  for (const [name, expected] of [
    ["  Stopped name  ", "Stopped name"],
    ["  ", undefined],
  ]) {
    assert.equal((await f.rename(name)).status, 200);
    assert.equal((await f.read()).info.name, expected);
    const reopened = SessionManager.open(f.file);
    assert.equal(reopened.getSessionName(), expected);
    assert.deepEqual(reopened.buildSessionContext().messages, messages);
    assert.equal(getRpcSession(f.id), undefined);
    assert.equal(globalThis.__piStartLocks.size, 0);
  }
});

test("rename waits for an in-flight startup and updates its already-open manager", async (t) => {
  const f = await fixture(t);
  // startRpcSession opens the manager before awaiting services, publishes the
  // wrapper, then removes this lock. Hold that boundary without constructing services.
  const { promise, resolve } = Promise.withResolvers();
  globalThis.__piStartLocks.set(f.id, promise);
  let finished = false;
  const renaming = f.rename("During startup").then((response) => {
    finished = true;
    return response;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, false);
  assert.equal(SessionManager.open(f.file).getSessionName(), "Original");
  const { wrapper, events } = await f.activate();
  globalThis.__piStartLocks.delete(f.id);
  resolve({ session: wrapper, realSessionId: f.id });
  assert.equal((await renaming).status, 200);
  assert.equal((await f.read()).info.name, "During startup");
  assert.equal(SessionManager.open(f.file).getSessionName(), "During startup");
  assert.ok(
    events.some(
      (event) =>
        event.type === "session_info_changed" &&
        event.name === "During startup",
    ),
  );
});

test("rename rejects an overlapping history replacement instead of writing behind its manager", async (t) => {
  const f = await fixture(t);
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const { wrapper } = await f.activate({
    beforeTree: async () => {
      entered.resolve();
      await release.promise;
      return { cancel: true };
    },
  });
  const entryId = f.manager
    .getEntries()
    .find(
      (entry) => entry.type === "message" && entry.message.role === "user",
    ).id;
  const branching = wrapper.send({ type: "branch_from_message", entryId });
  await entered.promise;
  try {
    const response = await f.rename("Must not write");
    assert.equal(response.status, 500);
    assert.match(
      (await response.json()).error,
      /Session history is being changed/,
    );
    assert.equal(SessionManager.open(f.file).getSessionName(), "Original");
  } finally {
    release.resolve();
    await branching;
  }
  assert.equal((await f.rename("After replacement")).status, 200);
  assert.equal((await f.read()).info.name, "After replacement");
});
