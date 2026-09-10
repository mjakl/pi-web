import type { SlashCommand } from "@core/composer";
import type { ProjectResources } from "@core/ports";
import {
  DefaultResourceLoader,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

const CACHE_TTL_MS = 10_000;

/**
 * Prompt templates and skills a folder offers. Extensions are deliberately not
 * loaded: filling a menu must never run an untrusted project's code, and the
 * live session lists its own extension commands anyway.
 */
export function createPiProjectResources(options: {
  agentDir: string;
}): ProjectResources {
  const cache = new Map<
    string,
    { expiresAt: number; commands: Promise<SlashCommand[]> }
  >();

  async function load(cwd: string): Promise<SlashCommand[]> {
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir: options.agentDir,
      settingsManager: SettingsManager.create(cwd, options.agentDir),
      noExtensions: true,
      noThemes: true,
      noContextFiles: true,
    });
    await loader.reload();
    const prompts = loader.getPrompts().prompts.map((prompt): SlashCommand => ({
      name: prompt.name,
      description: prompt.description,
      source: "prompt",
    }));
    const skills = loader.getSkills().skills.map((skill): SlashCommand => ({
      name: `skill:${skill.name}`,
      description: skill.description,
      source: "skill",
      ...(skill.disableModelInvocation ? { manual: true } : {}),
    }));
    return [...prompts, ...skills];
  }

  return {
    commands(cwd) {
      const hit = cache.get(cwd);
      if (hit && hit.expiresAt > Date.now()) return hit.commands;
      const commands = load(cwd);
      cache.set(cwd, { expiresAt: Date.now() + CACHE_TTL_MS, commands });
      commands.catch(() => cache.delete(cwd));
      return commands;
    },
  };
}
