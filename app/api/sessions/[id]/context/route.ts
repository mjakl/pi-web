import { SessionManager } from "@earendil-works/pi-coding-agent";
import { resolveSessionPath, buildSessionContext } from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-manager";
import { SESSION_TAIL_DEFAULT, SESSION_TAIL_MAX } from "@/lib/chat-lazy-load";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  const leafId = url.searchParams.get("leafId") ?? undefined;
  const deferThinking = url.searchParams.has("deferThinking");
  const deferToolResultImages = url.searchParams.has("deferMedia");
  // `tail` caps the ancestor chain returned (default 50); `before` rewinds the
  // walk start to an older entry so the client can page upward without
  // re-fetching the whole active branch.
  const rawTail = Number(url.searchParams.get("tail"));
  const tail = Number.isFinite(rawTail) && rawTail > 0 ? Math.min(rawTail, SESSION_TAIL_MAX) : SESSION_TAIL_DEFAULT;
  const before = url.searchParams.get("before") ?? undefined;
  const throughEntryId = url.searchParams.get("through") ?? undefined;
  if (throughEntryId && !before) {
    return Response.json({ error: "A history cursor is required" }, { status: 400 });
  }

  try {
    const rpc = getRpcSession(id);
    const liveRpc = rpc?.isAlive() ? rpc : undefined;
    const filePath = liveRpc ? null : await resolveSessionPath(id);
    if (!liveRpc && !filePath) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    const sm = liveRpc?.inner.sessionManager ?? SessionManager.open(filePath!);
    // `before` is the oldest entry already on the client; fetch its ancestors
    // only (excludeLeaf) so prepending the page does not duplicate `before`.
    const context = buildSessionContext(sm.getEntries() as never, before ?? leafId, {
      deferThinking,
      deferToolResultImages,
      tail,
      excludeLeaf: Boolean(before),
      throughEntryId,
      sessionId: id,
    });

    return Response.json({ context, tail, before: before ?? null });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: error instanceof RangeError ? 400 : 500 });
  }
}
