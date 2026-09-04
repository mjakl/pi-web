import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { ChatInput, ModelErrorBanner, ModelScopeWarningBanner, canClearBuiltinCommandInput, canRestoreUserMessage, canRunBuiltinSlashCommandWhileStreaming, compressImageFile, cycleInputHistory, filterModelOptions, getAnchoredMenuMaxHeight, getUserMessageText, getUserMessageDraftImages, isExactSlashCommand, shouldCompressImageFile } = await jiti.import("./ChatInput.tsx");
const { CompactButton } = await jiti.import("./CompactButton.tsx");
const { ModelSelector } = await jiti.import("./ModelSelector.tsx");
const { clearDraft, getDraft, mergeRestoredSubmissionDraft, mergeRestoredSubmissionText, rekeyDraft, setDraft } = await jiti.import("@/lib/draft-store.ts");

test("renders the upstream model error", () => {
  const html = renderToStaticMarkup(
    React.createElement(ModelErrorBanner, {
      error: "Invalid models.json schema:\nproviders.custom.models.0.id must not be empty",
    }),
  );

  assert.match(html, /role="alert"/);
  assert.match(html, /Model error/);
  assert.match(html, /providers\.custom\.models\.0\.id must not be empty/);
});

test("does not render an empty model error", () => {
  assert.equal(renderToStaticMarkup(React.createElement(ModelErrorBanner, { error: null })), "");
});

test("renders enabledModels scope warnings", () => {
  const html = renderToStaticMarkup(
    React.createElement(ModelScopeWarningBanner, {
      warnings: ['No models match pattern "ghost-gateway/*"'],
    }),
  );

  assert.match(html, /Model scope warning/);
  assert.match(html, /ghost-gateway/);
  assert.equal(renderToStaticMarkup(React.createElement(ModelScopeWarningBanner, { warnings: [] })), "");
});

test("renders the composer as one stable input region", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatInput, {
      onSend() {},
      onAbort() {},
      isStreaming: false,
    }),
  );

  assert.match(html, /^<div class="chat-input">/);
  assert.equal(html.match(/<textarea/g)?.length, 1);
});

test("keeps the model selector visible when a model error leaves no options", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatInput, {
      onSend() {},
      onAbort() {},
      onModelChange() {},
      isStreaming: false,
      modelError: "Invalid models.json schema",
      modelList: [],
      modelNames: {},
    }),
  );

  assert.match(html, />No models</);
  assert.match(html, /title="No available models"/);
});

test("combines model and reasoning and keeps compaction out of the composer", () => {
  const html = renderToStaticMarkup(React.createElement(ChatInput, {
    onSend() {}, onAbort() {}, onModelChange() {}, onThinkingLevelChange() {},
    isStreaming: true, model: { provider: "openai", modelId: "gpt-5.4" },
    modelList: [{ provider: "openai", id: "gpt-5.4", name: "GPT-5.4" }], thinkingLevel: "high",
  }));
  assert.match(html, /aria-label="Model and reasoning"/);
  assert.match(html, /class="composer-model-detail">high/);
  assert.doesNotMatch(html, /Compact context/);
  assert.doesNotMatch(html, /Steer now \/ queue follow-up/);
});

test("does not render tool or completion sound settings in the composer", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatInput, {
      onSend() {},
      onAbort() {},
      onToolPresetChange() {},
      onSoundToggle() {},
      isStreaming: false,
    }),
  );

  assert.doesNotMatch(html, /Change tool preset/);
  assert.doesNotMatch(html, /completion sound/i);
});

test("shows and locks the optimistic model while a switch is pending", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatInput, {
      onSend() {},
      onAbort() {},
      onModelChange() {},
      isStreaming: false,
      model: { provider: "deepseek", modelId: "deepseek-v4-flash" },
      modelList: [{ provider: "deepseek", id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }],
      modelSwitching: true,
    }),
  );

  assert.match(html, /title="Switching model"/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /disabled=""/);
  assert.match(html, />DeepSeek V4 Flash</);
  assert.match(html, /animation:spin 0\.8s linear infinite/);
});

