import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});
const {
  AgentSessionWrapper,
  beginRpcSessionOperation,
  sendRpcSessionCommand,
  setRpcSessionTools,
  startRpcSession,
  stopRpcSession,
} = await jiti.import("./rpc-manager.ts");

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

function makePromptInner(prompt) {
  return {
    sessionId: "session-1",
    isBashRunning: false,
    isStreaming: false,
    bindExtensions: async () => {},
    extensionRunner: { emit: async () => {} },
    sessionManager: { getCwd: () => "/tmp", getSessionFile: () => undefined },
    agent: { state: {} },
    getContextUsage: () => null,
    getSteeringMessages: () => [],
    getFollowUpMessages: () => [],
    prompt,
    abort: async () => {},
    dispose() {},
  };
}

test("get_state waits for extension resources before returning the system prompt", async (t) => {
  let finishBinding;
  const inner = makePromptInner(() => Promise.resolve());
  inner.agent.state.systemPrompt = "before extensions";
  inner.bindExtensions = () => new Promise((resolve) => {
    finishBinding = () => {
      inner.agent.state.systemPrompt = "after extensions";
      resolve();
    };
  });

  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => wrapper.destroy());
  wrapper.beginExtensionBinding();

  let settled = false;
  const statePromise = wrapper.send({ type: "get_state" }).then((state) => {
    settled = true;
    return state;
  });
  await nextTurn();

  assert.equal(settled, false);
  finishBinding();
  const state = await statePromise;

  assert.equal(state.systemPrompt, "after extensions");
});

test("prompt commands wait for SDK preflight acceptance before acknowledging", async (t) => {
  let acceptPreflight;
  let finishPrompt;
  const inner = makePromptInner((_message, options) => new Promise((resolve) => {
    acceptPreflight = () => options.preflightResult(true);
    finishPrompt = resolve;
  }));
  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => wrapper.destroy());
  const events = [];
  wrapper.onEvent((event) => events.push(event));

  let acknowledged = false;
  const sending = wrapper.send({ type: "prompt", message: "hello" }).then(() => {
    acknowledged = true;
  });
  await nextTurn();

  assert.equal(acknowledged, false);
  assert.equal(wrapper.isRunning(), true);

  acceptPreflight();
  await sending;

  assert.equal(acknowledged, true);
  assert.equal(wrapper.isRunning(), true);
  assert.equal(events.some((event) => event.type === "prompt_done"), false);

  finishPrompt();
  await nextTurn();

  assert.equal(wrapper.isRunning(), false);
  assert.equal(events.filter((event) => event.type === "prompt_done").length, 1);
});

test("completion notification waits for an accepted agent run to become idle", async (t) => {
  let finishPrompt;
  let sdkListener;
  const completed = [];
  const inner = makePromptInner((_message, options) => new Promise((resolve) => {
    inner.isStreaming = true;
    options.preflightResult(true);
    finishPrompt = () => {
      inner.isStreaming = false;
      resolve();
    };
  }));
  inner.subscribe = (listener) => {
    sdkListener = listener;
    return () => {};
  };

  const wrapper = new AgentSessionWrapper(inner, {
    onAgentRunComplete: (sessionId) => completed.push(sessionId),
  });
  t.after(() => wrapper.destroy());
  wrapper.start();

  await wrapper.send({ type: "prompt", message: "hello" });
  sdkListener({ type: "agent_start" });
  sdkListener({ type: "agent_end" });
  sdkListener({ type: "agent_end" });
  inner.isStreaming = false;
  sdkListener({ type: "agent_settled" });
  assert.deepEqual(completed, []);

  finishPrompt();
  await nextTurn();
  assert.deepEqual(completed, ["session-1"]);

  sdkListener({ type: "agent_settled" });
  assert.deepEqual(completed, ["session-1"]);
});

