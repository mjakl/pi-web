import path from "node:path";
import { completeFilePath } from "@/lib/directory-browser";
import { isFilePathQuery } from "@/lib/file-fuzzy";

// Lists names only. Browsing does not grant file-read or upload access.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = params.get("q") ?? "";
  const cwd = params.get("cwd") || undefined;
  if (!isFilePathQuery(query) || (cwd && !path.isAbsolute(cwd))
    || (query.startsWith(".") && !cwd)) {
    return Response.json({ error: "An explicit path and an absolute cwd for relative paths are required" }, { status: 400 });
  }
  try {
    return Response.json({ matches: await completeFilePath(query, cwd) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const status = code === "ENOENT" || code === "ENOTDIR" ? 404
      : code === "EACCES" || code === "EPERM" ? 403 : 500;
    return Response.json({ error: "Cannot list directory" }, { status });
  }
}
