import assert from "node:assert/strict";
import test, { after } from "node:test";
import { Window } from "happy-dom";
import { registerHooks } from "node:module";
import { createJiti } from "jiti";

registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith(".css")) return nextLoad(url, context);
    return { format: "module", shortCircuit: true, source: "export default {};" };
  },
});

process.env.NODE_ENV = "test";
const window = new Window({ url: "http://localhost" });
Object.assign(globalThis, {
  window,
  document: window.document,
  HTMLElement: window.HTMLElement,
  HTMLDialogElement: window.HTMLDialogElement,
  Event: window.Event,
  KeyboardEvent: window.KeyboardEvent,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  IS_REACT_ACT_ENVIRONMENT: true,
});

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { createRoot } = await jiti.import("react-dom/client");
const { ExtensionDialog } = await jiti.import("./ChatWindow.tsx");
const { shouldAbortOnEscape } = await jiti.import("../hooks/useKeyboardShortcuts.ts");
after(() => window.happyDOM.close());

async function withDialog(request, run) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const responses = [];
  try {
    await React.act(() => root.render(React.createElement(ExtensionDialog, {
      request,
      onRespond: (_req, response) => responses.push(response),
    })));
    return await run(container.querySelector("dialog"), responses);
  } finally {
    await React.act(() => root.unmount());
    container.remove();
  }
}

function pressEscape(dialog) {
  const event = new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  dialog.dispatchEvent(event);
  return event;
}

// The methods that render no field. Before these dialogs became <dialog>,
// nothing here was focusable and no handler claimed Escape, so the key reached
// the global shortcut and aborted the turn the extension was waiting on.
for (const request of [
  { id: "r1", method: "confirm", title: "Proceed?", message: "Really?" },
  { id: "r2", method: "select", title: "Pick one", options: ["a", "b"] },
]) {
  test(`Escape cancels a ${request.method} request instead of aborting the turn`, async () => {
    const { responses, aborts } = await withDialog(request, (dialog, responses) => {
      const event = pressEscape(dialog);
      return {
        responses,
        aborts: shouldAbortOnEscape({
          defaultPrevented: event.defaultPrevented,
          tagName: dialog.tagName,
        }),
      };
    });

    assert.deepEqual(responses, [{ cancelled: true }]);
    assert.equal(aborts, false, "Escape must not reach the global abort shortcut");
  });
}

test("the request is a real modal, not a div wearing a dialog role", async () => {
  const tag = await withDialog(
    { id: "r3", method: "confirm", title: "Proceed?", message: "Really?" },
    (dialog) => ({ name: dialog.tagName, open: dialog.open }),
  );

  assert.equal(tag.name, "DIALOG");
  assert.equal(tag.open, true, "showModal() must have run so the focus trap is real");
});

test("Escape cancels the input method too", async () => {
  const responses = await withDialog(
    { id: "r4", method: "input", title: "Name?", placeholder: "" },
    (dialog, responses) => { pressEscape(dialog); return responses; },
  );

  assert.deepEqual(responses, [{ cancelled: true }]);
});
