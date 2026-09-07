import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { createJiti } from "jiti";

const window = new Window();
Object.assign(globalThis, {
  window,
  document: window.document,
  IS_REACT_ACT_ENVIRONMENT: true,
});
let frames = new Map();
let frameId = 0;
globalThis.requestAnimationFrame = (callback) => {
  frames.set(++frameId, callback);
  return frameId;
};
globalThis.cancelAnimationFrame = (id) => frames.delete(id);
const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { createRoot } = await jiti.import("react-dom/client");
const { useSessionInputFocus } = await jiti.import("./useSessionInputFocus.ts");
const { ChatInput } = await jiti.import("../components/ChatInput.tsx");
const { setDraft, clearDraft } = await jiti.import("../lib/draft-store.ts");

function View({ sessionKey, ready }) {
  const input = React.useRef(null);
  useSessionInputFocus(sessionKey, ready, input);
  return ready
    ? React.createElement(ChatInput, {
        ref: input,
        draftKey: sessionKey,
        isStreaming: false,
        onSend() {},
        onAbort() {},
      })
    : null;
}

async function fixture(run) {
  const container = document.createElement("div");
  document.body.append(container);
  const other = document.createElement("button");
  document.body.append(other);
  const root = createRoot(container);
  const render = (props) =>
    React.act(() => root.render(React.createElement(View, props)));
  const flush = () =>
    React.act(() => {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback());
    });
  try {
    await run({ container, other, render, flush });
  } finally {
    await React.act(() => root.unmount());
    container.remove();
    other.remove();
    frames.clear();
  }
}

test("focuses a loaded desktop session at the end of its preserved draft, only once", async () => {
  setDraft("focus-draft", { value: "Existing draft", images: [] });
  try {
    await fixture(async ({ container, other, render, flush }) => {
      await render({ sessionKey: "focus-draft", ready: true });
      await flush();
      const input = container.querySelector("textarea");
      assert.equal(document.activeElement, input);
      assert.equal(input.value, "Existing draft");
      assert.equal(input.selectionStart, 14);
      other.focus();
      window.dispatchEvent(new window.Event("focus"));
      await render({ sessionKey: "focus-draft", ready: true });
      await flush();
      assert.equal(document.activeElement, other);
    });
  } finally {
    clearDraft("focus-draft");
  }
});

test("focuses after loading and again after switching or creating a session", async () => {
  await fixture(async ({ container, other, render, flush }) => {
    await render({ sessionKey: "first", ready: false });
    await render({ sessionKey: "first", ready: true });
    await flush();
    assert.equal(document.activeElement, container.querySelector("textarea"));
    for (const sessionKey of ["second", "new-draft"]) {
      other.focus();
      await render({ sessionKey, ready: false });
      await render({ sessionKey, ready: true });
      await flush();
      assert.equal(document.activeElement, container.querySelector("textarea"));
    }
  });
});

test("does not steal focus after interaction while loading or before the scheduled focus", async () => {
  await fixture(async ({ other, render, flush }) => {
    await render({ sessionKey: "delayed", ready: false });
    other.focus();
    await render({ sessionKey: "delayed", ready: true });
    await flush();
    assert.equal(document.activeElement, other);
    await render({ sessionKey: "next", ready: true });
    document.dispatchEvent(new window.Event("pointerdown"));
    await flush();
    assert.equal(document.activeElement, other);
  });
});

test("does not request mobile focus or revive an old request after unmount", async () => {
  const matchMedia = window.matchMedia;
  window.matchMedia = (query) => ({
    matches: query.includes("pointer: coarse"),
    addEventListener() {},
    removeEventListener() {},
  });
  try {
    await fixture(async ({ other, render, flush }) => {
      other.focus();
      await render({ sessionKey: "mobile", ready: true });
      await flush();
      assert.equal(document.activeElement, other);
    });
  } finally {
    window.matchMedia = matchMedia;
  }
  await fixture(async ({ render }) => {
    await render({ sessionKey: "unmounted", ready: true });
  });
  assert.equal(frames.size, 0);
});
