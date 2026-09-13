import { setUpRegion } from "./lifecycle.ts";

/** No serviceWorker.ready: registration failure must end in an actionable state. */
async function activeWorker(
  registration: ServiceWorkerRegistration,
): Promise<ServiceWorkerRegistration> {
  if (registration.active?.state === "activated") return registration;
  const worker =
    registration.installing ?? registration.waiting ?? registration.active;
  if (!worker)
    throw new Error("Service worker did not start. Reload to try again.");
  await new Promise<void>((resolve, reject) => {
    const done = (error?: Error) => {
      clearTimeout(timer);
      worker.removeEventListener("statechange", check);
      if (error) reject(error);
      else resolve();
    };
    const check = () => {
      if (worker.state === "activated") done();
      else if (worker.state === "redundant")
        done(
          new Error("Service worker activation failed. Reload to try again."),
        );
    };
    const timer = setTimeout(() => {
      done(
        new Error("Service worker activation timed out. Reload to try again."),
      );
    }, 10_000);
    worker.addEventListener("statechange", check);
    check();
  });
  return registration;
}

function keyBytes(base64: string): ArrayBuffer {
  const binary = atob(base64.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
}

async function request(path: string, body?: unknown): Promise<Response> {
  const response = await fetch(path, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  if (!response.ok)
    throw new Error(
      "Server request failed. Check the connection, then reload settings to check enrollment.",
    );
  return response;
}

function unavailable(): string | undefined {
  if (!window.isSecureContext) return "Unavailable: use HTTPS (or localhost).";
  if (
    !("Notification" in window) ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window)
  ) {
    return "Unavailable in this browser. On iPhone or iPad, add web-pi to the Home Screen and open it there.";
  }
  return undefined;
}

// Reopening General must wait for an already authorized enrollment change.
let changing: Promise<void> = Promise.resolve();

export function setUpPush(): void {
  const src = document.body.dataset["swSrc"];
  // Keep offline support independent of notification capability or permission.
  const worker =
    src && window.isSecureContext && "serviceWorker" in navigator
      ? navigator.serviceWorker
          .register(src, { scope: "/", updateViaCache: "none" })
          .then(activeWorker)
      : Promise.reject(
          new Error(
            "Service worker unavailable. Reload from HTTPS to try again.",
          ),
        );
  // The General tab may never open; its absence must not cause an unhandled rejection.
  void worker.catch(() => undefined);

  setUpRegion("#push-settings", (region, signal) => {
    const button = region.querySelector<HTMLButtonElement>("#push-toggle");
    const status = region.querySelector<HTMLElement>("#push-status");
    if (!button || !status) return;
    let registration: ServiceWorkerRegistration;
    let publicKey: string;
    let applicationServerKey: ArrayBuffer;
    let subscription: PushSubscription | null = null;
    let action: "subscribe" | "unsubscribe" = "subscribe";
    let busy = true;
    const show = (message: string, enabled: boolean) => {
      status.textContent = message;
      button.disabled = !enabled;
      button.textContent =
        action === "unsubscribe" ? "Unsubscribe" : "Subscribe";
    };
    const blocked = () => {
      if (Notification.permission !== "denied") return false;
      show(
        "Blocked: allow notifications in this site's browser or system settings, then reopen General.",
        false,
      );
      return true;
    };
    const prepare = async () => {
      const reason = unavailable();
      if (reason) {
        show(reason, false);
        return;
      }
      if (blocked()) return;
      show("Checking availability…", false);
      try {
        const [ready, config] = await Promise.all([
          worker,
          request("/push/config"),
        ]);
        registration = ready;
        if (!registration.pushManager) {
          show("Unavailable: this service worker has no push support.", false);
          return;
        }
        const data = (await config.json()) as { publicKey?: unknown };
        if (typeof data.publicKey !== "string" || !data.publicKey)
          throw new Error("Push key unavailable. Reload to try again.");
        publicKey = data.publicKey;
        applicationServerKey = keyBytes(publicKey);
        await changing;
        subscription = await registration.pushManager.getSubscription();
        if (signal.aborted) return;
        const oldKey = subscription?.options.applicationServerKey;
        if (
          oldKey &&
          (oldKey.byteLength !== applicationServerKey.byteLength ||
            new Uint8Array(oldKey).some(
              (byte, i) => byte !== new Uint8Array(applicationServerKey)[i],
            ))
        ) {
          action = "unsubscribe";
          show(
            "Server identity changed. Unsubscribe the old browser subscription, then subscribe again.",
            true,
          );
        } else {
          const enrolled = subscription
            ? (
                (await (
                  await request("/push/status", {
                    subscription: subscription.toJSON(),
                  })
                ).json()) as { subscribed: boolean }
              ).subscribed
            : false;
          action = enrolled ? "unsubscribe" : "subscribe";
          show(
            enrolled
              ? "Subscribed on this browser."
              : "Not subscribed on this browser.",
            true,
          );
        }
        busy = false;
      } catch {
        show(
          "Could not prepare push notifications. Check the connection and reload to try again.",
          false,
        );
      }
    };
    void prepare();

    button.addEventListener(
      "click",
      () => {
        if (busy || blocked()) return;
        busy = true;
        show(
          action === "unsubscribe" ? "Unsubscribing…" : "Subscribing…",
          false,
        );
        // Invoke subscribe synchronously from the click, with the worker and key
        // already prepared. Awaiting permission/config first loses Apple's gesture.
        let operation: Promise<void>;
        if (action === "subscribe") {
          try {
            operation = registration.pushManager
              .subscribe({ userVisibleOnly: true, applicationServerKey })
              .then(async (created) => {
                subscription = created;
                await request("/push/subscribe", {
                  subscription: created.toJSON(),
                  publicKey,
                });
                action = "unsubscribe";
                show("Subscribed on this browser.", true);
              });
          } catch (error) {
            operation = Promise.reject(
              error instanceof Error
                ? error
                : new Error("Browser subscription failed"),
            );
          }
        } else {
          operation = (async () => {
            if (subscription) {
              await request("/push/unsubscribe", {
                subscription: subscription.toJSON(),
              });
              const removed = await subscription.unsubscribe();
              if (
                !removed &&
                (await registration.pushManager.getSubscription())
              )
                throw new Error(
                  "Browser unsubscribe failed. Try Unsubscribe again.",
                );
            }
            subscription = null;
            action = "subscribe";
            show("Not subscribed on this browser.", true);
          })();
        }
        changing = operation
          .catch(() => {
            if (!blocked())
              show(
                action === "unsubscribe"
                  ? "Could not finish unsubscribing. Try Unsubscribe again."
                  : "Subscription not confirmed by the server. Try Subscribe again, or reload to check enrollment.",
                true,
              );
          })
          .finally(() => {
            busy = false;
          });
      },
      { signal },
    );
  });
}
