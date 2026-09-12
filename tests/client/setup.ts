// The browser the client modules run in under test: happy-dom, the few APIs
// it lacks that the modules reach for, and a clean page for every test. The
// modules register listeners on `document`, `window` and `body` when they are
// set up, so every registration made during a test is undone after it, and
// the module registry is reset so module-level state starts over too.

import { afterEach, beforeEach, vi } from "vitest";
import { device, FakeAudioContext, installFakeHtmx } from "./helpers.ts";

// --- Popover API (absent from happy-dom 20) --------------------------------
// Only what the modules observe: the toggle events, with their `newState`.

const openPopovers = new WeakSet<HTMLElement>();

function toggleEvent(type: "beforetoggle" | "toggle", open: boolean): Event {
  return Object.assign(
    new Event(type, { cancelable: type === "beforetoggle" }),
    {
      oldState: open ? "closed" : "open",
      newState: open ? "open" : "closed",
    },
  );
}

function setPopover(element: HTMLElement, open: boolean): void {
  if (openPopovers.has(element) === open) return;
  element.dispatchEvent(toggleEvent("beforetoggle", open));
  if (open) openPopovers.add(element);
  else openPopovers.delete(element);
  element.dispatchEvent(toggleEvent("toggle", open));
}

Object.assign(HTMLElement.prototype, {
  showPopover(this: HTMLElement): void {
    setPopover(this, true);
  },
  hidePopover(this: HTMLElement): void {
    setPopover(this, false);
  },
  togglePopover(this: HTMLElement, force?: boolean): boolean {
    setPopover(this, force ?? !openPopovers.has(this));
    return openPopovers.has(this);
  },
});

// happy-dom answers `getModifierState("AltGraph")` with `altKey`; a browser
// reports AltGraph on its own, and the composer tells the two apart.
// eslint-disable-next-line typescript/unbound-method -- called with `this` below
const { getModifierState } = KeyboardEvent.prototype;
KeyboardEvent.prototype.getModifierState = function (
  this: KeyboardEvent,
  key: string,
): boolean {
  return key === "AltGraph" ? false : getModifierState.call(this, key);
};

// --- Listener bookkeeping --------------------------------------------------

type Registration = {
  target: EventTarget | null;
  type: string;
  listener: EventListenerOrEventListenerObject;
  options: boolean | AddEventListenerOptions | undefined;
};

const registrations: Registration[] = [];

// The page's `EventTarget` is not the class every node, the document and the
// window inherit `addEventListener` from; that base class sits above `Node`.
const eventTarget = Object.getPrototypeOf(Node.prototype) as EventTarget;
// eslint-disable-next-line typescript/unbound-method -- called with `this` below
const { addEventListener: addListener } = eventTarget;
eventTarget.addEventListener = function (
  this: EventTarget,
  type: string,
  listener: EventListenerOrEventListenerObject | null,
  options?: boolean | AddEventListenerOptions,
): void {
  if (listener) registrations.push({ target: this, type, listener, options });
  addListener.call(this, type, listener, options);
};

// The bare `addEventListener(...)` a module calls is vitest's copy, bound to
// the window before the patch above; `null` stands for the window here.
const windowAdd = globalThis.addEventListener;
const windowRemove = globalThis.removeEventListener;
globalThis.addEventListener = (
  type: string,
  listener: EventListenerOrEventListenerObject | null,
  options?: boolean | AddEventListenerOptions,
): void => {
  if (listener === null) return;
  registrations.push({ target: null, type, listener, options });
  windowAdd(type, listener, options);
};

function clearAttributes(element: Element): void {
  for (const attribute of [...element.attributes]) {
    element.removeAttribute(attribute.name);
  }
}

// No test reaches the network: a request nothing answered gets an empty
// reply. A test that wants to see requests stubs `fetch` on top of this.
globalThis.fetch = () => Promise.resolve(new Response(""));
Object.assign(globalThis, { AudioContext: FakeAudioContext });

beforeEach(() => {
  vi.resetModules();
  FakeAudioContext.played = 0;
  installFakeHtmx();
  // Timers are faked by default so a debounce a test set going cannot fire
  // into the next test; a test that needs the clock to move advances it.
  vi.useFakeTimers();
});

afterEach(() => {
  for (const { target, type, listener, options } of registrations.splice(0)) {
    if (target === null) windowRemove(type, listener, options);
    else target.removeEventListener(type, listener, options);
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  clearAttributes(document.body);
  clearAttributes(document.documentElement);
  document.title = "";
  localStorage.clear();
  sessionStorage.clear();
  device({
    prefersColorScheme: "light",
    prefersReducedMotion: "no-preference",
  });
  window.innerWidth = 1024;
  window.innerHeight = 768;
  // A detached happy-dom window never navigates: `location.assign` only
  // rewrites the URL, which is what a test asserts on, and this puts it back.
  history.replaceState(null, "", "/");
});
