import { statSync, type Stats } from "fs";
import { allowFileRoot } from "@/lib/file-access";
import { normalizeDirectory } from "@/lib/directory-browser";
import { pathIdentityKey } from "@/lib/paths";
import { resolveProject } from "@/lib/worktree";

// POST /api/cwd/validate  body: { cwd: string }
// Validates a candidate workspace before the UI selects it.
export async function POST(req: Request) {
  try {
    const body = await req.json() as { cwd?: unknown };
    const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";

    if (!cwd) {
      return Response.json({ error: "Path is required" }, { status: 400 });
    }

    const normalizedCwd = normalizeDirectory(cwd);
    let stat: Stats;
    try {
      stat = statSync(normalizedCwd);
    } catch {
      return Response.json({ error: `Directory does not exist: ${cwd}` }, { status: 400 });
    }

    if (!stat.isDirectory()) {
      return Response.json({ error: `Path is not a directory: ${cwd}` }, { status: 400 });
    }

    allowFileRoot(normalizedCwd);
    const project = await resolveProject(normalizedCwd);
    return Response.json({
      success: true,
      cwd: normalizedCwd,
      projectRoot: project.projectRoot,
      projectKey: pathIdentityKey(project.projectRoot),
    });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
