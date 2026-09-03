import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { ChatInput, ModelErrorBanner, ModelScopeWarningBanner, canClearBuiltinCommandInput, canRestoreUserMessage, canRunBuiltinSlashCommandWhileStreaming, compressImageFile, cycleInputHistory, filterModelOptions, getAnchoredMenuMaxHeight, getStreamingSubmissionAction, getUserMessageText, getUserMessageDraftImages, isExactSlashCommand, shouldCompressImageFile } = await jiti.import("./ChatInput.tsx");
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

test("leaves space above the docked input", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatInput, {
      onSend() {},
      onAbort() {},
      isStreaming: false,
    }),
  );

  assert.match(html, /^<div style="flex-shrink:0;background:transparent;padding:12px 16px 8px;/);
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

test("groups model and reasoning on the left and keeps Compact separate", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatInput, {
      onSend() {},
      onAbort() {},
      onModelChange() {},
      onThinkingLevelChange() {},
      onCompact() {},
      isStreaming: false,
      model: { provider: "openai", modelId: "gpt-5.4" },
      modelList: [{ provider: "openai", id: "gpt-5.4", name: "GPT-5.4" }],
      thinkingLevel: "high",
    }),
  );

  const settingsGroup = html.indexOf('class="composer-settings-group"');
  const model = html.indexOf('title="Change model"');
  const reasoning = html.indexOf('aria-label="Change reasoning level"');
  const immediateActions = html.indexOf('class="composer-immediate-actions"');
  const compact = html.indexOf('aria-label="Compact context"');
  assert.ok(settingsGroup < model && model < reasoning && reasoning < immediateActions && immediateActions < compact);
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

test("keeps one composer action slot across idle, agent, and non-agent busy states", () => {
  const render = (props) => renderToStaticMarkup(React.createElement(ChatInput, {
    onSend() {},
    onAbort() {},
    ...props,
  }));
  const idle = render({ isStreaming: false });
  const agent = render({ isStreaming: true, onSteer() {}, onFollowUp() {} });
  const busy = render({ isStreaming: true });

  for (const html of [idle, agent, busy]) {
    assert.match(html, /class="composer-action-slot" style="width:128px;min-width:128px/);
  }
  // Hooks the phone media query targets; deleting one silently restores the 128px slot.
  assert.match(idle, /class="composer-action-primary"/);
  assert.match(agent, /class="composer-action-primary"/);
  assert.match(agent, /class="composer-action-menu-toggle"/);
  // The accessible name survives the word being hidden below 640px.
  assert.match(idle, /aria-label="Send"/);
  assert.match(agent, /aria-label="Steer"/);
  assert.match(idle, /class="composer-action-label">Send<\/span>/);
  assert.match(agent, /class="composer-action-label">Steer<\/span>/);
  // The menu must outgrow the shrunken slot instead of being clipped by it.
  assert.match(agent, /width:max-content;min-width:100%/);
  assert.match(agent, /aria-label="Select run action"/);
  assert.match(agent, /hidden=""/);
  assert.doesNotMatch(busy, /aria-label="Select run action"/);
});

test("tints the composer border for the selected run mode", () => {
  const render = (props) => renderToStaticMarkup(React.createElement(ChatInput, {
    onSend() {},
    onAbort() {},
    isStreaming: true,
    ...props,
  }));

  assert.match(render({ onSteer() {} }), /border:1px solid rgba\(234,179,8,0\.4\)/);
  assert.match(render({ onFollowUp() {} }), /border:1px solid rgba\(129,140,248,0\.4\)/);
  assert.doesNotMatch(render({}), /rgba\(234,179,8,0\.4\)/);
});

test("uses the selected streaming action and falls back only when unavailable", () => {
  assert.equal(getStreamingSubmissionAction("steer", true, true), "steer");
  assert.equal(getStreamingSubmissionAction("followup", true, true), "followup");
  assert.equal(getStreamingSubmissionAction("steer", false, true), "followup");
  assert.equal(getStreamingSubmissionAction("followup", true, false), "steer");
  assert.equal(getStreamingSubmissionAction("steer", false, false), null);
});

test("text or images enable the selected streaming action", () => {
  const draftKey = "composer-action-image";
  const render = () => renderToStaticMarkup(React.createElement(ChatInput, {
    onSend() {},
    onAbort() {},
    onSteer() {},
    onFollowUp() {},
    isStreaming: true,
    draftKey,
  }));

  clearDraft(draftKey);
  const emptyAction = render().match(/<button[^>]*title="Interrupt the current run[^>]*>/)?.[0];
  assert.match(emptyAction, /disabled=""/);

  setDraft(draftKey, { value: "", images: [{ data: "AQID", mimeType: "image/png" }] });
  const imageAction = render().match(/<button[^>]*title="Interrupt the current run[^>]*>/)?.[0];
  assert.doesNotMatch(imageAction, /disabled=""/);
  clearDraft(draftKey);
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

test("highlights Compact in green when context needs attention", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatInput, {
      onSend() {},
      onAbort() {},
      onCompact() {},
      compactWarning: true,
      isStreaming: false,
    }),
  );

  assert.match(html, /background:rgba\(34,197,94,0\.08\);border:1px solid rgba\(34,197,94,0\.3\);[^>]*color:var\(--success\)[^>]*aria-label="Compact context"/);
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
