import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { createJiti } from "jiti";

const window = new Window({ url: "http://localhost" });
Object.assign(globalThis, {
  window, document: window.document, HTMLElement: window.HTMLElement,
  Node: window.Node, Event: window.Event, MouseEvent: window.MouseEvent,
  IS_REACT_ACT_ENVIRONMENT: true,
});
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { act } = React;
const { createRoot } = await jiti.import("react-dom/client");
const { MessageView } = await jiti.import("./MessageView.tsx");

const call = { agent: "coder", prompt: "Investigate the API.\n\nKeep the existing controls.", model: "provider/model", cwd: "/work/project", initialContext: "empty" };
const block = { type: "toolCall", toolCallId: "sub-1", toolName: "subagent", input: { calls: [call] } };
const message = { role: "assistant", provider: "openai", model: "parent", timestamp: 1000, content: [block] };
function child(overrides = {}) {
  return { agent: "coder", callIndex: 0, exitCode: 0,
    messages: [{ role: "assistant", content: [{ type: "text", text: "## Findings\n\nUse **native notifications**. [Source](src/api.ts)" }] }], ...overrides };
}
function result(results = [child()], overrides = {}) {
  return { role: "toolResult", toolCallId: "sub-1", timestamp: 345000,
    content: [{ type: "text", text: "1/1 succeeded\n\n[1: coder] completed:\nFull original output" }],
    details: { kind: "pi-subagent", results }, ...overrides };
}
async function mount(initialProps = {}) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const render = async (props) => { await act(async () => root.render(React.createElement(MessageView, { message, ...props }))); };
  await render(initialProps);
  return { container, render, close: async () => { await act(async () => root.unmount()); container.remove(); } };
}
async function expand(details) {
  assert.ok(details, "disclosure exists");
  await act(async () => { details.open = true; details.dispatchEvent(new window.Event("toggle")); });
}
function namedDetails(container, label) {
  return [...container.querySelectorAll("details")].find((item) => item.querySelector(":scope > summary")?.textContent === label);
}

test("a completed subagent reveals Markdown before its verbatim prompt and preserves raw output", async () => {
  const view = await mount({ toolResults: new Map([["sub-1", result()]]), onOpenFile() {} });
  try {
    assert.match(view.container.textContent, /coder.*Completed.*5m 44s/);
    assert.equal(view.container.querySelector("h2"), null, "collapsed content is not mounted");
    assert.doesNotMatch(view.container.textContent, /Investigate the API/);
    await expand(view.container.querySelector("details"));
    assert.equal(view.container.querySelector("h2").textContent, "Findings");
    assert.equal(view.container.querySelector("strong").textContent, "native notifications");
    assert.doesNotMatch(view.container.textContent, /Keep the existing controls/);
    await expand(namedDetails(view.container, "Prompt"));
    assert.equal(view.container.querySelector("pre").textContent, call.prompt);
    const contents = view.container.textContent;
    assert.ok(contents.indexOf("Findings") < contents.indexOf(call.prompt));
    await expand(namedDetails(view.container, "Raw output"));
    assert.match(view.container.textContent, /Full original output/);
    await expand(namedDetails(view.container, "Run details"));
    assert.match(view.container.textContent, /Working directory\/work\/project/);
  } finally { await view.close(); }
});

test("active progress updates a memoized message, then completion overrides stale activity", async () => {
  const view = await mount();
  try {
    assert.match(view.container.textContent, /No result/);
    await view.render({ activeTools: new Map([["sub-1", { progress: "Subagents: 0/1 done, 1 running..." }]]) });
    assert.match(view.container.textContent, /Running/);
    assert.match(view.container.textContent, /0\/1 done/);
    await view.render({ activeTools: new Map([["sub-1", { progress: "Subagents: 1/1 done, 0 running..." }]]) });
    assert.match(view.container.textContent, /1\/1 done/);
    await view.render({ toolResults: new Map([["sub-1", result()]]), activeTools: new Map([["sub-1", {}]]) });
    assert.match(view.container.textContent, /Completed/);
    assert.doesNotMatch(view.container.textContent, /Running/);
    await view.render({});
    assert.match(view.container.textContent, /No result/);
  } finally { await view.close(); }
});

test("parallel results match call indices and retain partial output, errors, and truncation warnings", async () => {
  const calls = [call, { ...call, agent: "reviewer" }, { ...call, agent: "scout" }];
  const failed = child({ agent: "reviewer", callIndex: 1, exitCode: 1, errorMessage: "Provider failed", captureTruncated: true });
  const cancelled = child({ agent: "scout", callIndex: 2, exitCode: 130, stopReason: "aborted", errorMessage: "Cancelled by user" });
  const view = await mount({ message: { ...message, content: [{ ...block, input: { calls } }] },
    toolResults: new Map([["sub-1", result([failed, cancelled, child()])]]) });
  try {
    assert.match(view.container.textContent, /1 completed · 1 failed · 1 cancelled/);
    await expand(view.container.querySelector("details"));
    const agents = view.container.querySelectorAll(".subagent-agent");
    assert.equal(agents.length, 3);
    assert.match(agents[0].textContent, /coder.*Completed/);
    assert.match(agents[1].textContent, /reviewer.*Failed/);
    assert.match(agents[2].textContent, /scout.*Cancelled/);
    await expand(agents[1]);
    assert.match(agents[1].textContent, /Findings/);
    assert.match(agents[1].textContent, /Provider failed/);
    assert.match(agents[1].textContent, /omitted during capture/);
  } finally { await view.close(); }
});

test("unfamiliar or ambiguous results retain the aggregate response without misassigning it", async () => {
  for (const details of [{ kind: "other", results: [child()] }, { kind: "pi-subagent", results: [child({ callIndex: 7 })] }, { kind: "pi-subagent", failed: true, results: [] }]) {
    const view = await mount({ toolResults: new Map([["sub-1", result([], { details })]]) });
    try {
      if (details.failed) assert.match(view.container.textContent, /Failed/);
      await expand(view.container.querySelector("details"));
      assert.match(view.container.textContent, /Full original output/);
      assert.equal(view.container.querySelector("h2"), null);
    } finally { await view.close(); }
  }
});

test("streaming and unsupported inputs use the generic renderer without object coercion", async () => {
  for (const toolBlock of [{ ...block, rawInput: '{"calls":[' }, { ...block, input: { tasks: [{ agent: "coder" }] } }]) {
    const view = await mount({ message: { ...message, content: [toolBlock] } });
    try {
      assert.equal(view.container.querySelector(".subagent-card"), null);
      assert.doesNotMatch(view.container.textContent, /\[object Object\]/);
      if (toolBlock.rawInput) assert.match(view.container.textContent, /Generating parameters/);
    } finally { await view.close(); }
  }
});

test("large child output uses the existing reveal guard and result images remain accessible", async () => {
  const image = { type: "image", source: { type: "base64", media_type: "image/png", data: "dGVzdA==" } };
  const huge = child({ messages: [{ role: "assistant", content: [{ type: "text", text: "x".repeat(100001) }] }] });
  const view = await mount({ toolResults: new Map([["sub-1", result([huge], { content: [image] })]]) });
  try {
    await expand(view.container.querySelector("details"));
    assert.match(view.container.textContent, /100 KB/);
    assert.doesNotMatch(view.container.textContent, /x{100}/);
    assert.ok(view.container.querySelector('img[src="data:image/png;base64,dGVzdA=="]'));
  } finally { await view.close(); }
});
