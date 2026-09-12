// What happens when a run finishes: a tone, and a notification when nobody is
// looking at this tab. The server decides *that* a run finished and says so on
// the session stream; only the browser knows whether anyone is watching.

import { soundEnabled } from "./preferences.ts";

let audio: AudioContext | undefined;

/**
 * Browsers refuse to start audio before the reader has interacted with the
 * page, and a context created too early is stuck suspended. One is made on the
 * first gesture and reused; `resume` covers a context suspended since.
 */
function unlock(): void {
  audio ??= new AudioContext();
  if (audio.state === "suspended") void audio.resume();
}

/** Two notes, a third apart, short enough not to be in the way. */
export function playDone(): void {
  if (!soundEnabled()) return;
  unlock();
  const context = audio;
  if (!context || context.state !== "running") return;
  for (const [index, frequency] of [523.25, 659.25].entries()) {
    const start = context.currentTime + index * 0.18;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(0.18, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.45);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.45);
  }
}

/** A visible but unfocused tab still counts as unwatched, as in pi-web. */
function unwatched(): boolean {
  return document.visibilityState !== "visible" || !document.hasFocus();
}

/**
 * Asked once, ever, and only when a run has actually finished while nobody
 * was looking: that is the moment a notification would have been useful. A
 * button rather than a bare `requestPermission()`, because a prompt out of
 * nowhere is what makes people click "block".
 */
const ASKED_KEY = "web-pi:notify-asked";

function offerNotifications(): void {
  if (!("Notification" in window) || Notification.permission !== "default") {
    return;
  }
  try {
    if (localStorage.getItem(ASKED_KEY) === "1") return;
    localStorage.setItem(ASKED_KEY, "1");
  } catch {
    // Without storage the offer would come back every time; skip it.
    return;
  }
  const shelf = document.getElementById("toasts");
  if (!shelf) return;
  const box = document.createElement("div");
  box.className = "notice-shelf-item";
  box.style.color = "var(--info)";
  const text = document.createElement("span");
  text.textContent = "Notify you when a run finishes?";
  const yes = document.createElement("button");
  yes.type = "button";
  yes.className = "history-action";
  yes.textContent = "Allow";
  yes.addEventListener("click", () => {
    box.remove();
    void Notification.requestPermission();
  });
  const no = document.createElement("button");
  no.type = "button";
  no.className = "history-action";
  no.textContent = "No thanks";
  no.addEventListener("click", () => {
    box.remove();
  });
  box.append(text, yes, no);
  shelf.append(box);
}

function notify(title: string, body: string, tag: string): void {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") {
    offerNotifications();
    return;
  }
  const options = { body, tag };
  try {
    // The service worker owns notifications where one is registered: on
    // Android and in an installed app the constructor throws outright.
    void navigator.serviceWorker
      ?.getRegistration()
      .then(async (registration) => {
        if (registration) await registration.showNotification(title, options);
        // eslint-disable-next-line no-new -- a Notification is its own effect
        else new Notification(title, options);
      })
      .catch(() => undefined);
  } catch {
    // A browser that exposes Notification but refuses to show one.
  }
}

/** The title this page shows, for the notification body. */
function pageTitle(): string {
  return (
    document
      .querySelector<HTMLElement>("[data-page-title]")
      ?.textContent?.trim() ?? "Session complete"
  );
}

function setUpCompletion(): void {
  document.body.addEventListener("done", (event) => {
    const id = (event as CustomEvent<{ data?: unknown }>).detail?.data;
    if (typeof id !== "string" || !id.trim()) return;
    playDone();
    if (unwatched()) notify(pageTitle(), "Task finished.", `web-pi:done:${id}`);
  });
  document.body.addEventListener("htmx:after:settle", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    // A dialog an extension just opened is the other thing worth interrupting
    // for: the turn is blocked until someone answers it.
    if (target.id === "extension-dialog" && target.querySelector("dialog")) {
      playDone();
      if (unwatched()) {
        const title =
          target.querySelector("h3")?.textContent?.trim() ??
          "An extension is waiting for your input.";
        notify("Pi needs your attention", title, "web-pi:extension-ui");
      }
    }
  });
}

/**
 * A run that finished in another session: the tone belongs to it too, because
 * the whole point of leaving a session running is not having to watch it. The
 * sidebar stream already reports every finished session; the unread handler
 * skips the one on screen, and so does this.
 */
function setUpBackgroundCompletion(): void {
  document.body.addEventListener("finished", (event) => {
    const text = (event as CustomEvent<{ data?: unknown }>).detail?.data;
    if (typeof text !== "string") return;
    let finished: { id?: string } = {};
    try {
      finished = JSON.parse(text) as typeof finished;
    } catch {
      return;
    }
    if (!finished || typeof finished.id !== "string") return;
    const current =
      document.querySelector("main")?.getAttribute("data-session-id") ?? "";
    if (finished.id && finished.id !== current) playDone();
  });
}

// Which session was last open in which workspace. Switching project reopens
// the session the reader left there, which is what pi-web's
// `pi-web:last-open-by-workspace` is for.
const MEMORY_KEY = "web-pi:last-open-by-workspace";

function readMemory(): Record<string, string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(MEMORY_KEY) ?? "{}");
    return typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

function currentProject(): string {
  return document.getElementById("project-select")?.dataset["projectKey"] ?? "";
}

function setUpWorkspaceMemory(): void {
  const session =
    document.querySelector("main")?.getAttribute("data-session-id") ?? "";
  const project = currentProject();
  if (project === "") return;
  if (session !== "") {
    const memory = readMemory();
    if (memory[project] === session) return;
    memory[project] = session;
    try {
      localStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
    } catch {
      // Without storage the memory lasts for this page only.
    }
    return;
  }
  // Landing on the index: reopen what was last read here, but only when the
  // sidebar still lists it, so a deleted session cannot send the reader to a
  // page that does not exist.
  if (location.pathname !== "/") return;
  const remembered = readMemory()[project];
  if (
    remembered !== undefined &&
    document.querySelector(`#session-list [data-session-id="${remembered}"]`)
  ) {
    location.replace(`/sessions/${remembered}`);
  }
}

export function setUpNotifications(): void {
  for (const event of ["pointerdown", "keydown"] as const) {
    document.addEventListener(event, unlock, { once: true, passive: true });
  }
  setUpCompletion();
  setUpBackgroundCompletion();
  setUpWorkspaceMemory();
}
