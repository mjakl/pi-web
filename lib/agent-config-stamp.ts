import { stat } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/**
 * Credentials and model metadata are edited in the Pi terminal, not in Pi Web,
 * so nothing here calls invalidateModelsCache() when they change. Their mtimes
 * are the only available signal, and without it a terminal login stays
 * invisible to the browser for the whole models-cache TTL.
 */
const AGENT_CONFIG_FILES = ["auth.json", "models.json"];

/** Opaque marker of the agent configuration, for the models cache. */
export async function readAgentConfigStamp(agentDir = getAgentDir()): Promise<string> {
  const stamps = await Promise.all(AGENT_CONFIG_FILES.map(async (name) => {
    try {
      return String((await stat(join(agentDir, name))).mtimeMs);
    } catch {
      return "-";
    }
  }));
  return stamps.join(":");
}
