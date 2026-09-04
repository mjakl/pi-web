import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { authorizeDirectory } from "@/lib/file-access";
import { invalidateModelsCache } from "@/lib/models-cache";
import { getProjectTrustStatus, trustProject } from "@/lib/project-trust";
import { destroyRpcSessionsForCwd, hasBusyRpcSessionForCwd } from "@/lib/rpc-manager";

export async function GET(req: Request) {
  const authorized = await authorizeDirectory(new URL(req.url).searchParams.get("cwd")?.trim() ?? "");
  if ("error" in authorized) {
    return Response.json({ error: authorized.error }, { status: authorized.status });
  }
  return Response.json(getProjectTrustStatus(authorized.directory, getAgentDir()));
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as { cwd?: unknown };
    const authorized = await authorizeDirectory(typeof body.cwd === "string" ? body.cwd.trim() : "");
    if ("error" in authorized) {
      return Response.json({ error: authorized.error }, { status: authorized.status });
    }
    const cwd = authorized.directory;

    const agentDir = getAgentDir();
    const current = getProjectTrustStatus(cwd, agentDir);
    if (!current.requiresTrust) {
      return Response.json({ error: "This project has no resources that require trust" }, { status: 409 });
    }
    if (hasBusyRpcSessionForCwd(cwd)) {
      return Response.json({ error: "Wait for the active session to finish before trusting this project" }, { status: 409 });
    }

    const status = trustProject(cwd, agentDir);
    invalidateModelsCache();
    await destroyRpcSessionsForCwd(cwd);
    return Response.json(status);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
