import assert from "node:assert/strict";
import test from "node:test";

import {
  invalidateModelsCache,
  loadModelsWithCache,
  withModelRuntimeError,
  withSafeModelLoadFailure,
} from "./models-cache.ts";

function modelsData(id) {
  return {
    models: { [`provider:${id}`]: id },
    modelList: [{ id, name: id, provider: "provider" }],
    defaultModel: null,
    thinkingLevels: {},
    thinkingLevelMaps: {},
  };
}

test("caches model data independently for each cwd", async () => {
  invalidateModelsCache();
  let firstLoads = 0;
  let secondLoads = 0;

  const first = await loadModelsWithCache("/first", "stamp", async () => {
    firstLoads += 1;
    return modelsData("first");
  });
  await loadModelsWithCache("/second", "stamp", async () => {
    secondLoads += 1;
    return modelsData("second");
  });
  const firstAgain = await loadModelsWithCache("/first", "stamp", async () => {
    firstLoads += 1;
    return modelsData("replacement");
  });

  assert.deepEqual(firstAgain, first);
  assert.equal(firstLoads, 1);
  assert.equal(secondLoads, 1);
});

test("shares one loader between concurrent requests for the same cwd", async () => {
  invalidateModelsCache();
  let loads = 0;
  let finishLoad;
  const loader = () => {
    loads += 1;
    return new Promise((resolve) => { finishLoad = resolve; });
  };

  const first = loadModelsWithCache("/shared", "stamp", loader);
  const second = loadModelsWithCache("/shared", "stamp", loader);
  await Promise.resolve();

  assert.equal(loads, 1);
  finishLoad(modelsData("shared"));
  assert.deepEqual(await second, await first);
});

test("does not cache a stale load that finishes after invalidation", async () => {
  invalidateModelsCache();
  let finishOldLoad;
  const oldLoad = loadModelsWithCache("/stale", "stamp", () => new Promise((resolve) => { finishOldLoad = resolve; }));
  await Promise.resolve();

  invalidateModelsCache();
  let freshLoads = 0;
  const fresh = await loadModelsWithCache("/stale", "stamp", async () => {
    freshLoads += 1;
    return modelsData("fresh");
  });
  finishOldLoad(modelsData("stale"));
  await oldLoad;

  const cached = await loadModelsWithCache("/stale", "stamp", async () => {
    freshLoads += 1;
    return modelsData("unexpected");
  });
  assert.deepEqual(cached, fresh);
  assert.equal(freshLoads, 1);
});

test("retries after a model load fails", async () => {
  invalidateModelsCache();
  await assert.rejects(
    loadModelsWithCache("/failed", "stamp", async () => { throw new Error("load failed"); }),
    /load failed/,
  );

  let retries = 0;
  const fresh = await loadModelsWithCache("/failed", "stamp", async () => {
    retries += 1;
    return modelsData("fresh");
  });
  assert.deepEqual(fresh, modelsData("fresh"));
  assert.equal(retries, 1);
});

test("adds runtime errors without discarding available models", () => {
  const data = modelsData("builtin");
  const result = withModelRuntimeError(data, "Invalid models.json schema");

  assert.deepEqual(result, {
    ...data,
    modelError: "Invalid models.json schema",
  });
});

test("uses a safe error for unexpected model load failures", () => {
  const data = {
    ...modelsData("builtin"),
    modelError: "Failed to load /Users/example/.pi/agent/models.json with token secret",
  };
  const result = withSafeModelLoadFailure(data);

  assert.deepEqual(result, {
    ...data,
    modelError: "Model list is temporarily unavailable. Check your configuration and try again.",
  });
});

test("re-reads when the agent configuration changed under a live entry", async () => {
  invalidateModelsCache();

  const first = await loadModelsWithCache("/cwd", "stamp-1", async () => modelsData("before"));
  assert.equal(first.modelList[0].id, "before");

  // Same cwd, still inside the TTL, but a terminal login moved the stamp.
  const afterLogin = await loadModelsWithCache("/cwd", "stamp-2", async () => modelsData("after"));
  assert.equal(afterLogin.modelList[0].id, "after");

  const cached = await loadModelsWithCache("/cwd", "stamp-2", async () => {
    throw new Error("should have been served from cache");
  });
  assert.equal(cached.modelList[0].id, "after");
});
