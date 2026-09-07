import { resolveSessionPath } from "@/lib/session-reader";
import { beginRpcSessionOperation, setRpcSessionStar } from "@/lib/rpc-manager";
import { errorMessage } from "@/lib/error-message";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const operation = beginRpcSessionOperation(id);
  try {
    const body = (await req.json()) as {
      targetId?: unknown;
      starred?: unknown;
    };
    if (typeof body.targetId !== "string" || typeof body.starred !== "boolean")
      return Response.json(
        { error: "targetId and starred are required" },
        { status: 400 },
      );
    const filePath = await resolveSessionPath(id);
    if (!filePath)
      return Response.json({ error: "Session not found" }, { status: 404 });
    const result = await setRpcSessionStar(
      operation,
      filePath,
      body.targetId,
      body.starred,
    );
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 400 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const operation = beginRpcSessionOperation(id);
  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath)
      return Response.json({ error: "Session not found" }, { status: 404 });
    return Response.json(
      await setRpcSessionStar(operation, filePath, null, false),
    );
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 400 });
  }
}
