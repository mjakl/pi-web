import assert from "node:assert/strict";
import test, { after } from "node:test";
import { Window } from "happy-dom";
import { createJiti } from "jiti";

process.env.NODE_ENV = "test";
const window = new Window({ url: "http://localhost", width: 390, height: 844 });
Object.assign(globalThis, {
  window,
  document: window.document,
  HTMLElement: window.HTMLElement,
  Event: window.Event,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  IS_REACT_ACT_ENVIRONMENT: true,
});
const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { createRoot } = await jiti.import("react-dom/client");
const { ChatInput } = await jiti.import("./ChatInput.tsx");
const { CompactButton } = await jiti.import("./CompactButton.tsx");
after(() => window.happyDOM.close());

async function withComposer(props, check) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = async (overrides = {}) =>
    React.act(() =>
      root.render(React.createElement(ChatInput, { ...props, ...overrides })),
    );
  try {
    await render();
    const input = container.querySelector("textarea");
    const type = async (text) =>
      React.act(() => {
        Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          "value",
        ).set.call(input, text);
        input.dispatchEvent(new window.Event("input", { bubbles: true }));
      });
    const key = async (
      name,
      { altGraph = false, ...options } = {},
      eventType = "keydown",
    ) =>
      React.act(() => {
        const event = new window.KeyboardEvent(eventType, {
          key: name,
          bubbles: true,
          cancelable: true,
          ...options,
        });
        // Happy DOM aliases AltGraph to Alt; browsers distinguish them.
        const getModifierState = event.getModifierState.bind(event);
        event.getModifierState = (modifier) =>
          modifier === "AltGraph" ? altGraph : getModifierState(modifier);
        input.dispatchEvent(event);
      });
    await check({
      container,
      input,
      type,
      key,
      render,
      action: () => container.querySelector(".composer-action-primary"),
    });
  } finally {
    await React.act(() => root.unmount());
    container.remove();
  }
}

for (const overlap of [
  "recall",
  "attachment before response",
  "attachment after response",
]) {
  test(`recall retains all images across delayed ${overlap}`, async (t) => {
    const { useAgentSession } = await jiti.import(
      "../hooks/useAgentSession.ts",
    );
    const { getDraft, clearDraft } = await jiti.import("../lib/draft-store.ts");
    const requests = [];
    t.mock.method(globalThis, "fetch", async (_url, options) => {
      if (options?.method !== "POST")
        return new Response(null, { status: 404 });
      const response = Promise.withResolvers();
      requests.push({ ...response, command: JSON.parse(options.body) });
      return response.promise;
    });
    const readers = [];
    const originalReader = globalThis.FileReader;
    globalThis.FileReader = class {
      readAsDataURL() {
        readers.push(this);
      }
    };
    t.mock.method(URL, "createObjectURL", () => "blob:attachment");
    t.mock.method(URL, "revokeObjectURL", () => {});
    const id = `recall-${overlap}`;
    const inputRef = React.createRef();
    const errors = [];
    const sent = [];
    let agent;
    function Harness() {
      agent = useAgentSession({
        session: { id },
        newSessionCwd: null,
        newSessionDraftKey: null,
        chatInputRef: inputRef,
      });
      return React.createElement(ChatInput, {
        ref: inputRef,
        draftKey: id,
        isStreaming: false,
        onAbort: () => {},
        onSend: (...args) => sent.push(args),
        onError: (error) => errors.push(error),
      });
    }
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    t.after(async () => {
      await React.act(() => root.unmount());
      container.remove();
      clearDraft(id);
      globalThis.FileReader = originalReader;
    });
    await React.act(() => root.render(React.createElement(Harness)));
    const images = Array.from({ length: 10 }, () => ({
      data: "aGVsbG8=",
      mimeType: "image/png",
    }));
    const response = () =>
      Response.json({
        success: true,
        data: {
          followUp: ["recalled"],
          images,
          queuedMessages: { steering: [], followUp: [] },
        },
      });
    let first, second;
    await React.act(() => {
      first = agent.handleRecallQueue();
    });
    assert.equal(requests[0].command.imageCapacity, 10);
    if (overlap === "recall") {
      await React.act(() => {
        second = agent.handleRecallQueue();
      });
      assert.equal(requests[1].command.imageCapacity, 10);
    } else {
      await React.act(() =>
        inputRef.current.addImages(
          Array.from(
            { length: 10 },
            () =>
              new window.File(["image"], "image.png", { type: "image/png" }),
          ),
        ),
      );
      assert.equal(readers.length, 10);
      assert.equal(inputRef.current.getImageCapacity(), 0);
    }
    const finishAttachments = () =>
      React.act(async () => {
        for (const reader of readers) {
          reader.result = "data:image/png;base64,aGVsbG8=";
          reader.onload();
        }
      });
    if (overlap === "attachment before response") await finishAttachments();
    await React.act(async () => {
      requests[0].resolve(response());
      await first;
    });
    if (overlap === "recall")
      await React.act(async () => {
        requests[1].resolve(response());
        await second;
      });
    if (overlap === "attachment after response") await finishAttachments();
    assert.equal(container.querySelectorAll("img").length, 20);
    assert.equal(getDraft(id).images.length, 20);
    await React.act(() =>
      container.querySelector(".composer-action-primary").click(),
    );
    assert.equal(sent.length, 0);
    assert.deepEqual(errors, [
      "Send at most 10 images at a time. Remove some attachments before sending.",
    ]);
    assert.equal(getDraft(id).images.length, 20);
    await React.act(() => root.render(null));
    await React.act(() => root.render(React.createElement(Harness)));
    assert.equal(container.querySelectorAll("img").length, 20);
    for (let index = 0; index < 10; index++) {
      await React.act(() =>
        container.querySelector('[aria-label="Remove image"]').click(),
      );
    }
    await React.act(() =>
      container.querySelector(".composer-action-primary").click(),
    );
    assert.equal(sent.length, 1);
    assert.equal(sent[0][1].length, 10);
  });
}