test("completion notification covers extension-injected runs without an SSE client", (t) => {
  let sdkListener;
  const completed = [];
  const inner = makePromptInner(() => Promise.resolve());
  inner.subscribe = (listener) => {
    sdkListener = listener;
    return () => {};
  };

  const wrapper = new AgentSessionWrapper(inner, {
    onAgentRunComplete: (sessionId) => completed.push(sessionId),
  });
  t.after(() => wrapper.destroy());
  wrapper.start();

  inner.isStreaming = true;
  sdkListener({ type: "agent_start" });
  sdkListener({ type: "agent_end" });
  assert.deepEqual(completed, []);

  inner.isStreaming = false;
  sdkListener({ type: "agent_settled" });
  assert.deepEqual(completed, ["session-1"]);
});

test("prompt commands reject when SDK preflight fails", async (t) => {
  const inner = makePromptInner((_message, options) => {
    options.preflightResult(false);
    return Promise.reject(new Error("Authentication failed"));
  });
  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => wrapper.destroy());
  const events = [];
  wrapper.onEvent((event) => events.push(event));

  await assert.rejects(
    wrapper.send({ type: "prompt", message: "hello" }),
    /Authentication failed/,
  );

  assert.equal(wrapper.isRunning(), false);
  assert.deepEqual(events, []);
});

test("accepted prompt failures still finish through the event stream", async (t) => {
  let failPrompt;
  const inner = makePromptInner((_message, options) => {
    options.preflightResult(true);
    return new Promise((_resolve, reject) => {
      failPrompt = () => reject(new Error("post-accept failure"));
    });
  });
  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => wrapper.destroy());
  const events = [];
  wrapper.onEvent((event) => events.push(event));

  await wrapper.send({ type: "prompt", message: "hello" });
  failPrompt();
  await nextTurn();

  assert.deepEqual(events.map((event) => event.type), ["prompt_error", "prompt_done"]);
});

test("queued prompt commands forward their streaming behavior and acknowledge acceptance", async (t) => {
  let receivedOptions;
  const inner = makePromptInner((_message, options) => {
    receivedOptions = options;
    options.preflightResult(true);
    return Promise.resolve();
  });
  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => wrapper.destroy());
  const events = [];
  wrapper.onEvent((event) => events.push(event));

  await wrapper.send({
    type: "prompt",
    message: "next",
    streamingBehavior: "followUp",
  });
  await nextTurn();

  assert.equal(receivedOptions.streamingBehavior, "followUp");
  assert.equal(receivedOptions.source, "rpc");
  assert.equal(wrapper.isRunning(), false);
  assert.deepEqual(events, []);
});

test("an exact system prompt is reapplied after SDK preflight resets it", async (t) => {
  const inner = makePromptInner((_message, options) => {
    inner.agent.state.systemPrompt = "SDK base prompt";
    options.preflightResult(true);
    assert.equal(inner.agent.state.systemPrompt, "context prompt");
    return Promise.resolve();
  });
  inner.agent.state.systemPrompt = "initial SDK prompt";
  const wrapper = new AgentSessionWrapper(inner, {
    exactSystemPrompt: () => "context prompt",
    chatOnly: true,
  });
  t.after(() => wrapper.destroy());

  assert.equal(inner.agent.state.systemPrompt, "context prompt");
  await wrapper.send({ type: "prompt", message: "hello" });
  await nextTurn();

  const prepared = await inner.agent.prepareNextTurnWithContext({
    context: { systemPrompt: "SDK continuation prompt" },
  });
  assert.equal(prepared.context.systemPrompt, "context prompt");
});

