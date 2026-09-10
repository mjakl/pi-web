import {
  assistantEntry,
  createFakeWorld,
  type FakeStoredSession,
  userEntry,
} from "@adapters/fake/index";
import { createFileTree } from "@adapters/fs/file-tree";
import { createPiAgentRuntime } from "@adapters/pi/agent-runtime";
import { createPiModelCatalog } from "@adapters/pi/model-catalog";
import { createPiProjectResolver } from "@adapters/pi/projects";
import { createPiProjectResources } from "@adapters/pi/resources";
import { createPiSessionCatalog } from "@adapters/pi/session-catalog";
import { createWorkspace, type Workspace } from "@core/workspace";
import { tmpdir } from "node:os";
import type { Config } from "./config.ts";

/** Two stored sessions so the demo runtime has a sidebar worth looking at. */
function demoSessions(cwd: string): FakeStoredSession[] {
  const at = (days: number) =>
    new Date(Date.now() - days * 86_400_000).toISOString();
  return [
    {
      summary: {
        id: "demo-report",
        cwd,
        createdAt: at(2),
        modifiedAt: at(1),
        fileSize: 4,
      },
      entries: [
        userEntry("d1", null, "Summarise the release notes"),
        assistantEntry("d2", "d1", "Here is the **summary**.", 12_000),
        userEntry("d3", "d2", "Now add the migration steps"),
        assistantEntry("d4", "d3", "1. Back up\n2. Migrate\n3. Verify", 18_000),
      ],
    },
    {
      summary: {
        id: "demo-bugfix",
        cwd: `${cwd}/worktree`,
        name: "Flaky test",
        createdAt: at(5),
        modifiedAt: at(3),
        fileSize: 2,
      },
      entries: [
        userEntry("b1", null, "Why does the timer test flake?"),
        assistantEntry("b2", "b1", "It races the fake clock.", 9000),
      ],
    },
  ];
}

// The only place that knows both the core and the Pi adapters.
export function createDeps(config: Config): { workspace: Workspace } {
  if (config.runtime === "fake") {
    const world = createFakeWorld({
      sessions: demoSessions(config.defaultCwd),
      delayMs: 40,
      reply: (prompt) =>
        `You asked: **${prompt}**\n\nThis reply comes from the fake runtime, streamed word by word so the page can be checked without a model.\n\n\`\`\`ts\nconst answer = 42;\n\`\`\``,
    });
    // Files stay real even in the demo world: `@` completion is only worth
    // looking at against an actual checkout.
    return {
      workspace: createWorkspace({
        ...world,
        files: createFileTree(),
        tmpdir: tmpdir(),
      }),
    };
  }
  const catalog = createPiSessionCatalog({ agentDir: config.agentDir });
  return {
    workspace: createWorkspace({
      sessions: catalog,
      runtime: createPiAgentRuntime({ agentDir: config.agentDir, catalog }),
      models: createPiModelCatalog({ agentDir: config.agentDir }),
      projects: createPiProjectResolver({ agentDir: config.agentDir }),
      resources: createPiProjectResources({ agentDir: config.agentDir }),
      files: createFileTree(),
      tmpdir: tmpdir(),
    }),
  };
}
