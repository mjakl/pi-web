import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { startRpcSession } = await jiti.import("./rpc-manager.ts");
const { trustProject } = await jiti.import("./project-trust.ts");

async function fixture(t, { defaultTools, customSystem = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "pi-web-runtime-startup-"));
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");
  const marker = join(root, "project-extension-loaded");
  await mkdir(join(cwd, ".pi", "extensions"), { recursive: true });
  await mkdir(join(agentDir, "extensions"), { recursive: true });
  await mkdir(join(agentDir, "skills", "fixture-skill"), { recursive: true });
  await mkdir(join(agentDir, "prompts"), { recursive: true });
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      ...(defaultTools ? { defaultTools } : {}),
      packages: [],
    }),
  );
  await writeFile(join(agentDir, "AGENTS.md"), "Global context fixture.");
  await writeFile(join(cwd, "AGENTS.md"), "Project context fixture.");
  await writeFile(join(agentDir, "APPEND_SYSTEM.md"), "Global append fixture.");
  await writeFile(
    join(cwd, ".pi", "APPEND_SYSTEM.md"),
    "Project append fixture.",
  );
  if (customSystem)
    await writeFile(join(cwd, ".pi", "SYSTEM.md"), "Custom system fixture.");
  await writeFile(
    join(agentDir, "skills", "fixture-skill", "SKILL.md"),
    "---\nname: fixture-skill\ndescription: Runtime startup fixture\n---\nSkill instructions.\n",
  );
  await writeFile(
    join(agentDir, "prompts", "fixture-prompt.md"),
    "Prompt fixture.",
  );
  await writeFile(
    join(agentDir, "extensions", "fixture.js"),
    `export default (pi) => {
    pi.registerTool({ name: "fixture_tool", label: "Fixture", description: "Fixture tool",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ content: [{ type: "text", text: "fixture" }] }) });
    pi.registerCommand("fixture-command", { description: "Fixture command", handler: async () => {} });
  };`,
  );
  await writeFile(
    join(cwd, ".pi", "extensions", "project.js"),
    `import { writeFileSync } from "node:fs"; export default () => writeFileSync(${JSON.stringify(marker)}, "loaded");`,
  );
  const previous = process.env.PI_CODING_AGENT_DIR;
  const previousOffline = process.env.PI_OFFLINE;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_OFFLINE = "1";
  const wrappers = [];
  t.after(async () => {
    for (const wrapper of wrappers) await wrapper.shutdown();
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    if (previousOffline === undefined) delete process.env.PI_OFFLINE;
    else process.env.PI_OFFLINE = previousOffline;
    await rm(root, { recursive: true, force: true });
  });
  async function start(manager) {
    const result = await startRpcSession(
      manager?.getSessionId() ?? `new-${root}`,
      manager?.getSessionFile() ?? "",
      cwd,
    );
    wrappers.push(result.session);
    await result.session.waitUntilReady();
    return result.session;
  }
  return { cwd, agentDir, marker, start };
}

function assertRenderingPrompt(prompt, trusted = true) {
  assert.match(prompt, /Global context fixture\./);
  assert.match(prompt, /Project context fixture\./);
  // Pi discovers the trusted project's append file in preference to the global one.
  const append = trusted ? "Project append fixture." : "Global append fixture.";
  assert.ok(prompt.includes(append));
  if (!trusted) assert.doesNotMatch(prompt, /Project append fixture\./);
  assert.equal(prompt.split("Pi Web renders Markdown").length - 1, 1);
  assert.match(prompt, /fenced mermaid blocks/);
  assert.match(prompt, /LaTeX\/math typesetting is not supported/);
  assert.ok(prompt.indexOf(append) < prompt.indexOf("Pi Web renders Markdown"));
}

test("new runtimes keep Pi defaults and resources, append rendering guidance, and gate project extensions", async (t) => {
  const { cwd, agentDir, marker, start } = await fixture(t);
  const wrapper = await start();
  const inner = wrapper.inner;
  assert.deepEqual(
    new Set(inner.getActiveToolNames()),
    new Set(["read", "bash", "edit", "write", "fixture_tool"]),
  );
  assertRenderingPrompt(inner.systemPrompt, false);
  assert.match(inner.systemPrompt, /coding assistant/i);
  assert.deepEqual(inner.messages, []);
  assert.equal(existsSync(marker), false);
  const { commands } = await wrapper.send({ type: "get_commands" });
  for (const name of [
    "fixture-command",
    "fixture-prompt",
    "skill:fixture-skill",
  ])
    assert.ok(
      commands.some((command) => command.name === name),
      name,
    );
  await assert.rejects(
    wrapper.send({ type: "set_tools", toolNames: [] }),
    /Unsupported command/,
  );

  await wrapper.shutdown();
  trustProject(cwd, agentDir);
  const trusted = await start();
  assert.equal(existsSync(marker), true);
  assertRenderingPrompt(trusted.inner.systemPrompt);
});

for (const tools of [[], ["read", "grep", "find", "ls"]]) {
  test(`resumed runtimes ignore old selection ${JSON.stringify(tools)} without rewriting history`, async (t) => {
    const { cwd, agentDir, start } = await fixture(t, {
      defaultTools: ["read", "bash", "find"],
      customSystem: true,
    });
    trustProject(cwd, agentDir);
    const manager = SessionManager.create(cwd, join(agentDir, "sessions"));
    manager.appendThinkingLevelChange("off");
    manager.appendMessage({
      role: "user",
      content: "Existing question",
      timestamp: Date.now(),
    });
    manager.appendMessage(fauxAssistantMessage("Existing answer"));
    manager.appendCustomEntry("pi-web:tool-selection", { version: 1, tools });
    const before = await readFile(manager.getSessionFile(), "utf8");
    const messages = manager.buildSessionContext().messages;
    const wrapper = await start(manager);
    assert.equal(wrapper.sessionId, manager.getSessionId());
    assert.equal(wrapper.sessionFile, manager.getSessionFile());
    assert.deepEqual(
      new Set(wrapper.inner.getActiveToolNames()),
      new Set(["read", "bash", "find", "fixture_tool"]),
    );
    assertRenderingPrompt(wrapper.inner.systemPrompt);
    assert.match(wrapper.inner.systemPrompt, /Custom system fixture\./);
    assert.deepEqual(wrapper.inner.messages, messages);
    assert.equal(await readFile(manager.getSessionFile(), "utf8"), before);
    await wrapper.send({ type: "reload" });
    assertRenderingPrompt(wrapper.inner.systemPrompt);
    assert.deepEqual(wrapper.inner.messages, messages);
    assert.equal(await readFile(manager.getSessionFile(), "utf8"), before);
  });
}
