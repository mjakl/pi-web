import { directoryWithin } from "@core/path-access";
import type { Skills } from "@core/ports";
import {
  clampSearchLimit,
  installArgs,
  type SkillInfo,
  type SkillInstall,
  installFromLock,
  installMessage,
  installSucceeded,
  lookupLockEntry,
  mapSearchResults,
  searchUrl,
  skillFolder,
  type SkillScope,
  skillSlug,
  SKILLS_HOME,
  type SkillUpdate,
  UNSUPPORTED_CHECK_MESSAGE,
  updateArgs,
} from "@core/skills";
import { setDisableModelInvocation } from "@core/skill-toggle";
import {
  DefaultResourceLoader,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { type NpxResult, runNpx } from "./npx.ts";
import {
  createPiProjectTrust,
  projectTrustReloadOptions,
} from "./project-trust.ts";

// Skills as the settings page needs them: the loader's own list, annotated
// with what `npx skills` wrote into its lock files, plus the registry
// operations. Everything that decides anything lives in @core/skills.

const NPX_TIMEOUT_MS = 60_000;
const run = promisify(execFile);

type Fetch = typeof fetch;
type Npx = (
  args: string[],
  options: { cwd?: string; timeout: number },
) => Promise<NpxResult>;

function registryBase(): string {
  return process.env["SKILLS_API_URL"] ?? SKILLS_HOME;
}

/** Both lock files are `{ skills: { <name>: entry } }`; anything else is none. */
async function lockSkills(path: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return {};
    const skills = (parsed as { skills?: unknown }).skills;
    if (typeof skills !== "object" || skills === null) return {};
    return skills as Record<string, unknown>;
  } catch {
    return {};
  }
}

function globalLockPath(): string {
  const state = process.env["XDG_STATE_HOME"];
  return state
    ? join(state, "skills", ".skill-lock.json")
    : join(homedir(), ".agents", ".skill-lock.json");
}

function scopeOf(info: {
  filePath: string;
  cwd: string;
  agentDir: string;
}): SkillScope | undefined {
  if (directoryWithin(join(info.agentDir, "skills"), info.filePath)) {
    return "global";
  }
  if (directoryWithin(join(info.cwd, ".pi", "skills"), info.filePath)) {
    return "project";
  }
  return undefined;
}

type GitTree = { sha?: unknown; tree?: unknown };

async function githubTreeHash(
  install: SkillInstall,
  folder: string,
  http: Fetch,
): Promise<string | { retry: true }> {
  const token = process.env["GITHUB_TOKEN"] ?? process.env["GH_TOKEN"];
  const response = await http(
    `https://api.github.com/repos/${install.source}/git/trees/${install.ref ?? "HEAD"}?recursive=1`,
    {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "web-pi",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(15_000),
    },
  );
  // Rate limiting and private repositories are expected; a bare fetch still
  // reaches a public one without credentials.
  if ([401, 403, 429].includes(response.status)) return { retry: true };
  if (!response.ok) {
    throw new Error(`GitHub answered ${String(response.status)}`);
  }
  const body = (await response.json()) as GitTree;
  if (folder === "") {
    if (typeof body.sha !== "string") throw new Error("No tree hash returned");
    return body.sha;
  }
  const entries = Array.isArray(body.tree) ? body.tree : [];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (record["path"] === folder && record["type"] === "tree") {
      if (typeof record["sha"] === "string") return record["sha"];
    }
  }
  throw new Error(`No tree entry for ${folder}`);
}

