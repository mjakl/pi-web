// Completion tones follow server events. System notifications belong solely
// to the push subscription, so an unsubscribed browser stays unsubscribed.

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

function setUpCompletion(): void {
  document.body.addEventListener("done", (event) => {
    const id = (event as CustomEvent<{ data?: unknown }>).detail?.data;
    if (typeof id !== "string" || !id.trim()) return;
    playDone();
  });
  document.body.addEventListener("htmx:after:settle", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    // A dialog an extension just opened is the other thing worth interrupting
    // for: the turn is blocked until someone answers it.
    if (target.id === "extension-dialog" && target.querySelector("dialog")) {
      playDone();
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