test("prompt admission waits for the preceding preflight and keeps overlapping runs counted", async (t) => {
  let callCount = 0;
  let acceptFirst;
  let finishFirst;
  const inner = makePromptInner((_message, options) => {
    callCount += 1;
    if (callCount === 1) {
      return new Promise((resolve) => {
        acceptFirst = () => {
          inner.isStreaming = true;
          options.preflightResult(true);
        };
        finishFirst = () => {
          inner.isStreaming = false;
          resolve();
        };
      });
    }

    assert.equal(inner.isStreaming, true);
    options.preflightResult(true);
    return Promise.resolve();
  });
  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => wrapper.destroy());

  const first = wrapper.send({ type: "prompt", message: "first" });
  await nextTurn();
  const queued = wrapper.send({
    type: "prompt",
    message: "queued",
    streamingBehavior: "followUp",
  });
  await nextTurn();

  assert.equal(callCount, 1);
  acceptFirst();
  await Promise.all([first, queued]);
  await nextTurn();

  assert.equal(callCount, 2);
  assert.equal((await wrapper.send({ type: "get_state" })).isPromptRunning, true);

  finishFirst();
  await nextTurn();

  assert.equal((await wrapper.send({ type: "get_state" })).isPromptRunning, false);
});

test("prompt admission continues after the preceding preflight rejects", async (t) => {
  let callCount = 0;
  let rejectFirst;
  const inner = makePromptInner((_message, options) => {
    callCount += 1;
    if (callCount === 1) {
      return new Promise((_resolve, reject) => {
        rejectFirst = () => {
          options.preflightResult(false);
          reject(new Error("first rejected"));
        };
      });
    }
    options.preflightResult(true);
    return Promise.resolve();
  });
  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => wrapper.destroy());

  const firstRejected = assert.rejects(
    wrapper.send({ type: "prompt", message: "first" }),
    /first rejected/,
  );
  await nextTurn();
  const second = wrapper.send({ type: "prompt", message: "second" });
  await nextTurn();
  assert.equal(callCount, 1);

  rejectFirst();
  await Promise.all([firstRejected, second]);

  assert.equal(callCount, 2);
  assert.equal(wrapper.isRunning(), false);
});

test("a failing event listener cannot reject prompt completion", async (t) => {
  const originalConsoleError = console.error;
  t.after(() => {
    console.error = originalConsoleError;
  });
  console.error = () => {};

  const inner = makePromptInner((_message, options) => {
    options.preflightResult(true);
    return Promise.resolve();
  });
  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => wrapper.destroy());
  const delivered = [];
  wrapper.onEvent(() => {
    throw new Error("listener failed");
  });
  wrapper.onEvent((event) => delivered.push(event.type));

  await wrapper.send({ type: "prompt", message: "hello" });
  await nextTurn();

  assert.deepEqual(delivered, ["prompt_done"]);
  assert.equal(wrapper.isRunning(), false);
});

test("session shutdown notifies extensions before disposing the SDK session", async () => {
  const calls = [];
  const inner = {
    bindExtensions: async () => {},
    isBashRunning: false,
    extensionRunner: {
      async emit(event) {
        calls.push(["emit", event]);
      },
    },
    dispose() {
      calls.push(["dispose"]);
    },
  };
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.onDestroy(() => calls.push(["destroy"]));

  await Promise.all([wrapper.shutdown(), wrapper.shutdown()]);

  assert.deepEqual(calls, [
    ["emit", { type: "session_shutdown", reason: "quit" }],
    ["dispose"],
    ["destroy"],
  ]);
  assert.equal(wrapper.isAlive(), false);
});

test("session shutdown logs extension failure and still disposes the SDK session", async (t) => {
  t.mock.method(console, "error", () => {});
  const calls = [];
  const inner = {
    bindExtensions: async () => {},
    isBashRunning: false,
    extensionRunner: {
      async emit() {
        calls.push("emit");
        throw new Error("shutdown hook failed");
      },
    },
    dispose() {
      calls.push("dispose");
    },
  };
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.onDestroy(() => calls.push("destroy"));

  await wrapper.shutdown();

  assert.deepEqual(calls, ["emit", "dispose", "destroy"]);
  assert.equal(wrapper.isAlive(), false);
});

