import { NextResponse } from "next/server";
import {
  attachSessionProjectInfo,
  listAllSessions,
  mergeSessionLists,
} from "@/lib/session-reader";
import {
  getRpcSessionInfos,
  getRunningRpcSessionIds,
} from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [persistedSessions, runtimeSessions] = await Promise.all([
      listAllSessions(),
      attachSessionProjectInfo(getRpcSessionInfos()),
    ]);
    const sessions = mergeSessionLists(persistedSessions, runtimeSessions).map((session) => {
      const inventory = { ...session };
      if (!inventory.transient) {
        delete inventory.name;
        delete inventory.messageCount;
        delete inventory.firstMessage;
      }
      return inventory;
    });
    return NextResponse.json(
      {
        sessions,
        runningSessionIds: getRunningRpcSessionIds(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
