import type { PushMessage, PushNotifier, PushSubscription } from "@core/ports";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import webpush from "web-push";

// Web Push state lives beside Pi's own configuration, in the agent directory
// the caller passes in. Nothing here reads `getAgentDir()`: a test must be
// able to point the whole store at a temporary folder.

const FILE = "web-push.json";

/** Who the push service sees as the sender; no mail is ever delivered there. */
const SUBJECT = "mailto:web-pi@localhost";

type Keys = { publicKey: string; privateKey: string };

type State = { vapidKeys: Keys; subscriptions: PushSubscription[] };

let writes = 0;

/**
 * The private VAPID key is a secret: the file is created owner-only and moved
 * into place, so a reader never sees a half-written store or a wider mode.
 */
function writePrivate(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writes += 1;
  const temporary = `${path}.${String(process.pid)}.${String(writes)}.tmp`;
  writeFileSync(temporary, text, { mode: 0o600, flag: "wx" });
  renameSync(temporary, path);
}

function read(path: string): State | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const state = parsed as Partial<State>;
    if (!state.vapidKeys?.publicKey || !state.vapidKeys.privateKey) return null;
    return {
      vapidKeys: state.vapidKeys,
      subscriptions: Array.isArray(state.subscriptions)
        ? state.subscriptions
        : [],
    };
  } catch {
    // No file yet, or one this version cannot read: start over with new keys.
    return null;
  }
}

/** A subscription the push service has retired; anything else is transient. */
function gone(error: unknown): boolean {
  const status =
    typeof error === "object" && error !== null && "statusCode" in error
      ? (error as { statusCode?: unknown }).statusCode
      : undefined;
  return status === 404 || status === 410;
}

export type WebPushOptions = {
  agentDir: string;
  /** Injected by the tests; the real one talks to the browser's push service. */
  send?: (
    subscription: PushSubscription,
    payload: string,
    keys: Keys,
  ) => Promise<void>;
};

export function createWebPushNotifier(options: WebPushOptions): PushNotifier {
  const path = join(options.agentDir, FILE);
  const state: State = read(path) ?? {
    vapidKeys: webpush.generateVAPIDKeys(),
    subscriptions: [],
  };
  const send =
    options.send ??
    (async (subscription, payload, keys) => {
      await webpush.sendNotification(subscription, payload, {
        vapidDetails: {
          subject: SUBJECT,
          publicKey: keys.publicKey,
          privateKey: keys.privateKey,
        },
      });
    });
  const save = () => {
    writePrivate(path, JSON.stringify(state));
  };

  return {
    publicKey(): string {
      // Reading the key is what first persists a freshly generated pair: a
      // browser cannot subscribe to keys the next restart would throw away.
      save();
      return state.vapidKeys.publicKey;
    },
    subscribe(subscription): void {
      state.subscriptions = [
        ...state.subscriptions.filter(
          (known) => known.endpoint !== subscription.endpoint,
        ),
        {
          endpoint: subscription.endpoint,
          keys: { ...subscription.keys },
        },
      ];
      save();
    },
    async send(message: PushMessage): Promise<void> {
      if (state.subscriptions.length === 0) return;
      const payload = JSON.stringify(message);
      let pruned = false;
      for (const subscription of [...state.subscriptions]) {
        try {
          await send(subscription, payload, state.vapidKeys);
        } catch (error) {
          if (!gone(error)) continue;
          state.subscriptions = state.subscriptions.filter(
            (known) => known.endpoint !== subscription.endpoint,
          );
          pruned = true;
        }
      }
      if (pruned) save();
    },
  };
}