test("direct destruction emits session_shutdown before dispose when extensions are present", async () => {
  const calls = [];
  const inner = {
    bindExtensions: async () => {},
    isBashRunning: false,
    extensionRunner: {
      async emit(event) {
        calls.push(["emit", event]);
      },
    },
    dispose() {
      calls.push(["dispose"]);
    },
  };
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.onDestroy(() => calls.push(["destroy"]));

  wrapper.destroy();
  wrapper.destroy();

  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(calls, [
    ["emit", { type: "session_shutdown", reason: "quit" }],
    ["dispose"],
    ["destroy"],
  ]);
  assert.equal(wrapper.isAlive(), false);
});

test("direct destruction still disposes when session_shutdown throws synchronously", async (t) => {
  t.mock.method(console, "error", () => {});
  const calls = [];
  const inner = {
    bindExtensions: async () => {},
    isBashRunning: false,
    extensionRunner: {
      emit() {
        throw new Error("shutdown hook failed");
      },
    },
    dispose() {
      calls.push("dispose");
    },
  };
  const wrapper = new AgentSessionWrapper(inner);

  wrapper.destroy();
  await nextTurn();

  assert.deepEqual(calls, ["dispose"]);
  assert.equal(wrapper.isAlive(), false);
});

test("idle timer preserves active work but reaps a run stuck after Stop", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = [];
  let resolveAbort;
  const inner = makePromptInner(() => Promise.resolve());
  inner.isStreaming = true;
  inner.subscribe = () => () => {};
  inner.abort = () => {
    calls.push(["abort"]);
    return new Promise((resolve) => { resolveAbort = resolve; });
  };
  inner.extensionRunner = {
    async emit(event) {
      calls.push(["emit", event]);
    },
  };
  inner.dispose = () => calls.push(["dispose"]);
  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => wrapper.destroy());
  wrapper.start();

  t.mock.timers.tick(10 * 60 * 1000);
  await nextTurn();
  assert.equal(wrapper.isAlive(), true);
  assert.deepEqual(calls, []);

  const stopping = wrapper.send({ type: "abort" });
  await nextTurn();
  await wrapper.send({ type: "get_state" });
  t.mock.timers.tick(10 * 60 * 1000);
  await nextTurn();

  assert.equal(wrapper.isAlive(), false);
  assert.deepEqual(calls, [
    ["abort"],
    ["emit", { type: "session_shutdown", reason: "quit" }],
    ["dispose"],
  ]);

  inner.isStreaming = false;
  resolveAbort();
  await stopping;
});

test("persisted sessions are not reaped after the old idle deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sessionFile = new URL(import.meta.url).pathname;
  const inner = makePromptInner(() => Promise.resolve());
  inner.subscribe = () => () => {};
  inner.sessionManager.getSessionFile = () => sessionFile;
  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => wrapper.destroy());
  wrapper.start();

  t.mock.timers.tick(10 * 60 * 1000);
  await nextTurn();

  assert.equal(wrapper.isActive(), true);
});

test("manual stop is terminal and suppresses completion notification", async () => {
  let sdkListener;
  const completed = [];
  const events = [];
  const inner = makePromptInner(() => Promise.resolve());
  inner.subscribe = (listener) => {
    sdkListener = listener;
    return () => {};
  };
  inner.extensionRunner = { emit: async () => {} };
  const wrapper = new AgentSessionWrapper(inner, {
    onAgentRunComplete: (sessionId) => completed.push(sessionId),
  });
  wrapper.onEvent((event) => events.push(event.type));
  wrapper.start();

  inner.isStreaming = true;
  sdkListener({ type: "agent_start" });
  await wrapper.shutdown({ manual: true });
  inner.isStreaming = false;
  sdkListener({ type: "agent_settled" });

  assert.equal(wrapper.isActive(), false);
  assert.deepEqual(events.filter((type) => type === "session_stopped"), ["session_stopped"]);
  assert.deepEqual(completed, []);
});

