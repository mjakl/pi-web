import { errorMessage } from "@/lib/error-message";
import { getAllowedFileRoots } from "@/lib/file-access";
import { isExistingPathWithinRoots, isPathWithinRoots } from "@/lib/path-security";
import { isAbsolutePath } from "@/lib/paths";
import { getGitFileDiff } from "@/lib/git-changes";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const cwd = params.get("cwd")?.trim() ?? "";
    const filePath = params.get("path")?.trim() ?? "";
    if (!cwd || !isAbsolutePath(cwd)) {
      return Response.json({ error: "cwd must be an absolute path" }, { status: 400 });
    }
    if (!filePath || !isAbsolutePath(filePath)) {
      return Response.json({ error: "path must be an absolute path" }, { status: 400 });
    }

    const allowedRoots = await getAllowedFileRoots();
    if (!isPathWithinRoots(cwd, allowedRoots) || !isPathWithinRoots(filePath, allowedRoots)) {
      return Response.json({ error: "Access denied" }, { status: 403 });
    }
    // The cwd must resolve inside an allowed root. The file itself may no
    // longer exist when Git reports it as deleted; getGitFileDiff verifies
    // that the requested path belongs to this repository and its status.
    if (!isExistingPathWithinRoots(cwd, allowedRoots)) {
      return Response.json({ error: "Access denied" }, { status: 403 });
    }

    return Response.json(await getGitFileDiff(cwd, filePath));
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}
