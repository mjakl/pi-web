import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { Window } from "happy-dom";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { shouldAbortOnEscape, useGlobalKeyboardShortcuts } = await jiti.import("./useKeyboardShortcuts.ts");

test("Cmd/Ctrl+K opens a new chat in the active project and respects handled events", async () => {
  const window = new Window();
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const React = await jiti.import("react");
  const { createRoot } = await jiti.import("react-dom/client");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const opened = [];
  function Shortcuts(props) {
    useGlobalKeyboardShortcuts(props);
    return React.createElement("textarea");
  }
  const render = (activeCwd) => React.act(() => root.render(React.createElement(Shortcuts, {
    activeCwd, onNewSession: cwd => opened.push(cwd),
  })));
  const press = async (options, handled = false) => {
    const event = new window.KeyboardEvent("keydown", { key: "k", bubbles: true, cancelable: true, ...options });
    if (handled) event.preventDefault();
    await React.act(() => container.querySelector("textarea").dispatchEvent(event));
    return event;
  };
  try {
    await render("/tmp/project");
    assert.equal((await press({ metaKey: true })).defaultPrevented, true);
    assert.equal((await press({ ctrlKey: true, key: "K" })).defaultPrevented, true);
    assert.deepEqual(opened, ["/tmp/project", "/tmp/project"]);
    assert.equal((await press({ ctrlKey: true, repeat: true })).defaultPrevented, true);
    await press({ metaKey: true }, true);
    for (const options of [
      {}, { ctrlKey: true, altKey: true }, { metaKey: true, shiftKey: true },
      { metaKey: true, isComposing: true }, { ctrlKey: true, altKey: true, key: "n" },
    ]) assert.equal((await press(options)).defaultPrevented, false);
    assert.equal(opened.length, 2);
    await render(null);
    assert.equal((await press({ ctrlKey: true })).defaultPrevented, false);
    assert.equal(opened.length, 2);
  } finally {
    await React.act(() => root.unmount());
    container.remove();
    await window.happyDOM.close();
  }
});

test("aborts the running turn on a plain Esc", () => {
  assert.equal(shouldAbortOnEscape({ defaultPrevented: false, tagName: "DIV" }), true);
});

test("leaves the turn running when an overlay already handled Esc", () => {
  assert.equal(shouldAbortOnEscape({ defaultPrevented: true, tagName: "BUTTON" }), false);
});

test("leaves the turn running for Esc on a dialog backdrop that handled it", () => {
  assert.equal(shouldAbortOnEscape({ defaultPrevented: true, tagName: "DIALOG" }), false);
});

test("lets a textarea handle Esc itself", () => {
  assert.equal(shouldAbortOnEscape({ defaultPrevented: false, tagName: "TEXTAREA" }), false);
});

test("lets an input handle Esc itself", () => {
  assert.equal(shouldAbortOnEscape({ defaultPrevented: false, tagName: "INPUT" }), false);
});

test("tolerates an event with no element target", () => {
  assert.equal(shouldAbortOnEscape({ defaultPrevented: false, tagName: undefined }), true);
});
