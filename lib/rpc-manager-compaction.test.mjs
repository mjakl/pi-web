import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Agent } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import {
  AgentSession,
  convertToLlm,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");

// Keep real SDK prompt admission, compaction events, and queue consumption.
// Only summarization and provider responses are controlled; no credentials or
// live agent state are read, and no network or paid model is used.
for (const automatic of [false, true]) {
  test(
    `real SDK ${automatic ? "pre-prompt automatic" : "manual"} compaction accepts and consumes deferred input`,
    { timeout: 10_000 },
    async (t) => {
      const root = await mkdtemp(join(tmpdir(), "pi-web-compaction-"));
      const started = Promise.withResolvers();
      const finish = Promise.withResolvers();
      const inputStarted = Promise.withResolvers();
      const finishInput = Promise.withResolvers();
      const sessionManager = SessionManager.inMemory(root);
      const settingsManager = SettingsManager.inMemory({
        compaction: {
          enabled: automatic,
          reserveTokens: 1000,
          keepRecentTokens: 100,
        },
      });
      const resourceLoader = new DefaultResourceLoader({
        cwd: root,
        agentDir: root,
        settingsManager,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        extensionFactories: [
          (pi) => {
            pi.on("input", async (event) => {
              if (event.text === "after compaction") {
                inputStarted.resolve();
                await finishInput.promise;
              }
            });
            pi.on("session_before_compact", async (event) => {
              started.resolve();
              await finish.promise;
              return {
                compaction: {
                  summary: "Earlier conversation summarized.",
                  firstKeptEntryId: event.preparation.firstKeptEntryId,
                  tokensBefore: event.preparation.tokensBefore,
                },
              };
            });
          },
        ],
      });
      await resourceLoader.reload();
      const faux = fauxProvider({ tokensPerSecond: 100_000 });
      faux.setResponses([
        fauxAssistantMessage("done"),
        fauxAssistantMessage("next done"),
      ]);
      const model = faux.getModel();
      const agent = new Agent({
        initialState: {
          systemPrompt: "",
          model,
          thinkingLevel: "off",
          tools: [],
        },
        convertToLlm,
        streamFn: faux.provider.streamSimple,
        getApiKey: () => "test",
      });
      const inner = new AgentSession({
        agent,
        sessionManager,
        settingsManager,
        cwd: root,
        resourceLoader,
        modelRuntime: {
          hasConfiguredAuth: () => true,
          checkAuth: async () => ({}),
          isUsingOAuth: () => false,
          getAuth: async () => ({ auth: { apiKey: "test" }, source: "test" }),
          streamSimple: faux.provider.streamSimple,
        },
        initialActiveToolNames: [],
        extensionRunnerRef: {},
      });
      const wrapper = new AgentSessionWrapper(inner);
      wrapper.start();
      t.after(async () => {
        finish.resolve();
        finishInput.resolve();
        wrapper.destroy();
        await rm(root, { recursive: true, force: true });
      });
      await wrapper.waitUntilReady();
      const user = { role: "user", content: "Earlier question", timestamp: 1 };
      const assistant = {
        ...fauxAssistantMessage("Earlier answer. ".repeat(200)),
        usage: {
          input: model.contextWindow,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: model.contextWindow + 1,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        timestamp: 2,
      };
      const history = [
        user,
        assistant,
        { ...user, content: "More context" },
        assistant,
      ];
      for (const message of history) sessionManager.appendMessage(message);
      agent.state.messages = history;
      const operation = wrapper.send(
        automatic ? { type: "prompt", message: "first" } : { type: "compact" },
      );
      await started.promise;
      assert.equal(inner.isCompacting, true);
      const images = [
        { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
      ];
      assert.deepEqual(
        await wrapper.send({
          type: "prompt",
          message: "after compaction",
          images,
        }),
        { queued: true },
      );
      assert.deepEqual(
        (await wrapper.send({ type: "get_state" })).queuedMessages.followUp,
        ["after compaction"],
      );
      const delivered = new Promise((resolve) => {
        const unsubscribe = wrapper.onEvent((event) => {
          if (
            event.type === "agent_settled" &&
            inner.messages.some(
              (message) =>
                message.role === "user" &&
                Array.isArray(message.content) &&
                message.content.some(
                  (block) => block.text === "after compaction",
                ),
            )
          ) {
            unsubscribe();
            resolve();
          }
        });
      });
      finish.resolve();
      await operation;
      await inputStarted.promise;
      // Handoff, not preflight acceptance, ends recallable wrapper ownership.
      const recalled = await wrapper.send({ type: "clear_queue" });
      assert.deepEqual(recalled.followUp, []);
      assert.equal(recalled.images, undefined);
      finishInput.resolve();
      await delivered;
      const deferredMessage = inner.messages.find(
        (message) =>
          message.role === "user" &&
          Array.isArray(message.content) &&
          message.content.some((block) => block.text === "after compaction"),
      );
      assert.deepEqual(deferredMessage.content, [
        { type: "text", text: "after compaction" },
        ...images,
      ]);
      assert.deepEqual(
        (await wrapper.send({ type: "get_state" })).queuedMessages,
        { steering: [], followUp: [] },
      );
    },
  );
}
