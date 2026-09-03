import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});
const { ExtensionUiBridge } = await jiti.import("./extension-ui-bridge.ts");

function createBridge() {
  const events = [];
  const bridge = new ExtensionUiBridge((event) => events.push(event));
  return { bridge, context: bridge.createUiContext(), events };
}

// Custom UI factories mount after two microtask hops.
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("dialog requests stay pending until the browser answers", async () => {
  const { bridge, context, events } = createBridge();

  const selected = context.select("Pick", ["a", "b"]);
  const request = events.at(-1);
  assert.equal(request.type, "extension_ui_request");
  assert.equal(request.method, "select");
  assert.deepEqual(request.options, ["a", "b"]);
  assert.deepEqual(bridge.pendingRequests(), [request]);

  bridge.resolveResponse({ type: "extension_ui_response", id: "unknown", cancelled: true });
  assert.deepEqual(bridge.pendingRequests(), [request]);
  bridge.resolveResponse({ type: "extension_ui_response", id: request.id, value: "b" });
  assert.equal(await selected, "b");
  assert.deepEqual(bridge.pendingRequests(), []);

  const confirmed = context.confirm("Sure?", "Really?");
  bridge.resolveResponse({ type: "extension_ui_response", id: events.at(-1).id, confirmed: true });
  assert.equal(await confirmed, true);
});

test("timeouts, aborts, and dispose settle dialogs with their defaults", async () => {
  const { bridge, context, events } = createBridge();

  const timedOut = context.confirm("Slow", "message", { timeout: 1 });
  assert.equal(events.at(-1).timeout, 1);
  assert.equal(typeof events.at(-1).expiresAt, "number");
  assert.equal(await timedOut, false);

  const controller = new AbortController();
  const aborted = context.input("Name", "placeholder", { signal: controller.signal });
  assert.equal(events.at(-1).placeholder, "placeholder");
  controller.abort();
  assert.equal(await aborted, undefined);

  const before = events.length;
  assert.equal(await context.editor("Edit", "draft", { signal: AbortSignal.abort() }), undefined);
  assert.equal(events.length, before);

  const late = context.select("Late", ["x"]);
  bridge.dispose();
  assert.equal(await late, undefined);
  assert.deepEqual(bridge.pendingRequests(), []);
});

test("custom UI renders, forwards input, and closes with the component value", async () => {
  const { bridge, context, events } = createBridge();
  const inputs = [];
  let finish;
  let disposed = 0;

  const result = context.custom((tui, theme, keybindings, done) => {
    finish = done;
    assert.equal(tui.terminal.columns, 92);
    assert.ok(theme);
    assert.ok(keybindings);
    return {
      render: (width) => [`${width}:${inputs.join("")}`],
      handleInput: (data) => inputs.push(data),
      dispose: () => { disposed += 1; },
    };
  });
  await tick();
  const opened = events.at(-1);
  assert.equal(opened.method, "custom");
  assert.deepEqual(opened.lines, ["92:"]);
  assert.deepEqual(bridge.pendingRequests(), [opened]);

  bridge.handleInput(opened.id, "ab");
  assert.equal(events.at(-1).id, opened.id);
  assert.deepEqual(events.at(-1).lines, ["92:ab"]);

  finish("chosen");
  assert.deepEqual(events.at(-1), { type: "extension_ui_request", id: opened.id, method: "custom", lines: [], closed: true });
  assert.equal(await result, "chosen");
  assert.equal(disposed, 1);
  assert.deepEqual(bridge.pendingRequests(), []);

  const count = events.length;
  bridge.handleInput(opened.id, "ignored");
  assert.equal(events.length, count);
});

test("custom UI failures close the component and report an extension_error", async () => {
  const { bridge, context, events } = createBridge();

  const failed = context.custom(() => {
    throw new Error("factory failed");
  });
  assert.equal(await failed, undefined);
  assert.equal(events.at(-1).type, "extension_error");
  assert.equal(events.at(-1).event, "custom_ui");
  assert.match(events.at(-1).error, /factory failed/);

  const input = context.custom(() => ({
    render: () => ["ready"],
    handleInput: () => {
      throw new Error("input failed");
    },
  }));
  await tick();
  bridge.handleInput(events.at(-1).id, "x");
  assert.equal(await input, undefined);
  assert.equal(events.at(-2).closed, true);
  assert.equal(events.at(-1).event, "custom_ui_input");
  assert.match(events.at(-1).error, /input failed/);
  assert.deepEqual(bridge.pendingRequests(), []);
});

test("statuses follow setStatus and clear on reload", () => {
  const { bridge, context, events } = createBridge();

  context.setStatus("git", "main");
  context.setStatus("other", "x");
  assert.deepEqual(bridge.statuses(), [{ key: "git", text: "main" }, { key: "other", text: "x" }]);
  assert.deepEqual(events.at(-1), {
    type: "extension_ui_request",
    id: events.at(-1).id,
    method: "setStatus",
    statusKey: "other",
    statusText: "x",
  });

  context.setStatus("other", undefined);
  assert.deepEqual(bridge.statuses(), [{ key: "git", text: "main" }]);
  bridge.resetForReload();
  assert.deepEqual(bridge.statuses(), []);
});
