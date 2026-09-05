import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { Window } from "happy-dom";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const {
  MessageView,
  getTokenEstimateText,
  getToolCallInputText,
  replaceUserMessageText,
} = await jiti.import("./MessageView.tsx");

function renderMessage(message, props = {}) {
  return renderToStaticMarkup(
    React.createElement(MessageView, { message, ...props }),
  );
}

test("keeps the user message scroll area inside the rounded bubble's padding", async () => {
  const window = new Window();
  try {
    window.document.body.innerHTML = renderMessage({
      role: "user",
      content: "A long paragraph.\n\n".repeat(80),
    });
    const content = window.document.querySelector(".markdown-user-message");
    const scroller = content.parentElement;
    const shell = scroller.parentElement;
    assert.equal(scroller.style.overflowY, "auto");
    assert.equal(scroller.style.minHeight, "0");
    assert.equal(shell.style.overflow, "hidden");
    assert.equal(shell.style.borderRadius, "12px");
    assert.equal(shell.style.maxHeight, "300px");
    assert.equal(shell.style.paddingTop, "8px");
    assert.equal(shell.style.paddingBottom, "8px");
    assert.equal(scroller.style.marginRight, "4px");
    assert.equal(content.querySelectorAll("p").length, 80);
    assert.equal(content.lastElementChild.textContent, "A long paragraph.");
  } finally {
    await window.happyDOM.close();
  }
});

test("keeps streaming metrics in reserved slots while the model label truncates", () => {
  const modelLabel = "A deliberately long model name for narrow layouts";
  const html = renderMessage({
    role: "assistant",
    provider: "anthropic",
    model: "claude-test",
    content: [{ type: "text", text: "streaming response" }],
  }, {
    isStreaming: true,
    modelNames: { "anthropic:claude-test": modelLabel },
  });

  assert.match(html, /grid-template-columns:minmax\(0, 1fr\) 9ch 10ch/);
  assert.match(
    html,
    new RegExp(`<span title="${modelLabel}" style="[^"]*min-width:0;[^"]*overflow:hidden;[^"]*text-overflow:ellipsis;[^"]*white-space:nowrap[^"]*">`),
  );
  assert.match(
    html,
    /<span title="Estimated token count while streaming" style="[^"]*justify-content:flex-end;[^"]*color:var\(--text\);[^"]*font-variant-numeric:tabular-nums;[^"]*white-space:nowrap[^"]*">/,
  );
  assert.match(
    html,
    /<span style="text-align:right;color:var\(--text-dim\);[^"]*font-variant-numeric:tabular-nums;[^"]*white-space:nowrap[^"]*"><\/span>/,
  );
});

test("keeps streamed tool input out of collapsed markup while counting it", () => {
  const block = {
    type: "toolCall",
    toolCallId: "call-write-1",
    toolName: "write",
    input: {},
    rawInput: '{"path":"/tmp/file","content":"secret-stream-fragment',
  };
  const html = renderMessage({
    role: "assistant",
    provider: "anthropic",
    model: "claude-test",
    content: [block],
  }, { isStreaming: true });

  assert.match(html, /write/);
  assert.match(html, /Generating parameters/);
  assert.doesNotMatch(html, /secret-stream-fragment/);
  assert.equal(getToolCallInputText(block), block.rawInput);
  assert.equal(getTokenEstimateText(block), block.rawInput);
});

test("renders an extension Agent tool as a standard tool call", () => {
  const block = {
    type: "toolCall",
    toolCallId: "call-agent-1",
    toolName: "Agent",
    input: { task: "Find the parser" },
  };
  const result = {
    role: "toolResult",
    toolCallId: block.toolCallId,
    content: [{ type: "text", text: "Parser is in lib/parser.ts" }],
    details: { sessionId: "extension-session" },
  };
  const html = renderMessage({
    role: "assistant",
    provider: "anthropic",
    model: "claude-test",
    content: [block],
  }, {
    toolResults: new Map([[block.toolCallId, result]]),
  });

  assert.match(html, /border:1px solid rgba\(34,197,94,0\.25\)/);
  assert.match(html, />Agent</);
  assert.doesNotMatch(html, /extension-session/);
});

const COMPLETE_SKILL_EXPANSION = `<skill name="review" location="/skills/review/SKILL.md">
References are relative to /skills/review.

Review the supplied files.
</skill>

src/main.ts`;

