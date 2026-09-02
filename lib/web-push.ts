import { existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import webpush from "web-push";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { enMessages } from "./i18n/messages/en";
import { readSessionRowMetadata } from "./session-metadata";
import { resolveSessionPath } from "./session-reader";

export interface PushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  locale?: string;
}

interface PushStateFile {
  vapidKeys: { publicKey: string; privateKey: string };
  subscriptions: PushSubscriptionRecord[];
}

interface WebPushEnvironment {
  send: (
    subscription: PushSubscriptionRecord,
    payload: string,
    vapidKeys: PushStateFile["vapidKeys"],
  ) => Promise<void>;
  loadState: () => PushStateFile | null;
  saveState: (state: PushStateFile) => void;
  generateVapidKeys: () => PushStateFile["vapidKeys"];
  getSessionName: (sessionId: string) => Promise<string | undefined>;
}

export interface WebPushNotifier {
  getVapidPublicKey: () => string;
  addSubscription: (subscription: PushSubscriptionRecord) => void;
  notifySessionComplete: (sessionId: string) => Promise<void>;
}

function stateFilePath(): string {
  return join(getAgentDir(), "web-push.json");
}

function getDefaultEnvironment(): WebPushEnvironment {
  return {
    async send(subscription, payload, vapidKeys) {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: subscription.keys },
        payload,
        {
          vapidDetails: {
            subject: "mailto:pi-web@localhost",
            publicKey: vapidKeys.publicKey,
            privateKey: vapidKeys.privateKey,
          },
        },
      );
    },
    loadState() {
      const path = stateFilePath();
      if (!existsSync(path)) return null;
      try {
        return JSON.parse(readFileSync(path, "utf8")) as PushStateFile;
      } catch {
        return null;
      }
    },
    saveState(state) {
      const path = stateFilePath();
      mkdirSync(dirname(path), { recursive: true });
      writePrivateFileAtomicSync(path, JSON.stringify(state));
    },
    generateVapidKeys: () => webpush.generateVAPIDKeys(),
    async getSessionName(sessionId) {
      try {
        const filePath = await resolveSessionPath(sessionId);
        if (!filePath) return undefined;
        return (await readSessionRowMetadata(filePath, sessionId))?.name;
      } catch {
        // Session naming is best-effort; fall back to the generic title.
        return undefined;
      }
    },
  };
}

function pushStatusCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) return undefined;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode === "number" ? statusCode : undefined;
}

export function createWebPushNotifier(environment: WebPushEnvironment): WebPushNotifier {
  const state: PushStateFile = (() => {
    const loaded = environment.loadState();
    if (loaded?.vapidKeys?.publicKey && loaded.vapidKeys.privateKey) return loaded;
    return { vapidKeys: environment.generateVapidKeys(), subscriptions: [] };
  })();
  const saveState = () => {
    environment.saveState(state);
  };

  return {
    getVapidPublicKey() {
      saveState();
      return state.vapidKeys.publicKey;
    },
    addSubscription(subscription) {
      state.subscriptions = [
        ...state.subscriptions.filter((s) => s.endpoint !== subscription.endpoint),
        subscription,
      ];
      saveState();
    },
    async notifySessionComplete(sessionId) {
      if (state.subscriptions.length === 0) return;
      const sessionName = await environment.getSessionName(sessionId);
      const payload = JSON.stringify({
        title: sessionName ?? enMessages["i18n.sessionComplete"] ?? "Session complete",
        body: enMessages["i18n.taskFinished"] ?? "Task finished.",
        url: `/?session=${encodeURIComponent(sessionId)}`,
        tag: `pi-session-complete:${sessionId}`,
      });

      let pruned = false;
      for (const subscription of [...state.subscriptions]) {
        try {
          await environment.send(subscription, payload, state.vapidKeys);
        } catch (error) {
          const statusCode = pushStatusCode(error);
          if (statusCode === 404 || statusCode === 410) {
            state.subscriptions = state.subscriptions.filter((s) => s.endpoint !== subscription.endpoint);
            pruned = true;
          }
        }
      }
      if (pruned) saveState();
    },
  };
}

declare global {
  var __piWebPushNotifier: Promise<WebPushNotifier> | undefined;
}

function getNotifier(): Promise<WebPushNotifier> {
  if (!globalThis.__piWebPushNotifier) {
    globalThis.__piWebPushNotifier = Promise.resolve().then(() => createWebPushNotifier(getDefaultEnvironment()));
  }
  return globalThis.__piWebPushNotifier;
}

export function getVapidPublicKey(): Promise<string> {
  return getNotifier().then((notifier) => notifier.getVapidPublicKey());
}

export function addSubscription(subscription: PushSubscriptionRecord): Promise<void> {
  return getNotifier().then((notifier) => notifier.addSubscription(subscription));
}

export async function notifySessionComplete(sessionId: string): Promise<void> {
  const notifier = await getNotifier();
  await notifier.notifySessionComplete(sessionId);
}