test("filters model options by name and id", () => {
  const options = [
    { provider: "ollama", modelId: "qwen3:latest", name: "Qwen 3" },
    { provider: "anthropic", modelId: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    { provider: "openai", modelId: "gpt-5.4", name: "GPT-5.4" },
  ];

  assert.deepEqual(filterModelOptions(options, "QWEN"), [options[0]]);
  assert.deepEqual(filterModelOptions(options, "claude-sonnet"), [options[1]]);
  assert.equal(filterModelOptions(options, "OpenAI").length, 0);
  assert.equal(filterModelOptions(options, "anthropic/claude").length, 0);
  assert.equal(filterModelOptions(options, "missing").length, 0);
  assert.equal(filterModelOptions(options, "  "), options);
});

test("renders the shared field model selector as a disabled gray control", () => {
  const html = renderToStaticMarkup(
    React.createElement(ModelSelector, {
      options: [{ provider: "openai", modelId: "gpt-5.6-sol", name: "GPT-5.6 Sol" }],
      value: null,
      onChange() {},
      onClear() {},
      emptyLabel: "Parent default",
      ariaLabel: "Model override",
      disabled: true,
      variant: "field",
    }),
  );

  assert.match(html, /aria-label="Model override"/);
  assert.match(html, /disabled=""/);
  assert.match(html, /background:var\(--bg-panel\)/);
  assert.match(html, />Parent default</);
});

test("labels the model selector from the English message package", () => {
  const html = renderToStaticMarkup(
    React.createElement(ModelSelector, {
      options: [{ provider: "openai", modelId: "gpt-5.6-sol", name: "GPT-5.6 Sol" }],
      value: null,
      onChange() {},
      ariaLabel: "Model",
    }),
  );

  assert.match(html, />Select model</);
  assert.match(html, /title="Change model"/);
});

test("shows Send while idle and Stop for an empty draft or non-steerable work", () => {
  const render = (props) => renderToStaticMarkup(React.createElement(ChatInput, { onSend() {}, onAbort() {}, ...props }));
  assert.match(render({ isStreaming: false }), /data-action="send"[^>]*disabled=""/);
  for (const props of [{ isStreaming: true }, { isStreaming: true, onSteer() {}, onFollowUp() {} }]) {
    const html = render(props);
    assert.match(html, /data-action="stop"[^>]*aria-label="Stop agent"/);
    assert.doesNotMatch(html, /Select run action|rgba\(234,179,8|rgba\(129,140,248/);
    assert.match(html, /class="composer-surface"/);
  }
});

test("an image-only draft offers Steer, while a shell command stays stoppable", () => {
  const draftKey = "composer-action-image";
  setDraft(draftKey, { value: "", images: [{ data: "AQID", mimeType: "image/png" }] });
  try {
    const render = (props) => renderToStaticMarkup(React.createElement(ChatInput, { onSend() {}, onAbort() {}, isStreaming: true, draftKey, ...props }));
    const html = render({ onSteer() {}, onFollowUp() {} });
    assert.match(html, /data-action="steer"[^>]*aria-label="Steer"/);
    assert.ok(html.indexOf('class="composer-surface"') < html.indexOf('aria-label="Remove image"'));
    assert.match(render({}), /data-action="stop"/);
  } finally { clearDraft(draftKey); }
});

test("compresses large images while preserving small images and GIFs", async () => {
  assert.equal(shouldCompressImageFile({ size: 1024 * 1024, type: "image/png" }), false);
  assert.equal(shouldCompressImageFile({ size: 1024 * 1024 + 1, type: "image/png" }), true);
  assert.equal(shouldCompressImageFile({ size: 2 * 1024 * 1024, type: "image/gif" }), false);

  const originals = {
    FileReader: globalThis.FileReader,
    createImageBitmap: globalThis.createImageBitmap,
    document: globalThis.document,
  };
  let bitmapCalls = 0;
  let closed = false;
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ fillStyle: "", fillRect() {}, drawImage() {} }),
    toDataURL: () => "data:image/jpeg;base64,COMPRESSED",
  };

  globalThis.FileReader = class {
    readAsDataURL() {
      this.result = "data:image/png;base64,ORIGINAL";
      this.onload();
    }
  };
  globalThis.createImageBitmap = async () => {
    bitmapCalls += 1;
    return { width: 2048, height: 1024, close() { closed = true; } };
  };
  globalThis.document = { createElement: () => canvas };

  try {
    assert.deepEqual(await compressImageFile({ size: 1024, type: "image/png" }), {
      data: "ORIGINAL",
      mimeType: "image/png",
    });
    assert.deepEqual(await compressImageFile({ size: 2 * 1024 * 1024, type: "image/png" }), {
      data: "COMPRESSED",
      mimeType: "image/jpeg",
    });
    assert.equal(bitmapCalls, 1);
    assert.equal(canvas.width, 1024);
    assert.equal(canvas.height, 512);
    assert.equal(closed, true);
  } finally {
    globalThis.FileReader = originals.FileReader;
    globalThis.createImageBitmap = originals.createImageBitmap;
    globalThis.document = originals.document;
  }
});

