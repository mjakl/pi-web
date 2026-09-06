import { addSubscription, type PushSubscriptionRecord } from "@/lib/web-push";

import { isRecord } from "@/lib/types";

function isValidSubscription(
  subscription: unknown,
): subscription is PushSubscriptionRecord {
  if (!isRecord(subscription)) return false;
  if (
    typeof subscription["endpoint"] !== "string" ||
    !/^https:\/\//.test(subscription["endpoint"])
  )
    return false;
  const keys = subscription["keys"];
  if (!isRecord(keys)) return false;
  return (
    typeof keys["p256dh"] === "string" &&
    keys["p256dh"].length > 0 &&
    typeof keys["auth"] === "string" &&
    keys["auth"].length > 0
  );
}

// POST /api/push/subscribe - register a browser push subscription. Upserts by
// endpoint, so the client can safely re-send its subscription on every load.
export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const subscription = isRecord(body) ? body["subscription"] : undefined;
  if (!isValidSubscription(subscription)) {
    return Response.json(
      { error: "Invalid push subscription" },
      { status: 400 },
    );
  }

  await addSubscription({
    endpoint: subscription.endpoint,
    keys: subscription.keys,
  });
  return Response.json({ ok: true });
}
