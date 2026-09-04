import { NextResponse } from "next/server";
import { findCurrentWorktreePath, isWorkingDirectoryAvailable, listWorktrees, resolveProject } from "@/lib/worktree";
import { allowFileRoot, getAllowedFileRoots } from "@/lib/file-access";
import { isExistingPathWithinRoots, isPathWithinRoots } from "@/lib/path-security";
import { pathIdentityKey } from "@/lib/paths";

/** Same gate as /api/files: only session cwds / project roots / explicitly
 *  allowed dirs may be inspected through this endpoint. */
async function checkCwdAllowed(cwd: string): Promise<NextResponse | null> {
  const allowedRoots = await getAllowedFileRoots();
  if (!isPathWithinRoots(cwd, allowedRoots) || !isExistingPathWithinRoots(cwd, allowedRoots)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  return null;
}

// GET /api/worktrees?cwd=  →  { projectRoot, projectKey, isGit, isTopLevel, currentWorktreePath, worktrees }
export async function GET(req: Request) {
  try {
    const cwd = new URL(req.url).searchParams.get("cwd");
    if (!cwd) {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }
    const denied = await checkCwdAllowed(cwd);
    if (denied) return denied;

    const project = await resolveProject(cwd, true);
    let worktrees: Awaited<ReturnType<typeof listWorktrees>> = [];
    let currentWorktreePath: string | null = null;
    let isGit = true;
    try {
      // For a removed-worktree cwd (session of a deleted worktree), fall back
      // to the known repository so its other folders remain selectable.
      worktrees = await listWorktrees(isWorkingDirectoryAvailable(cwd) ? cwd : project.projectRoot);
      currentWorktreePath = findCurrentWorktreePath(worktrees, cwd);
    } catch {
      isGit = false;
    }
    // Every listed path is a git-verified worktree of this project; allow the
    // file explorer to browse them even before they have any session.
    // Listing also restores access after server restarts.
    for (const w of worktrees) allowFileRoot(w.path);
    return NextResponse.json({
      cwdAvailable: isWorkingDirectoryAvailable(cwd),
      projectRoot: project.projectRoot,
      projectKey: pathIdentityKey(project.projectRoot),
      isGit,
      isTopLevel: project.isTopLevel,
      currentWorktreePath,
      worktrees,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
