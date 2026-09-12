import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A throwaway agent directory and project folder for one test. The root is
// also HOME while it lives: the SDK's resource loader reads ~/.agents/skills
// from HOME whatever the agent directory is, so without this every listing
// and every session would see the developer's own skills.

export type TempAgent = Awaited<ReturnType<typeof createTempAgent>>;

export async function createTempAgent(prefix: string) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const agentDir = join(root, "agent");
  const project = join(root, "project");
  await mkdir(agentDir);
  await mkdir(project);
  const home = process.env["HOME"];
  process.env["HOME"] = root;
  return {
    root,
    agentDir,
    project,
    async dispose(): Promise<void> {
      if (home === undefined) delete process.env["HOME"];
      else process.env["HOME"] = home;
      await rm(root, { recursive: true, force: true });
    },
  };
}
