import { describe, expect, it, vi } from "vitest";
import {
  byId,
  click,
  FakeAudioContext,
  flush,
  htmxEvent,
  mount,
  query,
  serviceWorker,
} from "./helpers.ts";

// What a finished run does in the browser: the tone, the one-time offer to
// notify, the notification itself when nobody is watching, and the memory of
// which session was open in which workspace.

class FakeNotification {
  static permission: NotificationPermission = "default";
  static requestPermission = vi.fn(() => Promise.resolve("granted" as const));
  static shown: { title: string; options: unknown }[] = [];
  constructor(title: string, options: unknown) {
    FakeNotification.shown.push({ title, options });
  }
}

function notifications(
  permission: NotificationPermission,
): typeof FakeNotification {
  FakeNotification.permission = permission;
  FakeNotification.shown = [];
  FakeNotification.requestPermission.mockClear();
  vi.stubGlobal("Notification", FakeNotification);
  return FakeNotification;
}

async function load(html = ""): Promise<void> {
  mount(
    `<main data-session-id="s1"><h1 data-page-title> Fix the tests </h1><div id="toasts"></div>` +
      `<div id="session-done" hidden></div><div id="extension-dialog"></div>` +
      `<div id="session-finished" hidden></div>${html}</main>`,
  );
  const { setUpNotifications } = await import("@web/client/notify");
  setUpNotifications();
}

function done(id = "s1"): void {
  const target = byId("session-done");
  target.textContent = id;
  htmxEvent(target, "htmx:afterSwap");
}

function unwatched(): void {
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
}

describe("the tone", () => {
  it("plays two notes when the run on screen finishes, once the page was touched", async () => {
    await load();
    document.dispatchEvent(new Event("pointerdown"));
    done();
    expect(FakeAudioContext.played).toBe(2);
    expect(byId("session-done").childNodes).toHaveLength(0);
  });

  it("stays quiet when the preference is off", async () => {
    localStorage.setItem("web-pi:sound", "false");
    await load();
    document.dispatchEvent(new Event("keydown"));
    done();
    expect(FakeAudioContext.played).toBe(0);
  });

  it("plays for a run that finished in another session, not for this one", async () => {
    await load();
    const finished = (id: string) => {
      byId("session-finished").textContent = JSON.stringify({ id });
      htmxEvent(byId("session-finished"), "htmx:afterSwap");
    };
    finished("s1");
    expect(FakeAudioContext.played).toBe(0);
    finished("s2");
    expect(FakeAudioContext.played).toBe(2);
    byId("session-finished").textContent = "not json";
    htmxEvent(byId("session-finished"), "htmx:afterSwap");
    expect(FakeAudioContext.played).toBe(2);
  });
});

describe("the offer to notify", () => {
  it("is made once, only when a run finished unwatched", async () => {
    const notification = notifications("default");
    await load();
    done();
    expect(byId("toasts").childElementCount).toBe(0);
    unwatched();
    done();
    expect(byId("toasts").textContent).toContain(
      "Notify you when a run finishes?",
    );
    expect(localStorage.getItem("web-pi:notify-asked")).toBe("1");
    click(query("#toasts button"));
    expect(notification.requestPermission).toHaveBeenCalledOnce();
    expect(byId("toasts").childElementCount).toBe(0);
    done();
    expect(byId("toasts").childElementCount).toBe(0);
  });

  it("can be declined", async () => {
    notifications("default");
    await load();
    unwatched();
    done();
    const decline = document.querySelectorAll("#toasts button")[1];
    if (!decline) throw new Error("no decline button");
    click(decline);
    expect(byId("toasts").childElementCount).toBe(0);
  });

  it("is never made once permission was decided", async () => {
    notifications("denied");
    await load();
    unwatched();
    done();
    expect(byId("toasts").childElementCount).toBe(0);
    expect(localStorage.getItem("web-pi:notify-asked")).toBeNull();
  });
});

describe("the notification", () => {
  it("goes through the service worker where one is registered", async () => {
    notifications("granted");
    const registration = { showNotification: vi.fn(() => Promise.resolve()) };
    serviceWorker(registration);
    await load();
    unwatched();
    done("s1");
    await flush();
    expect(registration.showNotification).toHaveBeenCalledWith(
      "Fix the tests",
      {
        body: "Task finished.",
        tag: "web-pi:done:s1",
      },
    );
  });

  it("is constructed directly without a worker, and skipped while watched", async () => {
    const notification = notifications("granted");
    serviceWorker(null);
    await load();
    done();
    await flush();
    expect(notification.shown).toHaveLength(0);
    unwatched();
    done();
    await flush();
    expect(notification.shown).toEqual([
      {
        title: "Fix the tests",
        options: { body: "Task finished.", tag: "web-pi:done:s1" },
      },
    ]);
  });

  it("interrupts for a dialog an extension opened", async () => {
    const notification = notifications("granted");
    serviceWorker(null);
    await load();
    unwatched();
    byId("extension-dialog").innerHTML =
      "<dialog><h3>Pick a branch</h3></dialog>";
    htmxEvent(byId("extension-dialog"), "htmx:afterSwap");
    await flush();
    expect(FakeAudioContext.played).toBe(2);
    expect(notification.shown[0]).toEqual({
      title: "Pi needs your attention",
      options: { body: "Pick a branch", tag: "web-pi:extension-ui" },
    });
    byId("extension-dialog").innerHTML = "";
    htmxEvent(byId("extension-dialog"), "htmx:afterSwap");
    expect(FakeAudioContext.played).toBe(2);
  });
});

describe("workspace memory", () => {
  it("remembers the open session per project", async () => {
    await load(
      '<button id="project-select" data-project-key="/repo/one"></button>',
    );
    expect(
      JSON.parse(localStorage.getItem("web-pi:last-open-by-workspace") ?? ""),
    ).toEqual({
      "/repo/one": "s1",
    });
  });

  it("reopens the remembered session from the index while the sidebar lists it", async () => {
    localStorage.setItem(
      "web-pi:last-open-by-workspace",
      JSON.stringify({ "/repo/one": "s9" }),
    );
    mount(
      '<main data-session-id=""><button id="project-select" data-project-key="/repo/one"></button>' +
        '<div id="session-list"><div data-session-id="s9"></div></div></main>',
    );
    const { setUpNotifications } = await import("@web/client/notify");
    setUpNotifications();
    expect(location.pathname).toBe("/sessions/s9");
  });

  it("leaves a deleted session alone", async () => {
    localStorage.setItem(
      "web-pi:last-open-by-workspace",
      JSON.stringify({ "/repo/one": "gone" }),
    );
    mount(
      '<main data-session-id=""><button id="project-select" data-project-key="/repo/one"></button>' +
        '<div id="session-list"></div></main>',
    );
    const { setUpNotifications } = await import("@web/client/notify");
    setUpNotifications();
    expect(location.pathname).toBe("/");
  });
});
