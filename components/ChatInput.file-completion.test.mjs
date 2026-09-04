import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { createJiti } from "jiti";

process.env.NODE_ENV = "test";
const window = new Window({ url: "http://localhost" });
Object.assign(globalThis, {
  window, document: window.document,
  HTMLElement: window.HTMLElement, Event: window.Event,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  IS_REACT_ACT_ENVIRONMENT: true,
});
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { createRoot } = await jiti.import("react-dom/client");
const { ChatInput } = await jiti.import("./ChatInput.tsx");

test("path completion ignores late responses and inserts an absolute file mention", async () => {
  const originalFetch = globalThis.fetch;
  const pending = [];
  globalThis.fetch = (url, options) => new Promise((resolve) => pending.push({ url, options, resolve }));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await React.act(() => root.render(React.createElement(ChatInput, {
      cwd: "/project", isStreaming: false, onSend() { assert.fail("must not send"); }, onAbort() {},
    })));
    const input = container.querySelector("textarea");
    const type = async (value) => {
      await React.act(() => {
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set.call(input, value);
        input.setSelectionRange(value.length, value.length);
        input.dispatchEvent(new window.Event("input", { bubbles: true }));
      });
      await React.act(() => new Promise((resolve) => setTimeout(resolve, 170)));
    };
    await type("@/first/a");
    await type("@/second/b");
    assert.equal(pending.length, 2);
    assert.match(pending[0].url, /\/api\/file-completion\?/);
    assert.equal(pending[0].options.signal.aborted, true);
    await React.act(() => pending[1].resolve(Response.json({ matches: [{ path: "/second/b.txt", isDir: false }] })));
    await React.act(() => pending[0].resolve(Response.json({ matches: [{ path: "/first/a.txt", isDir: false }] })));
    assert.equal(container.textContent.includes("/first/"), false);
    const file = [...container.querySelectorAll("button")].find((button) => button.textContent.includes("b.txt"));
    assert.ok(file);
    await React.act(() => file.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, cancelable: true })));
    assert.equal(input.value, "@/second/b.txt ");
    await type("@/missing/");
    await React.act(() => pending[2].resolve(new Response(null, { status: 404 })));
    assert.match(container.textContent, /Cannot list this directory/);
    await type("@report");
    assert.match(pending[3].url, /\/api\/file-index\?/);
    await React.act(() => pending[3].resolve(Response.json({ files: ["report.txt"], truncated: false })));
    const projectFile = [...container.querySelectorAll("button")].find((button) => button.textContent === "report.txt");
    assert.ok(projectFile);
    await React.act(() => projectFile.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, cancelable: true })));
    assert.equal(input.value, "@report.txt ");
  } finally {
    await React.act(() => root.unmount());
    container.remove();
    globalThis.fetch = originalFetch;
    await window.happyDOM.close();
  }
});