test("renders a provider error when the assistant message has no content", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [],
    stopReason: "error",
    errorMessage: "OpenAI API error (403): <html>request forbidden</html>",
  });

  assert.match(html, /role="alert"/);
  assert.match(html, /Error: OpenAI API error \(403\)/);
  assert.match(html, /&lt;html&gt;request forbidden&lt;\/html&gt;/);
});

test("renders partial assistant content before the provider error", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [{ type: "text", text: "Partial response" }],
    stopReason: "error",
    errorMessage: "Connection closed",
  });

  assert.match(html, /Partial response/);
  assert.match(html, /Error: Connection closed/);
});

test("does not render completed assistant messages with only empty text", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [{ type: "text", text: "   " }],
  });

  assert.equal(html, "");
});

test("renders completed usage tokens without dollar cost", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [{ type: "text", text: "Done" }],
    usage: {
      input: 1234,
      output: 56,
      cacheRead: 78,
      cacheWrite: 9,
      cost: { total: 1.2345 },
    },
  });

  assert.match(html, /1,234 in/);
  assert.match(html, /56 out/);
  assert.match(html, /78 cache R/);
  assert.match(html, /9 cache W/);
  assert.doesNotMatch(html, /\$1\.2345/);
});

test("renders a complete SDK skill expansion as a compact command", () => {
  const html = renderMessage({
    role: "user",
    content: COMPLETE_SKILL_EXPANSION,
  });

  assert.match(html, /\/skill:review/);
  assert.match(html, /src\/main\.ts/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /Review the supplied files/);
});

test("does not collapse incomplete skill-looking user text", () => {
  const html = renderMessage({
    role: "user",
    content: '<skill name="review" location="/skills/review/SKILL.md">\nordinary user text',
  });

  assert.match(html, /ordinary user text/);
  assert.doesNotMatch(html, /aria-expanded/);
});

test("keeps attached images when restoring a compact command for editing", () => {
  const image = {
    type: "image",
    source: { type: "base64", media_type: "image/png", data: "QUJDRA==" },
  };
  const restored = replaceUserMessageText({
    role: "user",
    content: [{ type: "text", text: COMPLETE_SKILL_EXPANSION }, image],
  }, "/skill:review src/main.ts");

  assert.deepEqual(restored.content, [
    { type: "text", text: "/skill:review src/main.ts" },
    image,
  ]);
});

test("renders assistant images as buttons that open a larger preview", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [{
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "YWJj" },
    }],
  });

  assert.match(html, /<button[^>]+aria-label="Preview image"[^>]*>/);
  assert.match(html, /<img[^>]+src="data:image\/png;base64,YWJj"/);
});

test("renders user-message images as buttons that open a larger preview", () => {
  const html = renderMessage({
    role: "user",
    content: [
      { type: "text", text: "inspect this" },
      { type: "image", data: "YWJj", mimeType: "image/png" },
    ],
    timestamp: Date.now(),
  });

  assert.match(html, /<button[^>]+aria-label="Preview image"[^>]*>/);
  assert.match(html, /<img[^>]+src="data:image\/png;base64,YWJj"/);
});

test("keeps custom-message images collapsed when the display flag is absent", () => {
  const html = renderMessage({
    role: "custom",
    customType: "extension",
    content: [{ type: "image", data: "YWJj", mimeType: "image/png" }],
    timestamp: Date.now(),
  });

  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /<img/);
});

test("hands the hover reveal of message actions to CSS", () => {
  const assistant = renderMessage({
    role: "assistant",
    content: [{ type: "text", text: "answer" }],
  });
  assert.match(assistant, /^<div class="message-row"/);
  assert.match(assistant, /<button class="message-actions"/);

  const user = renderMessage(
    { role: "user", content: "hello" },
    { entryId: "e1", forking: true, onFork: () => {}, onNavigate: () => {}, prevAssistantEntryId: "p1" },
  );
  assert.match(user, /<div class="message-row"/);
  assert.match(user, /<div class="message-actions" data-forking="true"/);
});

test("summarizes subagent calls without coercing structured input to a string", () => {
  const html = renderMessage({
    role: "assistant", provider: "openai", model: "test",
    content: [{ type: "toolCall", toolCallId: "sub-1", toolName: "subagent",
      input: { calls: [{ agent: "coder", prompt: "Investigate the notification API" }] } }],
  });
  assert.match(html, /Subagent/);
  assert.match(html, /coder/);
  assert.doesNotMatch(html, /\[object Object\]/);
  assert.match(html, /No result/);
  assert.doesNotMatch(html, /Running/);
});
