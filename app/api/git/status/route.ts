import { errorMessage } from "@/lib/error-message";
import { authorizeDirectory } from "@/lib/file-access";
import { getGitStatus } from "@/lib/git-changes";

export async function GET(request: Request) {
  try {
    const cwd = new URL(request.url).searchParams.get("cwd")?.trim() ?? "";
    const authorized = await authorizeDirectory(cwd);
    if ("error" in authorized) {
      return Response.json({ error: authorized.error }, { status: authorized.status });
    }

    return Response.json(await getGitStatus(cwd));
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}
