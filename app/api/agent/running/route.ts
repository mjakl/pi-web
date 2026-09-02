import { NextResponse } from "next/server";
import { getActiveRpcSessionIds, getRunningRpcSessionIds } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

// GET /api/agent/running - Lightweight snapshot for visible-tab polling.
export async function GET() {
  return NextResponse.json(
    {
      activeSessionIds: getActiveRpcSessionIds(),
      runningSessionIds: getRunningRpcSessionIds(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
