import { thinkingChoices } from "@core/models";
import type { ModelCatalog, ModelListing, ModelOption } from "@core/ports";
import {
  ModelRuntime,
  resolveModelScopeWithDiagnostics,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { statSync } from "node:fs";
import { join } from "node:path";
import { projectTrustReloadOptions } from "./project-trust.ts";

const CACHE_TTL_MS = 60_000;

/** The menu and session startup must resolve the same scope and reasoning pins. */
export async function resolveModelListing(
  runtime: ModelRuntime,
  settings: SettingsManager,
): Promise<ModelListing> {
  const available = await runtime.getAvailable();
  const describe = (model: (typeof available)[number]): ModelOption => ({
    provider: model.provider,
    id: model.id,
    name: model.name,
    contextWindow: model.contextWindow,
    reasoning: model.reasoning,
    ...(model.reasoning
      ? { thinkingLevels: thinkingChoices(model.thinkingLevelMap) }
      : {}),
  });
  const provider = settings.getDefaultProvider();
  const model = settings.getDefaultModel();
  const preferred =
    provider !== undefined && model !== undefined
      ? { preferred: { provider, id: model } }
      : {};
  const patterns = (settings.getEnabledModels() ?? [])
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern !== "");
  if (patterns.length === 0) {
    return { models: available.map(describe), warnings: [], ...preferred };
  }
  const scope = await resolveModelScopeWithDiagnostics(patterns, runtime);
  const warnings = scope.diagnostics.map((diagnostic) => diagnostic.message);
  const scoped = scope.scopedModels.map((entry) => ({
    ...describe(entry.model),
    ...(entry.thinkingLevel === undefined ? {} : { pin: entry.thinkingLevel }),
  }));
  return scoped.length === 0
    ? { models: available.map(describe), warnings, ...preferred }
    : { models: scoped, warnings, ...preferred };
}

/**
 * Credentials and model metadata are edited in the Pi terminal, never here,
 * so nothing invalidates the cache when they change. Stamping it with the
 * modification times of `auth.json` and `models.json` makes a terminal login
 * show up on the next request instead of after the whole TTL. Opaque: only
 * equality matters.
 */
export function agentConfigStamp(agentDir: string): string {
  return ["auth.json", "models.json"]
    .map((name) => {
      try {
        return String(statSync(join(agentDir, name)).mtimeMs);
      } catch {
        return "-";
      }
    })
    .join(":");
}

/**
 * Models Pi has credentials for, narrowed by the `enabledModels` setting.
 * Built from auth.json and models.json only, so listing never loads project
 * extensions. A pattern that matches nothing is reported rather than obeyed:
 * a typo must not leave the page with no models at all.
 */
// ponytail: extension-registered providers are missing; read them from the
// live session's runtime when someone misses a model.
export function createPiModelCatalog(options: {
  agentDir: string;
}): ModelCatalog {
  const cache = new Map<
    string,
    { expiresAt: number; stamp: string; listing: Promise<ModelListing> }
  >();

  async function load(cwd: string): Promise<ModelListing> {
    const runtime = await ModelRuntime.create({
      authPath: join(options.agentDir, "auth.json"),
      modelsPath: join(options.agentDir, "models.json"),
    });
    const settings = SettingsManager.create(cwd, options.agentDir);
    const trust = projectTrustReloadOptions(cwd, options.agentDir);
    if (trust) settings.setProjectTrusted(await trust.resolveProjectTrust());
    return resolveModelListing(runtime, settings);
  }

  return {
    list(cwd) {
      const stamp = agentConfigStamp(options.agentDir);
      const hit = cache.get(cwd);
      if (hit && hit.expiresAt > Date.now() && hit.stamp === stamp) {
        return hit.listing;
      }
      const listing = load(cwd);
      cache.set(cwd, {
        stamp,
        expiresAt: Date.now() + CACHE_TTL_MS,
        listing,
      });
      listing.catch(() => cache.delete(cwd));
      return listing;
    },
    invalidate(cwd) {
      if (cwd === undefined) cache.clear();
      else cache.delete(cwd);
    },
  };
}
