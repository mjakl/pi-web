import { NextResponse } from "next/server";
import { resolveSessionPath } from "@/lib/session-reader";
import {
  beginRpcSessionOperation,
  getRpcSession,
  isRpcSessionActive,
  sendRpcSessionCommand,
  setRpcSessionTools,
  stopRpcSession,
} from "@/lib/rpc-manager";

// POST /api/agent/[id] - Send a command to an existing or persisted session
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const operation = beginRpcSessionOperation(id);
  let commandType: string | undefined;
  let promptAccepted = false;

  try {
    const body = await req.json() as { type: string; [key: string]: unknown };
    commandType = typeof body.type === "string" ? body.type : undefined;
    const requestedToolNames = body.toolNames;
    if (
      requestedToolNames !== undefined
      && (!Array.isArray(requestedToolNames) || requestedToolNames.some((name) => typeof name !== "string"))
    ) {
      throw new Error("toolNames must be an array of strings");
    }
    const toolNames = requestedToolNames as string[] | undefined;
    const existing = getRpcSession(id);
    const filePath = existing?.sessionFile || await resolveSessionPath(id) || undefined;

    if (body.type === "set_tools") {
      if (!isRpcSessionActive(existing) && !filePath) {
        return NextResponse.json({ error: "Session not found" }, { status: 404 });
      }
      const changed = await setRpcSessionTools(operation, filePath, toolNames);
      return NextResponse.json({
        success: true,
        data: { sessionId: changed.sessionId, recreated: changed.recreated },
      });
    }

    if (!isRpcSessionActive(existing) && !filePath) {
      return NextResponse.json({
        error: "Session not found",
        ...(body.type === "prompt"
          ? { code: "prompt_rejected", accepted: false }
          : {}),
      }, { status: 404 });
    }

    const result = await sendRpcSessionCommand(operation, filePath, body, {
      ...(toolNames !== undefined ? { toolNames } : {}),
    });
    promptAccepted = body.type === "prompt";
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : String(error),
      ...(commandType === "prompt" && !promptAccepted
        ? { code: "prompt_rejected", accepted: false }
        : {}),
    }, { status: 500 });
  }
}

// GET /api/agent/[id] - Get current runtime state without starting it
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const session = getRpcSession(id);
    if (!session || !isRpcSessionActive(session)) {
      return NextResponse.json({ active: false, running: false });
    }

    const state = await session.send({ type: "get_state" });
    return NextResponse.json({ active: true, running: session.isRunning(), state });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/agent/[id] - Stop a runtime without deleting its transcript
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const [stopped, filePath] = await Promise.all([
      stopRpcSession(id),
      resolveSessionPath(id),
    ]);
    if (!stopped && !filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    return NextResponse.json({ stopped });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
