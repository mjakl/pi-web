import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { trustProject } = await jiti.import("./project-trust.ts");
const { loadSkillsWithInstallInfo } = await jiti.import("./skills-service.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const { invalidateModelsCache } = await jiti.import("./models-cache.ts");
const { GET: getModels } = await jiti.import("../app/api/models/route.ts");
const { GET: getPlugins, POST: postPlugins } = await jiti.import("../app/api/plugins/route.ts");
const { POST: installSkill } = await jiti.import("../app/api/skills/install/route.ts");
const { POST: postProjectTrust } = await jiti.import("../app/api/project-trust/route.ts");

const JSON_HEADERS = { "Content-Type": "application/json" };

// An untrusted project whose extension records its own execution in `marker`.
async function createUntrustedProject(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pi-web-trust-boundaries-")));
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");
  const marker = join(root, "extension-executed");
  await mkdir(join(cwd, ".pi", "extensions"), { recursive: true });
  await mkdir(join(cwd, ".pi", "skills", "project-probe"), { recursive: true });
  await mkdir(join(agentDir, "sessions"), { recursive: true });
  await writeFile(
    join(cwd, ".pi", "extensions", "probe.js"),
    `import { writeFileSync } from "node:fs";\nexport default () => { writeFileSync(${JSON.stringify(marker)}, "executed"); };\n`,
  );
  await writeFile(
    join(cwd, ".pi", "skills", "project-probe", "SKILL.md"),
    "---\nname: project-probe\ndescription: Trusted project probe\n---\nProbe instructions.\n",
  );
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousRoots = globalThis.__piAdditionalAllowedRoots;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  globalThis.__piAdditionalAllowedRoots = undefined;
  invalidateModelsCache();
  allowFileRoot(cwd);
  t.after(async () => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    globalThis.__piAdditionalAllowedRoots = previousRoots;
    invalidateModelsCache();
    await rm(root, { recursive: true, force: true });
  });
  return { cwd, agentDir, marker };
}

test("model discovery runs project extensions only after the project is trusted", async (t) => {
  const { cwd, agentDir, marker } = await createUntrustedProject(t);
  const request = () => new Request(`http://localhost/api/models?cwd=${encodeURIComponent(cwd)}`);

  assert.equal((await getModels(request())).status, 200);
  assert.equal(existsSync(marker), false);

  trustProject(cwd, agentDir);
  invalidateModelsCache();
  assert.equal((await getModels(request())).status, 200);
  assert.equal(existsSync(marker), true);
});

test("skill listing hides project skills and extensions until the project is trusted", async (t) => {
  const { cwd, agentDir, marker } = await createUntrustedProject(t);
  const hasProbe = (response) => response.skills.some((skill) => skill.name === "project-probe");

  const untrusted = await loadSkillsWithInstallInfo(cwd);
  assert.equal(untrusted.projectResourcesLoaded, false);
  assert.equal(hasProbe(untrusted), false);
  assert.equal(existsSync(marker), false);

  trustProject(cwd, agentDir);
  const trusted = await loadSkillsWithInstallInfo(cwd);
  assert.equal(trusted.projectResourcesLoaded, true);
  assert.equal(hasProbe(trusted), true);
  assert.equal(existsSync(marker), true);
});

test("plugin routes report project trust and refuse project changes until trusted", async (t) => {
  const { cwd, agentDir } = await createUntrustedProject(t);
  const listing = () => getPlugins(new Request(`http://localhost/api/plugins?cwd=${encodeURIComponent(cwd)}`));

  assert.equal((await (await listing()).json()).projectResourcesLoaded, false);
  const refused = await postPlugins(new Request("http://localhost/api/plugins", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ action: "disable", source: "npm:example", scope: "project", cwd }),
  }));
  assert.equal(refused.status, 403);

  trustProject(cwd, agentDir);
  assert.equal((await (await listing()).json()).projectResourcesLoaded, true);
});

test("project skill installs are refused until the project is trusted", async (t) => {
  const { cwd } = await createUntrustedProject(t);

  const response = await installSkill(new Request("http://localhost/api/skills/install", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ package: "example/skill", scope: "project", cwd }),
  }));

  assert.equal(response.status, 403);
});

test("trusting a project shuts down its restricted runtimes", async (t) => {
  const { cwd } = await createUntrustedProject(t);
  const previousRegistry = globalThis.__piSessions;
  const shutdowns = [];
  globalThis.__piSessions = new Map([["restricted-runtime", {
    sessionId: "restricted-runtime",
    cwd,
    isAlive: () => true,
    isRunning: () => false,
    shutdown: async () => {
      shutdowns.push("shutdown");
    },
  }]]);
  t.after(() => {
    globalThis.__piSessions = previousRegistry;
  });

  const response = await postProjectTrust(new Request("http://localhost/api/project-trust", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ cwd }),
  }));

  assert.deepEqual(await response.json(), { requiresTrust: true, trusted: true });
  assert.deepEqual(shutdowns, ["shutdown"]);
});
