// The service worker and Web Push. Together they are the only way a finished
// run reaches a reader whose tab is closed; everything else here already
// assumes a page is open.

function registerWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  const src = document.body.dataset["swSrc"];
  if (src === undefined) return;
  const register = () => {
    // `updateViaCache: "none"` keeps the browser's HTTP cache out of the
    // worker's own script, so a new build is always picked up.
    void navigator.serviceWorker
      .register(src, { scope: "/", updateViaCache: "none" })
      .catch(() => {
        // An insecure origin or a blocked worker: the app works without it.
      });
  };
  if (document.readyState === "complete") register();
  else addEventListener("load", register, { once: true });
}

/** The VAPID key, base64url as the server sends it, as the bytes subscribe wants. */
function keyBytes(base64: string): ArrayBuffer {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replaceAll("-", "+")
    .replaceAll("_", "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.codePointAt(index) ?? 0;
  }
  return bytes.buffer;
}

let attempt: Promise<boolean> | null = null;

/**
 * Subscribes this browser to push. Returns false for every reason it cannot
 * happen — no permission, no worker, no key — so a failure is never cached as
 * a permanent one: the next call tries again.
 */
export function subscribePush(): Promise<boolean> {
  attempt ??= (async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      return false;
    }
    if (!("Notification" in window) || Notification.permission !== "granted") {
      return false;
    }
    // Deliberately not `.ready`: it never settles when no worker is
    // registered, which would leave this promise pending forever.
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration?.active) return false;
    const response = await fetch("/push/config");
    if (!response.ok) return false;
    const { publicKey } = (await response.json()) as { publicKey?: string };
    if (!publicKey) return false;
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(publicKey),
      }));
    const saved = await fetch("/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    });
    return saved.ok;
  })()
    .catch(() => false)
    .then((ok) => {
      if (!ok) attempt = null;
      return ok;
    });
  return attempt;
}

export function setUpPush(): void {
  registerWorker();
  // pi-web has no switch for this: a browser that granted notifications is
  // subscribed, and re-subscribed on every load, because the push service may
  // have retired the old endpoint while this tab was away (AppShell.tsx L106).
  if (
    "Notification" in window &&
    Notification.permission === "granted" &&
    document.body.dataset["swSrc"] !== undefined
  ) {
    void subscribePush();
  }
}
