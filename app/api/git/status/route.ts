import { NextRequest, NextResponse } from "next/server";
import { authorizeDirectory } from "@/lib/file-access";
import { getGitStatus } from "@/lib/git-changes";

export async function GET(request: NextRequest) {
  try {
    const cwd = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
    const authorized = await authorizeDirectory(cwd);
    if ("error" in authorized) {
      return NextResponse.json({ error: authorized.error }, { status: authorized.status });
    }

    return NextResponse.json(await getGitStatus(cwd));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
