import { createAgentEventStream } from "@/lib/agent-event-stream";
import { resolveSessionPath } from "@/lib/session-reader";
import {
  activateRpcSession,
  beginRpcSessionOperation,
  getRpcSession,
} from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

// GET /api/agent/[id]/events - SSE stream of agent events
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const operation = beginRpcSessionOperation(id);
  if (req.signal.aborted) return new Response(null, { status: 204 });

  const activeSession = getRpcSession(id);
  let sessionPromise;
  if (activeSession?.isActive()) {
    sessionPromise = Promise.resolve(activeSession);
  } else {
    const filePath = await resolveSessionPath(id);
    if (!filePath) return new Response("Session not found", { status: 404 });
    const activate = new URL(req.url).searchParams.has("activate");
    if (!activate) return new Response("Session is stopped", { status: 409 });
    if (req.signal.aborted) return new Response(null, { status: 204 });
    sessionPromise = activateRpcSession(operation, filePath);
  }

  const stream = createAgentEventStream(req, id, sessionPromise);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