test("queue recall reports the remaining composer attachment capacity", async () => {
  const ref = React.createRef();
  await withComposer({ ref, onSend: () => {} }, async () => {
    assert.equal(ref.current.getImageCapacity(), 10);
    await React.act(() =>
      ref.current.restoreSubmission("recalled", [
        { data: "aGVsbG8=", mimeType: "image/png" },
      ]),
    );
    assert.equal(ref.current.getImageCapacity(), 9);
  });
});

test("the action switches between Send, Stop, Steer, and transient keyboard Queue", async () => {
  const sent = [],
    steered = [],
    queued = [];
  let aborts = 0;
  await withComposer(
    {
      isStreaming: false,
      onSend: (text) => sent.push(text),
      onSteer: (text) => steered.push(text),
      onFollowUp: (text) => queued.push(text),
      onAbort: () => aborts++,
    },
    async ({ action, type, key, render, input, container }) => {
      assert.equal(action().getAttribute("aria-label"), "Send");
      assert.equal(action().disabled, true);
      await type("First prompt");
      await React.act(async () => action().click());
      assert.deepEqual(sent, ["First prompt"]);
      assert.equal(input.value, "");
      await render({ isStreaming: true });
      assert.equal(action().getAttribute("aria-label"), "Stop agent");
      await type("Next prompt");
      assert.equal(action().getAttribute("aria-label"), "Steer");
      await key("Alt", { altKey: true });
      assert.equal(action().getAttribute("aria-label"), "Queue");
      await key("Alt", {}, "keyup");
      assert.equal(action().getAttribute("aria-label"), "Steer");
      await key("AltGraph", { altKey: true, ctrlKey: true, altGraph: true });
      assert.equal(action().getAttribute("aria-label"), "Steer");
      // Alt+Enter works with a hardware keyboard even at the mobile width.
      await key("Enter", { altKey: true });
      assert.deepEqual(queued, ["Next prompt"]);
      assert.equal(input.value, "");
      assert.equal(action().getAttribute("aria-label"), "Stop agent");
      await type("Keep this draft");
      await key("Alt", { altKey: true });
      await React.act(() => window.dispatchEvent(new window.Event("blur")));
      assert.equal(action().getAttribute("aria-label"), "Steer");
      await React.act(() =>
        container.querySelector(".menu-composer-controls button").click(),
      );
      assert.equal(aborts, 1);
      assert.equal(input.value, "Keep this draft");
      await render({ isStreaming: false });
      assert.equal(action().getAttribute("aria-label"), "Send");
      assert.deepEqual(steered, []);
    },
  );
});

