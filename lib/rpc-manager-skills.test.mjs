import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { Agent } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import {
  AgentSession,
  convertToLlm,
  DefaultResourceLoader,
  parseSkillBlock,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");

async function writeSkill(root, name, description, body, manual = false) {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    [
      "---",
      `name: ${name}`,
      `description: ${description}`,
      ...(manual ? ["disable-model-invocation: true"] : []),
      "---",
      body,
      "",
    ].join("\n"),
  );
}

async function createSkillSession(t, { chatOnly = false, responses = [] } = {}) {
  const root = await mkdtemp(join(tmpdir(), "pi-web-first-turn-skills-"));
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");
  const discoveredSkills = join(root, "discovered-skills");
  await mkdir(cwd, { recursive: true });
  await mkdir(agentDir, { recursive: true });
  await writeSkill(discoveredSkills, "visible-skill", "Visible first-turn guidance", "Visible skill body.");
  await writeSkill(discoveredSkills, "manual-skill", "Manual first-turn workflow", "Manual skill body.", true);

  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    noSkills: true,
    extensionFactories: [
      (pi) => {
        pi.on("resources_discover", () => ({ skillPaths: [discoveredSkills] }));
      },
    ],
  });
  await resourceLoader.reload();

  const faux = fauxProvider({ tokensPerSecond: 100_000 });
  faux.setResponses(responses);
  const model = faux.getModel();
  const agent = new Agent({
    initialState: { systemPrompt: "", model, thinkingLevel: "off", tools: [] },
    convertToLlm,
    streamFn: faux.provider.streamSimple,
    getApiKey: () => "test",
  });
  const modelRuntime = {
    hasConfiguredAuth: () => true,
    checkAuth: async () => ({}),
    isUsingOAuth: () => false,
    getModel: (provider, modelId) => (
      provider === model.provider && modelId === model.id ? model : undefined
    ),
    getAuth: async () => ({ auth: { apiKey: "test" }, source: "test" }),
    streamSimple: faux.provider.streamSimple,
  };
  const inner = new AgentSession({
    agent,
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
    cwd,
    resourceLoader,
    modelRuntime,
    initialActiveToolNames: ["read"],
    extensionRunnerRef: {},
  });
  const wrapper = new AgentSessionWrapper(inner, { chatOnly });

  t.after(async () => {
    wrapper.destroy();
    await rm(root, { recursive: true, force: true });
  });
  return { wrapper, inner };
}

function userText(context) {
  const message = context.messages.findLast((candidate) => candidate.role === "user");
  assert.ok(message);
  return message.content.find((block) => block.type === "text")?.text;
}

async function promptAndWait(wrapper, inner, message) {
  const settled = new Promise((resolve) => {
    const unsubscribe = inner.subscribe((event) => {
      if (event.type !== "agent_settled") return;
      unsubscribe();
      resolve();
    });
  });
  await wrapper.send({ type: "prompt", message });
  await settled;
}

test("a new session slash palette includes resources discovered during startup", async (t) => {
  const { wrapper } = await createSkillSession(t);

  const result = await wrapper.send({ type: "get_commands" });
  const skills = result.commands.filter((command) => command.source === "skill");

  assert.deepEqual(
    skills.map((skill) => skill.name),
    ["skill:manual-skill", "skill:visible-skill"],
  );
});

test("direct first-turn skill input matches later expansion and keeps model visibility rules", async (t) => {
  const contexts = [];
  const capture = (context) => {
    contexts.push({
      systemPrompt: context.systemPrompt,
      messages: structuredClone(context.messages),
    });
    return fauxAssistantMessage("done");
  };
  const { wrapper, inner } = await createSkillSession(t, { responses: [capture, capture] });
  const command = "/skill:manual-skill first  argument\nsecond line";

  await promptAndWait(wrapper, inner, command);
  await promptAndWait(wrapper, inner, command);

  assert.equal(contexts.length, 2);
  const firstExpansion = userText(contexts[0]);
  const laterExpansion = userText(contexts[1]);
  assert.equal(firstExpansion, laterExpansion);

  const parsed = parseSkillBlock(firstExpansion);
  assert.ok(parsed);
  assert.equal(parsed.name, "manual-skill");
  assert.equal(parsed.content, `References are relative to ${dirname(parsed.location)}.\n\nManual skill body.`);
  assert.equal(parsed.userMessage, "first  argument\nsecond line");

  assert.match(contexts[0].systemPrompt, /<name>visible-skill<\/name>/);
  assert.doesNotMatch(contexts[0].systemPrompt, /<name>manual-skill<\/name>/);
});

test("Chat only does not initialize or expose discovered skills", async (t) => {
  let context;
  const { wrapper, inner } = await createSkillSession(t, {
    chatOnly: true,
    responses: [(current) => {
      context = {
        systemPrompt: current.systemPrompt,
        messages: structuredClone(current.messages),
      };
      return fauxAssistantMessage("done");
    }],
  });

  const commands = await wrapper.send({ type: "get_commands" });
  assert.deepEqual(commands.commands, []);

  const input = "/skill:manual-skill keep this raw";
  await promptAndWait(wrapper, inner, input);

  assert.equal(userText(context), input);
  assert.doesNotMatch(context.systemPrompt, /visible-skill|manual-skill/);
});
