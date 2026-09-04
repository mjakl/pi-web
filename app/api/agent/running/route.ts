import { getActiveRpcSessionIds, getRunningRpcSessionIds } from "@/lib/rpc-manager";

// GET /api/agent/running - Lightweight snapshot for visible-tab polling.
export async function GET() {
  return Response.json(
    {
      activeSessionIds: getActiveRpcSessionIds(),
      runningSessionIds: getRunningRpcSessionIds(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
