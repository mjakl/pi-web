import type { PushMessage, PushNotifier, PushSubscription } from "@core/ports";
import {
  migrateWebState,
  readWebState,
  webStatePath,
  writeWebState,
} from "@adapters/fs/web-state";
import { isPushSubscription } from "@core/push";
import { createECDH } from "node:crypto";
import webpush from "web-push";

const FILE = "push.json";

/** Who the push service sees as the sender; no mail is ever delivered there. */
const SUBJECT = "mailto:web-pi@localhost";

type Keys = { publicKey: string; privateKey: string };

type State = { vapidKeys: Keys; subscriptions: PushSubscription[] };

function parseState(value: unknown): State {
  if (!value || typeof value !== "object")
    throw new Error("Invalid push state");
  const state = value as State;
  if (
    typeof state.vapidKeys?.publicKey !== "string" ||
    typeof state.vapidKeys.privateKey !== "string" ||
    !Array.isArray(state.subscriptions) ||
    !state.subscriptions.every(isPushSubscription)
  ) {
    throw new Error("Invalid push state");
  }
  const key = createECDH("prime256v1");
  key.setPrivateKey(Buffer.from(state.vapidKeys.privateKey, "base64url"));
  if (
    !key
      .getPublicKey()
      .equals(Buffer.from(state.vapidKeys.publicKey, "base64url"))
  )
    throw new Error("Invalid VAPID pair");
  return state;
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
  migrateWebState(options.agentDir, "web-push.json", FILE, parseState);
  const path = webStatePath(options.agentDir, FILE);
  let state: State = readWebState(path, parseState) ?? {
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
  const save = (next: State = state) => {
    writeWebState(path, next);
    state = next;
  };

  return {
    publicKey(): string {
      // Reading the key is what first persists a freshly generated pair: a
      // browser cannot subscribe to keys the next restart would throw away.
      save();
      return state.vapidKeys.publicKey;
    },
    subscribe(subscription): void {
      const subscriptions = [
        ...state.subscriptions.filter(
          (known) => known.endpoint !== subscription.endpoint,
        ),
        {
          endpoint: subscription.endpoint,
          keys: { ...subscription.keys },
        },
      ];
      save({ ...state, subscriptions });
    },
    has(subscription): boolean {
      return state.subscriptions.some(
        (known) =>
          known.endpoint === subscription.endpoint &&
          known.keys.p256dh === subscription.keys.p256dh &&
          known.keys.auth === subscription.keys.auth,
      );
    },
    unsubscribe(subscription): void {
      save({
        ...state,
        subscriptions: state.subscriptions.filter(
          (known) =>
            !(
              known.endpoint === subscription.endpoint &&
              known.keys.p256dh === subscription.keys.p256dh &&
              known.keys.auth === subscription.keys.auth
            ),
        ),
      });
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