test("manual stop cancels active work before extension cleanup", async () => {
  const calls = [];
  let finishCleanup;
  const inner = makePromptInner(() => Promise.resolve());
  inner.isBashRunning = true;
  inner.abortBash = () => {
    calls.push("abort_bash");
    inner.isBashRunning = false;
  };
  inner.extensionRunner = {
    emit: async () => {
      calls.push("session_shutdown");
      await new Promise((resolve) => { finishCleanup = resolve; });
    },
  };
  inner.dispose = () => calls.push("dispose");
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.onEvent((event) => calls.push(event.type));

  const stopping = wrapper.shutdown({ manual: true });
  await nextTurn();

  assert.deepEqual(calls, ["abort_bash", "session_stopped", "session_shutdown"]);
  finishCleanup();
  await stopping;
  assert.deepEqual(calls, ["abort_bash", "session_stopped", "session_shutdown", "dispose"]);
});

test("manual stop bounds extension cleanup to five seconds", async (t) => {
  t.mock.method(console, "error", () => {});
  const calls = [];
  const inner = {
    bindExtensions: async () => {},
    isBashRunning: false,
    bindExtensions: () => new Promise(() => {}),
    extensionRunner: { emit: () => calls.push("unexpected emit") },
    dispose: () => calls.push("dispose"),
  };
  const wrapper = new AgentSessionWrapper(inner);
  const stopping = wrapper.shutdown({ manual: true });

  await stopping;

  assert.deepEqual(calls, ["dispose"]);
  assert.equal(wrapper.isActive(), false);
});

test("Stop invalidates commands admitted before or during it", async (t) => {
  const previousRegistry = globalThis.__piSessions;
  const previousLifecycles = globalThis.__piSessionLifecycles;
  const id = "stop-invalidates-command";
  let finishShutdown;
  globalThis.__piSessionLifecycles = new Map();
  globalThis.__piSessions = new Map([[id, {
    isActive: () => true,
    isAlive: () => true,
    async shutdown() {
      await new Promise((resolve) => { finishShutdown = resolve; });
      globalThis.__piSessions.delete(id);
    },
    send: async () => "unexpected",
  }]]);
  const beforeStop = beginRpcSessionOperation(id);
  t.after(() => {
    globalThis.__piSessions = previousRegistry;
    globalThis.__piSessionLifecycles = previousLifecycles;
  });

  const stopping = stopRpcSession(id);
  await nextTurn();
  const duringStop = beginRpcSessionOperation(id);
  finishShutdown();
  assert.equal(await stopping, true);
  for (const operation of [beforeStop, duringStop]) {
    await assert.rejects(
      sendRpcSessionCommand(operation, "/tmp/persisted.jsonl", { type: "get_state" }),
      /Session was stopped/,
    );
  }
});

test("Stop shuts down a replacement returned by an aliased startup", async (t) => {
  const previousRegistry = globalThis.__piSessions;
  const previousLocks = globalThis.__piStartLocks;
  const previousLifecycles = globalThis.__piSessionLifecycles;
  const sourceId = "aliased-startup-source";
  const replacementId = "aliased-startup-replacement";
  let alive = true;
  let manual = false;
  const replacement = {
    sessionId: replacementId,
    isAlive: () => alive,
    async shutdown(options) {
      manual = options?.manual === true;
      alive = false;
      globalThis.__piSessions.delete(replacementId);
    },
  };
  globalThis.__piSessions = new Map([[replacementId, replacement]]);
  globalThis.__piStartLocks = new Map([[sourceId, Promise.resolve({
    session: replacement,
    realSessionId: replacementId,
  })]]);
  globalThis.__piSessionLifecycles = new Map();
  t.after(() => {
    globalThis.__piSessions = previousRegistry;
    globalThis.__piStartLocks = previousLocks;
    globalThis.__piSessionLifecycles = previousLifecycles;
  });

  assert.equal(await stopRpcSession(sourceId), true);
  assert.equal(alive, false);
  assert.equal(manual, true);
});

