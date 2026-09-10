import type { ModelCatalog, ModelListing, ModelOption } from "@core/ports";
import {
  ModelRuntime,
  resolveModelScopeWithDiagnostics,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { join } from "node:path";

const CACHE_TTL_MS = 60_000;

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
    { expiresAt: number; listing: Promise<ModelListing> }
  >();

  async function load(cwd: string): Promise<ModelListing> {
    const runtime = await ModelRuntime.create({
      authPath: join(options.agentDir, "auth.json"),
      modelsPath: join(options.agentDir, "models.json"),
    });
    const available = await runtime.getAvailable();
    const describe = (model: (typeof available)[number]): ModelOption => ({
      provider: model.provider,
      id: model.id,
      name: model.name,
      contextWindow: model.contextWindow,
      reasoning: model.reasoning,
    });
    const patterns = (
      SettingsManager.create(cwd, options.agentDir).getEnabledModels() ?? []
    )
      .map((pattern) => pattern.trim())
      .filter((pattern) => pattern !== "");
    if (patterns.length === 0) {
      return { models: available.map(describe), warnings: [] };
    }
    const scope = await resolveModelScopeWithDiagnostics(patterns, runtime);
    const warnings = scope.diagnostics.map((diagnostic) => diagnostic.message);
    const scoped = scope.scopedModels.map((entry) => describe(entry.model));
    return scoped.length === 0
      ? { models: available.map(describe), warnings }
      : { models: scoped, warnings };
  }

  return {
    list(cwd) {
      const hit = cache.get(cwd);
      if (hit && hit.expiresAt > Date.now()) return hit.listing;
      const listing = load(cwd);
      cache.set(cwd, { expiresAt: Date.now() + CACHE_TTL_MS, listing });
      listing.catch(() => cache.delete(cwd));
      return listing;
    },
  };
}
