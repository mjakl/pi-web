import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { completeFilePath } from "@/lib/directory-browser";
import { isFilePathQuery } from "@/lib/file-fuzzy";

// Lists names only. Browsing does not grant file-read or upload access.
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") ?? "";
  const cwd = request.nextUrl.searchParams.get("cwd") || undefined;
  if (!isFilePathQuery(query) || (cwd && !path.isAbsolute(cwd))
    || (query.startsWith(".") && !cwd)) {
    return NextResponse.json({ error: "An explicit path and an absolute cwd for relative paths are required" }, { status: 400 });
  }
  try {
    return NextResponse.json({ matches: await completeFilePath(query, cwd) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const status = code === "ENOENT" || code === "ENOTDIR" ? 404
      : code === "EACCES" || code === "EPERM" ? 403 : 500;
    return NextResponse.json({ error: "Cannot list directory" }, { status });
  }
}