test("recognizes exact slash commands for one-Enter submission", () => {
  const builtin = { name: "copy", description: "", source: "builtin" };
  assert.equal(isExactSlashCommand("/copy", builtin), true);
  assert.equal(isExactSlashCommand("  /copy  ", builtin), true);
  assert.equal(isExactSlashCommand("/co", builtin), false);
  assert.equal(isExactSlashCommand("/copy extra", builtin), false);
  assert.equal(isExactSlashCommand("/copy", { ...builtin, source: "extension" }), false);
});

test("clears a completed built-in only while its submitted input is unchanged", () => {
  assert.equal(canClearBuiltinCommandInput("/copy", 0, "/copy"), true);
  assert.equal(canClearBuiltinCommandInput("new follow-up", 0, "/copy"), false);
  assert.equal(canClearBuiltinCommandInput("/copy", 1, "/copy"), false);
});

test("keeps only read-only built-ins available while a run is active", () => {
  assert.equal(canRunBuiltinSlashCommandWhileStreaming("/copy"), true);
  assert.equal(canRunBuiltinSlashCommandWhileStreaming("/session"), true);
  assert.equal(canRunBuiltinSlashCommandWhileStreaming("/compact"), false);
  assert.equal(canRunBuiltinSlashCommandWhileStreaming("/reload"), false);
});

test("restores text and base64 images when editing a user message", () => {
  const message = {
    role: "user",
    content: [
      { type: "text", text: "Review this image @src/example.ts " },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AQID" } },
    ],
  };

  assert.equal(getUserMessageText(message), "Review this image @src/example.ts ");
  assert.deepEqual(getUserMessageDraftImages(message), [
    { data: "AQID", mimeType: "image/png" },
  ]);
});

test("restores legacy flat image entries when editing a user message", () => {
  const message = {
    role: "user",
    content: [
      { type: "image", data: "AQID", mimeType: "image/jpeg" },
    ],
  };

  assert.deepEqual(getUserMessageDraftImages(message), [
    { data: "AQID", mimeType: "image/jpeg" },
  ]);
});

test("does not restore a historical message over a pending image attachment", () => {
  assert.equal(canRestoreUserMessage("", 0, 0), true);
  assert.equal(canRestoreUserMessage("", 1, 0), false);
  assert.equal(canRestoreUserMessage("", 0, 1), false);
  assert.equal(canRestoreUserMessage("draft", 0, 0), false);
});

test("restores a cleared submission using the queued React state", () => {
  let value = "failed submission";
  const updates = [
    () => "",
    (current) => mergeRestoredSubmissionText("failed submission", current),
  ];

  for (const update of updates) value = update(value);

  assert.equal(value, "failed submission");
  assert.equal(
    mergeRestoredSubmissionText("failed submission", "new draft"),
    "failed submission\n\nnew draft",
  );
  assert.equal(
    mergeRestoredSubmissionText("failed submission", "failed submission"),
    "failed submission\n\nfailed submission",
  );
});

test("keeps a failed first submission recoverable across a composer remount", () => {
  const image = { data: "AQID", mimeType: "image/png" };
  const restored = mergeRestoredSubmissionDraft(
    "failed submission",
    [image],
    "",
    [],
  );

  assert.deepEqual(restored, {
    value: "failed submission",
    images: [image],
  });
  assert.deepEqual(
    mergeRestoredSubmissionDraft("failed submission", [image], "new draft", []),
    {
      value: "failed submission\n\nnew draft",
      images: [image],
    },
  );
});

test("preserves duplicate image attachments when restoring a submission", () => {
  const image = { data: "AQID", mimeType: "image/png" };
  const restored = mergeRestoredSubmissionDraft("", [image, image], "", [image]);

  assert.deepEqual(restored.images, [image, image, image]);
});

