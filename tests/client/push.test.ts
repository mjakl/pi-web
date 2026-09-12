import { describe, expect, it, vi } from "vitest";
import { json, mockFetch, mount, serviceWorker, text } from "./helpers.ts";

// The service worker and Web Push: registered from the page's data attribute,
// and a granted browser subscribed on every load.

class FakeNotification {
  static permission: NotificationPermission = "granted";
}

/** A registration with an active worker and a push manager. */
function registration(existing: unknown = null) {
  const subscription = { toJSON: () => ({ endpoint: "https://push/x" }) };
  return {
    active: {},
    pushManager: {
      getSubscription: vi.fn(() => Promise.resolve(existing)),
      subscribe: vi.fn(
        (_options: {
          userVisibleOnly: boolean;
          applicationServerKey: ArrayBuffer;
        }) => Promise.resolve(subscription),
      ),
    },
  };
}

async function load(options: { granted?: boolean; src?: string } = {}) {
  FakeNotification.permission =
    options.granted === false ? "default" : "granted";
  vi.stubGlobal("Notification", FakeNotification);
  vi.stubGlobal("PushManager", class {});
  mount("");
  if (options.src !== undefined) document.body.dataset["swSrc"] = options.src;
  return import("@web/client/push");
}

describe("the service worker", () => {
  it("is registered from the page's script, bypassing the HTTP cache", async () => {
    const worker = serviceWorker(null);
    const { setUpPush } = await load({ granted: false, src: "/sw.js" });
    setUpPush();
    expect(worker.register).toHaveBeenCalledWith("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
  });

  it("is left alone on a page that ships none", async () => {
    const worker = serviceWorker(null);
    const { setUpPush } = await load({ granted: false });
    setUpPush();
    expect(worker.register).not.toHaveBeenCalled();
  });
});

describe("subscribing", () => {
  it("subscribes a granted browser with the server's key and saves the subscription", async () => {
    const fetch = mockFetch((url) =>
      url === "/push/config" ? json({ publicKey: "AQID" }) : text("", 204),
    );
    const worker = serviceWorker(registration());
    const { setUpPush } = await load({ src: "/sw.js" });
    setUpPush();
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/push/subscribe", expect.anything());
    });
    const saved = fetch.mock.calls.find(
      (call) => call[0] === "/push/subscribe",
    );
    expect(saved?.[1]?.body).toBe(
      JSON.stringify({ subscription: { endpoint: "https://push/x" } }),
    );
    expect(worker.getRegistration).toHaveBeenCalled();
  });

  it("hands the push manager the server's key as bytes", async () => {
    mockFetch((url) =>
      url === "/push/config" ? json({ publicKey: "AQID" }) : text(""),
    );
    const reg = registration();
    serviceWorker(reg);
    const { subscribePush } = await load();
    expect(await subscribePush()).toBe(true);
    const options = reg.pushManager.subscribe.mock.calls[0]?.[0];
    expect(options?.userVisibleOnly).toBe(true);
    expect([...new Uint8Array(options?.applicationServerKey ?? [])]).toEqual([
      1, 2, 3,
    ]);
  });

  it("reuses an existing subscription", async () => {
    mockFetch((url) =>
      url === "/push/config" ? json({ publicKey: "AQID" }) : text(""),
    );
    const existing = { toJSON: () => ({ endpoint: "https://push/old" }) };
    const reg = registration(existing);
    serviceWorker(reg);
    const { subscribePush } = await load();
    expect(await subscribePush()).toBe(true);
    expect(reg.pushManager.subscribe).not.toHaveBeenCalled();
  });

  it("answers false for every reason it cannot happen, and tries again next time", async () => {
    const fetch = mockFetch((url) =>
      url === "/push/config" ? json({ publicKey: "AQID" }) : text("", 500),
    );
    const { subscribePush } = await load({ granted: false });
    expect(await subscribePush()).toBe(false);
    FakeNotification.permission = "granted";
    serviceWorker(null);
    expect(await subscribePush()).toBe(false);
    serviceWorker(registration());
    expect(await subscribePush()).toBe(false);
    expect(fetch).toHaveBeenCalledWith("/push/subscribe", expect.anything());
  });

  it("shares one attempt while it is in flight and keeps a success", async () => {
    const fetch = mockFetch((url) =>
      url === "/push/config" ? json({ publicKey: "AQID" }) : text(""),
    );
    serviceWorker(registration());
    const { subscribePush } = await load();
    const [first, second] = await Promise.all([
      subscribePush(),
      subscribePush(),
    ]);
    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(await subscribePush()).toBe(true);
    expect(
      fetch.mock.calls.filter((call) => call[0] === "/push/config"),
    ).toHaveLength(1);
  });

  it("gives up quietly when the key is missing or the worker is not there", async () => {
    mockFetch(() => json({}));
    serviceWorker(registration());
    const { subscribePush } = await load();
    expect(await subscribePush()).toBe(false);
    vi.stubGlobal("PushManager", undefined);
    expect(await subscribePush()).toBe(false);
  });
});
