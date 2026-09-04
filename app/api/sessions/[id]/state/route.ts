import { getRpcSession, isRpcSessionActive } from "@/lib/rpc-manager";
import { resolveSessionPath } from "@/lib/session-reader";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const rpc = getRpcSession(id);
    if (rpc && isRpcSessionActive(rpc)) {
      const state = await rpc.send({ type: "get_state" });
      return Response.json({ active: true, running: rpc.isRunning(), state });
    }

    if (!await resolveSessionPath(id)) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }
    return Response.json({ active: false, running: false });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