test("moves a provisional new-session draft to the real session key", () => {
  const provisionalKey = "new:/tmp/rekey-test";
  const sessionKey = "session-rekey-test";
  clearDraft(provisionalKey);
  clearDraft(sessionKey);
  setDraft(provisionalKey, { value: "queued while preflight ran", images: [] });

  assert.deepEqual(rekeyDraft(provisionalKey, sessionKey), {
    value: "queued while preflight ran",
    images: [],
  });
  assert.equal(getDraft(provisionalKey), null);
  assert.deepEqual(getDraft(sessionKey), {
    value: "queued while preflight ran",
    images: [],
  });

  clearDraft(sessionKey);
});

test("rekey keeps a synchronously restored draft when React state is still empty", () => {
  const provisionalKey = "new:/tmp/rekey-race";
  const sessionKey = "session-rekey-race";
  clearDraft(provisionalKey);
  clearDraft(sessionKey);
  setDraft(provisionalKey, { value: "restored before state flush", images: [] });

  assert.deepEqual(
    rekeyDraft(provisionalKey, sessionKey, { value: "", images: [] }),
    { value: "restored before state flush", images: [] },
  );
  assert.equal(getDraft(provisionalKey), null);
  assert.deepEqual(getDraft(sessionKey), {
    value: "restored before state flush",
    images: [],
  });

  clearDraft(sessionKey);
});

test("the top-bar compaction control exposes warning, disabled, and cancel states", () => {
  const render = (props) => renderToStaticMarkup(React.createElement(CompactButton, props));
  assert.equal(render({ control: null }), "");
  const warning = render({ warning: true, control: { disabled: false, compacting: false, onClick() {} } });
  assert.match(warning, /data-warning="true"/);
  assert.match(warning, /aria-label="Compact context"/);
  assert.equal(warning.replace(/<[^>]*>/g, "").trim(), "");
  assert.match(render({ control: { disabled: true, compacting: false, onClick() {} } }), /disabled=""/);
  assert.match(render({ control: { disabled: false, compacting: true, onClick() {} } }), /aria-label="Stop compaction"/);
});

test("renders compact errors above the input as a wrapping alert", () => {
  const error = "Compaction failed: OpenAI API error (403): <html>request forbidden</html>";
  const html = renderToStaticMarkup(
    React.createElement(ChatInput, {
      onSend() {},
      onAbort() {},
      onCompact() {},
      isStreaming: false,
      compactError: error,
    }),
  );

  assert.match(html, /role="alert"/);
  assert.match(html, /Compaction failed: OpenAI API error/);
  assert.match(html, /&lt;html&gt;request forbidden&lt;\/html&gt;/);
  assert.match(html, /white-space:pre-wrap/);
  assert.ok(html.indexOf('role="alert"') < html.indexOf("<textarea"));
});

test("walks back through prompts with ArrowUp, newest first", () => {
  const history = ["oldest", "middle", "newest"];

  const first = cycleInputHistory(history, null, "up");
  assert.deepEqual(first, { cycle: 0, text: "newest" });
  assert.deepEqual(cycleInputHistory(history, first.cycle, "up"), { cycle: 1, text: "middle" });
  assert.deepEqual(cycleInputHistory(history, 1, "up"), { cycle: 2, text: "oldest" });
});

test("stops at the oldest prompt instead of wrapping", () => {
  const history = ["oldest", "middle", "newest"];

  assert.deepEqual(cycleInputHistory(history, 2, "up"), { cycle: 2, text: "oldest" });
});

test("walks forward and restores the empty composer off the end", () => {
  const history = ["oldest", "middle", "newest"];

  assert.deepEqual(cycleInputHistory(history, 2, "down"), { cycle: 1, text: "middle" });
  assert.deepEqual(cycleInputHistory(history, 0, "down"), { cycle: null, text: "" });
});

test("does nothing with no history to cycle", () => {
  assert.deepEqual(cycleInputHistory([], null, "up"), { cycle: null, text: "" });
  assert.deepEqual(cycleInputHistory([], null, "down"), { cycle: null, text: "" });
});

test("clamps an upward menu to the visible top of its container", () => {
  // Menu bottom at 343, container top at 36, 8px gap.
  assert.equal(getAnchoredMenuMaxHeight(343, 36), 299);
  // Never negative when the anchor sits above the visible area.
  assert.equal(getAnchoredMenuMaxHeight(40, 36), 0);
  assert.equal(getAnchoredMenuMaxHeight(10, 200), 0);
});
