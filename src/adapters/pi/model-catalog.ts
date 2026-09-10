import type { ModelCatalog, ModelOption } from "@core/ports";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";

const CACHE_TTL_MS = 60_000;

/**
 * Models Pi has credentials for. Built from auth.json and models.json only,
 * so listing never loads project extensions.
 */
// ponytail: ignores enabledModels scoping and extension-registered providers;
// read them from the live session's runtime when someone misses a model.
export function createPiModelCatalog(options: {
  agentDir: string;
}): ModelCatalog {
  let cached: { expiresAt: number; models: Promise<ModelOption[]> } | undefined;

  async function load(): Promise<ModelOption[]> {
    const runtime = await ModelRuntime.create({
      authPath: join(options.agentDir, "auth.json"),
      modelsPath: join(options.agentDir, "models.json"),
    });
    const available = await runtime.getAvailable();
    return available.map((model) => ({
      provider: model.provider,
      id: model.id,
      name: model.name,
      contextWindow: model.contextWindow,
      reasoning: model.reasoning,
    }));
  }

  return {
    list() {
      if (cached && cached.expiresAt > Date.now()) return cached.models;
      const models = load();
      cached = { expiresAt: Date.now() + CACHE_TTL_MS, models };
      models.catch(() => {
        cached = undefined;
      });
      return models;
    },
  };
}