/** A shallow, blobless bare fetch: the tree hash without cloning the repo. */
async function gitTreeHash(
  install: SkillInstall,
  folder: string,
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "web-pi-skill-check-"));
  try {
    const gitDir = ["--git-dir", directory];
    await run("git", ["init", "--bare", directory], { timeout: 30_000 });
    await run(
      "git",
      [
        ...gitDir,
        "fetch",
        "--depth=1",
        "--filter=blob:none",
        "--no-tags",
        `https://github.com/${install.source}.git`,
        install.ref ?? "HEAD",
      ],
      { timeout: 30_000 },
    );
    const { stdout } = await run(
      "git",
      [
        ...gitDir,
        "rev-parse",
        folder === "" ? "FETCH_HEAD^{tree}" : `FETCH_HEAD:${folder}`,
      ],
      { timeout: 30_000 },
    );
    const hash = stdout.trim();
    if (!/^[0-9a-f]{40}$/.test(hash)) throw new Error("No tree hash returned");
    return hash;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function latestHash(install: SkillInstall, http: Fetch): Promise<string> {
  const folder = skillFolder(install.skillPath ?? "");
  if (install.scope === "project") {
    const [owner, repo] = install.source.split("/");
    const name = install.package.slice(install.package.lastIndexOf("@") + 1);
    const response = await http(
      `${registryBase()}/api/download/${String(owner)}/${String(repo)}/${skillSlug(name)}`,
      { signal: AbortSignal.timeout(15_000) },
    );
    if (!response.ok) {
      throw new Error(`skills.sh answered ${String(response.status)}`);
    }
    const body = (await response.json()) as { hash?: unknown };
    if (typeof body.hash !== "string") {
      throw new Error("skills.sh did not return a version hash.");
    }
    return body.hash;
  }
  const hash = await githubTreeHash(install, folder, http);
  return typeof hash === "string" ? hash : gitTreeHash(install, folder);
}

export function createPiSkills(options: {
  agentDir: string;
  /** The registry and GitHub calls; tests answer them without a network. */
  fetch?: Fetch;
  /** `npx skills`; tests answer it without installing anything. */
  npx?: Npx;
}): Skills {
  const trust = createPiProjectTrust({ agentDir: options.agentDir });
  const http = options.fetch ?? fetch;
  const npx = options.npx ?? runNpx;

  async function listSkills(cwd: string): Promise<{
    skills: SkillInfo[];
    diagnostics: string[];
    projectResourcesLoaded: boolean;
  }> {
    // The loader is what a session start uses, so settings-declared paths,
    // package skills, and `.agents/skills` are all here too.
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir: options.agentDir,
      settingsManager: SettingsManager.create(cwd, options.agentDir),
    });
    await loader.reload(projectTrustReloadOptions(cwd, options.agentDir));
    const loaded = loader.getSkills();
    const [globalLock, projectLock, status] = await Promise.all([
      lockSkills(globalLockPath()),
      lockSkills(join(cwd, "skills-lock.json")),
      trust.status(cwd),
    ]);
    const skills = loaded.skills.map((skill): SkillInfo => {
      const scope = scopeOf({
        filePath: skill.filePath,
        cwd,
        agentDir: options.agentDir,
      });
      const entry =
        scope === undefined
          ? undefined
          : lookupLockEntry(
              scope === "global" ? globalLock : projectLock,
              skill.name,
            );
      const install =
        scope === undefined || entry === undefined
          ? undefined
          : installFromLock(skill.name, entry, scope);
      return {
        name: skill.name,
        description: skill.description,
        filePath: skill.filePath,
        baseDir: skill.baseDir,
        disableModelInvocation: skill.disableModelInvocation,
        scope:
          skill.sourceInfo.scope === "user"
            ? "global"
            : skill.sourceInfo.scope === "project"
              ? "project"
              : "path",
        ...(install === undefined ? {} : { install }),
      };
    });
    return {
      skills,
      diagnostics: loaded.diagnostics.map((entry) => entry.message),
      projectResourcesLoaded: status.trusted,
    };
  }

  async function installsOf(
    cwd: string,
    target?: { package: string; scope: SkillScope },
  ): Promise<SkillInstall[]> {
    const { skills } = await listSkills(cwd);
    const installs = skills
      .map((skill) => skill.install)
      .filter((install) => install !== undefined);
    if (!target) return installs;
    return installs.filter(
      (install) =>
        install.package === target.package && install.scope === target.scope,
    );
  }

  return {
    list: listSkills,

    async setDisabled(filePath, disable) {
      const content = await readFile(filePath, "utf8");
      const updated = setDisableModelInvocation(content, disable);
      if (updated !== content) await writeFile(filePath, updated, "utf8");
    },

    async search(query, limit) {
      // skills.sh is the only source of truth; a failure is reported, never
      // papered over with a local guess.
      const response = await http(
        searchUrl(registryBase(), query, clampSearchLimit(limit)),
        { cache: "no-store", signal: AbortSignal.timeout(15_000) },
      );
      if (!response.ok) {
        throw new Error(`skills.sh answered ${String(response.status)}`);
      }
      return mapSearchResults(await response.json(), registryBase());
    },

    async install(pkg, scope, cwd) {
      const result = await npx(installArgs(pkg, scope), {
        timeout: NPX_TIMEOUT_MS,
        ...(scope === "project" ? { cwd } : {}),
      });
      const output = result.stdout + result.stderr;
      if (!installSucceeded(output)) {
        throw new Error(installMessage(output) || "Install failed");
      }
      return installMessage(output);
    },

    async check(cwd, target) {
      const installs = await installsOf(cwd, target);
      if (target && installs.length === 0) {
        throw new Error("Installed skill not found");
      }
      return Promise.all(
        installs.map(async (install): Promise<SkillUpdate> => {
          const base = { package: install.package, scope: install.scope };
          if (
            !install.canCheckForUpdates ||
            install.versionHash === undefined ||
            install.skillPath === undefined
          ) {
            return {
              ...base,
              state: "unsupported",
              message: UNSUPPORTED_CHECK_MESSAGE,
            };
          }
          try {
            const latest = await latestHash(install, http);
            return {
              ...base,
              state:
                latest === install.versionHash
                  ? "up-to-date"
                  : "update-available",
              currentVersion: install.versionHash,
              latestVersion: latest,
            };
          } catch (error) {
            return {
              ...base,
              state: "error",
              currentVersion: install.versionHash,
              message: error instanceof Error ? error.message : String(error),
            };
          }
        }),
      );
    },

    async update(cwd, pkg, scope) {
      const [install] = await installsOf(cwd, { package: pkg, scope });
      if (!install) throw new Error("Installed skill not found");
      if (!install.canCheckForUpdates) {
        throw new Error("This skill cannot be updated automatically");
      }
      const result = await npx(updateArgs(install), {
        timeout: NPX_TIMEOUT_MS,
        ...(scope === "project" ? { cwd } : {}),
      });
      const output = result.stdout + result.stderr;
      if (result.failed && !installSucceeded(output)) {
        throw new Error(installMessage(output, 500) || "Update failed");
      }
      return installMessage(output, 500);
    },
  };
}