test("startup rejects an alive wrapper that is already stopping", async (t) => {
  const previousRegistry = globalThis.__piSessions;
  const id = "stopping-wrapper";
  globalThis.__piSessions = new Map([[id, {
    sessionId: id,
    isAlive: () => true,
    isActive: () => false,
  }]]);
  t.after(() => { globalThis.__piSessions = previousRegistry; });

  await assert.rejects(
    startRpcSession(id, "/path/must/not/be/opened.jsonl", undefined),
    /Session is stopping/,
  );
});

test("tool-policy rebuilds serialize under the source lifecycle", async (t) => {
  const previousRegistry = globalThis.__piSessions;
  const previousLifecycles = globalThis.__piSessionLifecycles;
  const id = "serialized-tool-rebuild";
  const appendedSelections = [];
  let alive = true;
  let shutdownCalls = 0;
  let finishShutdown;
  let shutdownPromise;
  const wrapper = {
    sessionId: id,
    sessionFile: "",
    cwd: "/tmp",
    inner: {
      sessionManager: {
        appendCustomEntry(_type, data) { appendedSelections.push(data.tools); },
      },
      model: undefined,
      agent: { state: {} },
    },
    isAlive: () => alive,
    isActive: () => alive && !shutdownPromise,
    isRunning: () => false,
    isChatOnly: () => false,
    setActiveToolSelection() {},
    shutdown() {
      shutdownCalls += 1;
      if (!shutdownPromise) {
        shutdownPromise = new Promise((resolve) => { finishShutdown = resolve; }).then(() => {
          alive = false;
          globalThis.__piSessions.delete(id);
        });
      }
      return shutdownPromise;
    },
  };
  globalThis.__piSessionLifecycles = new Map();
  globalThis.__piSessions = new Map([[id, wrapper]]);
  t.after(() => {
    globalThis.__piSessions = previousRegistry;
    globalThis.__piSessionLifecycles = previousLifecycles;
  });

  const first = setRpcSessionTools(beginRpcSessionOperation(id), undefined, []);
  await nextTurn();
  const second = setRpcSessionTools(beginRpcSessionOperation(id), undefined, []);
  await nextTurn();

  assert.deepEqual(appendedSelections, [[]]);
  assert.equal(shutdownCalls, 1);

  const stopping = stopRpcSession(id);
  finishShutdown();
  const [firstResult, secondResult, stopResult] = await Promise.allSettled([first, second, stopping]);

  assert.equal(firstResult.status, "rejected");
  assert.equal(secondResult.status, "rejected");
  assert.deepEqual(stopResult, { status: "fulfilled", value: true });
  assert.deepEqual(appendedSelections, [[]]);
});

test("direct bash commands use sanitized project operations with current shell settings", async (t) => {
  let received;
  let shellPath = "/bin/bash";
  const inner = {
    bindExtensions: async () => {},
    isBashRunning: false,
    isStreaming: false,
    isCompacting: false,
    extensionRunner: { emit: async () => {} },
    settingsManager: {
      getShellPath: () => shellPath,
    },
    sessionManager: {
      getCwd: () => process.cwd(),
      getSessionFile: () => undefined,
    },
    agent: { state: {} },
    getContextUsage: () => null,
    getSteeringMessages: () => [],
    getFollowUpMessages: () => [],
    executeBash: async (command, _onChunk, options) => {
      received = { command, options };
      return { output: "", exitCode: 0 };
    },
    dispose() {},
  };
  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => wrapper.destroy());

  shellPath = "/custom/bash";
  await wrapper.send({
    type: "bash",
    command: "echo ready",
    excludeFromContext: true,
  });

  assert.equal(received.command, "echo ready");
  assert.equal(received.options.excludeFromContext, true);
  assert.equal(typeof received.options.operations.exec, "function");
});
