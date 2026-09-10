import { createFakeWorld } from "@adapters/fake/index";
import { createPiAgentRuntime } from "@adapters/pi/agent-runtime";
import { createPiModelCatalog } from "@adapters/pi/model-catalog";
import { createPiSessionCatalog } from "@adapters/pi/session-catalog";
import { createWorkspace, type Workspace } from "@core/workspace";
import type { Config } from "./config.ts";

// The only place that knows both the core and the Pi adapters.
export function createDeps(config: Config): { workspace: Workspace } {
  if (config.runtime === "fake") {
    const world = createFakeWorld({
      delayMs: 40,
      reply: (prompt) =>
        `You asked: **${prompt}**\n\nThis reply comes from the fake runtime, streamed word by word so the page can be checked without a model.\n\n\`\`\`ts\nconst answer = 42;\n\`\`\``,
    });
    return { workspace: createWorkspace(world) };
  }
  const catalog = createPiSessionCatalog({ agentDir: config.agentDir });
  return {
    workspace: createWorkspace({
      sessions: catalog,
      runtime: createPiAgentRuntime({ agentDir: config.agentDir, catalog }),
      models: createPiModelCatalog({ agentDir: config.agentDir }),
    }),
  };
}