test("touch steers, composition and Shift+Enter do not submit, and non-steerable work remains stoppable", async () => {
  const steered = [],
    queued = [];
  let aborts = 0;
  await withComposer(
    {
      isStreaming: true,
      onSend() {
        assert.fail("busy");
      },
      onSteer: (text) => steered.push(text),
      onFollowUp: (text) => queued.push(text),
      onAbort: () => aborts++,
    },
    async ({ action, type, key, render, input }) => {
      await type("Draft");
      await key("Enter", { shiftKey: true });
      await key("Enter", { isComposing: true, altKey: true });
      await key("Enter"); // Touch keyboard Enter remains a newline.
      assert.equal(input.value, "Draft");
      assert.deepEqual(steered, []);
      assert.deepEqual(queued, []);
      await key("Alt", { altKey: true });
      await React.act(() => {
        action().dispatchEvent(
          new window.PointerEvent("pointerdown", {
            pointerType: "touch",
            bubbles: true,
          }),
        );
      });
      assert.equal(action().getAttribute("aria-label"), "Steer");
      await React.act(() =>
        action().dispatchEvent(
          new window.MouseEvent("click", { bubbles: true, altKey: true }),
        ),
      );
      assert.deepEqual(steered, ["Draft"]);
      assert.deepEqual(queued, []);
      await type("Draft during shell command");
      await render({ onSteer: undefined, onFollowUp: undefined });
      await key("Enter", { altKey: true });
      assert.equal(input.value, "Draft during shell command");
      assert.equal(action().getAttribute("aria-label"), "Stop agent");
      await React.act(() => action().click());
      assert.equal(aborts, 1);
      assert.equal(input.value, "Draft during shell command");
    },
  );
});

test("clicking composer background focuses the editor without moving its selection", async () => {
  await withComposer(
    { isStreaming: false, onSend() {}, onAbort() {} },
    async ({ container, input, type }) => {
      await type("Keep editing this draft");
      input.setSelectionRange(5, 12);
      for (const selector of [".composer-surface", ".composer-toolbar"]) {
        input.blur();
        await React.act(() => container.querySelector(selector).click());
        assert.ok(
          document.activeElement === input,
          `${selector} should focus the editor`,
        );
        assert.equal(input.selectionStart, 5);
        assert.equal(input.selectionEnd, 12);
      }
    },
  );
});

test("clicking a composer control icon does not redirect focus to the editor", async () => {
  await withComposer(
    { isStreaming: false, onSend() {}, onAbort() {} },
    async ({ container }) => {
      const attach = container.querySelector(".composer-attach");
      const fileInput = container.querySelector('input[type="file"]');
      let pickerOpened = false;
      fileInput.addEventListener("click", () => {
        pickerOpened = true;
      });
      attach.focus();
      await React.act(() =>
        attach
          .querySelector("path")
          .dispatchEvent(new window.MouseEvent("click", { bubbles: true })),
      );
      assert.equal(pickerOpened, true);
      assert.ok(
        document.activeElement === attach,
        "the attachment control should retain focus",
      );
    },
  );
});

test("pointer submission keeps keyboard focus in the editor", async () => {
  await withComposer(
    { isStreaming: true, onSend() {}, onSteer() {}, onAbort() {} },
    async ({ action, type, input }) => {
      await type("Steer this run");
      input.focus();
      const pointerFocus = new window.MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
      });
      await React.act(() => action().dispatchEvent(pointerFocus));
      assert.equal(pointerFocus.defaultPrevented, true);
      await React.act(() => action().click());
      assert.equal(document.activeElement, input);
    },
  );
});

test("the top bar invokes the current compaction or cancellation callback", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  const calls = [];
  try {
    for (const compacting of [false, true]) {
      await React.act(() =>
        root.render(
          React.createElement(CompactButton, {
            control: {
              disabled: false,
              compacting,
              onClick: () => calls.push(compacting ? "cancel" : "compact"),
            },
          }),
        ),
      );
      await React.act(() => container.querySelector("button").click());
    }
    assert.deepEqual(calls, ["compact", "cancel"]);
  } finally {
    await React.act(() => root.unmount());
  }
});

test("choosing the auto-selected model makes it explicit without clearing it", async () => {
  const chosen = [];
  await withComposer(
    {
      onSend() {},
      isStreaming: false,
      model: { provider: "openai", modelId: "example" },
      modelList: [{ provider: "openai", id: "example", name: "Example model" }],
      isAutoModelSelection: true,
      onModelChange: (...model) => chosen.push(model),
    },
    async ({ container, render }) => {
      const chooseCurrent = async () => {
        await React.act(() =>
          container.querySelector(".anchor-model-selector").click(),
        );
        const options = container.querySelectorAll('[role="option"]');
        assert.equal(options.length, 1);
        await React.act(() => options[0].click());
      };
      await chooseCurrent();
      assert.deepEqual(chosen, [["openai", "example"]]);
      await render({ isAutoModelSelection: false });
      await chooseCurrent();
      assert.equal(chosen.length, 1);
    },
  );
});
