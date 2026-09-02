import { NextResponse } from "next/server";
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
      return NextResponse.json({ active: true, running: rpc.isRunning(), state });
    }

    if (!await resolveSessionPath(id)) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    return NextResponse.json({ active: false, running: false });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
