// What the client tests share: the page, the events the modules listen for,
// and the fake htmx that records what the modules asked it to do.

import { type Mock, onTestFinished, vi } from "vitest";

export type FakeHtmx = {
  ajax: Mock<(verb: string, path: string, context: unknown) => Promise<void>>;
  process: Mock<(element: Element) => void>;
  trigger: Mock<(element: Element, name: string) => void>;
};

export function installFakeHtmx(): FakeHtmx {
  const fake: FakeHtmx = {
    ajax: vi.fn(() => Promise.resolve()),
    process: vi.fn(),
    trigger: vi.fn(),
  };
  (globalThis as { htmx?: FakeHtmx }).htmx = fake;
  return fake;
}

export function htmx(): FakeHtmx {
  const fake = (globalThis as { htmx?: FakeHtmx }).htmx;
  if (!fake) throw new Error("The fake htmx is installed by the setup file");
  return fake;
}

/** The HTML a Hono JSX node renders to. */
export function render(node: unknown): string {
  return String(node);
}

/** Puts server markup on the page: a Hono JSX node or a string. */
export function mount(markup: unknown): void {
  document.body.innerHTML = render(markup);
}

export function byId(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`No #${id} on the page`);
  return element;
}

export function query(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`No ${selector} on the page`);
  return element;
}

export function field(selector: string): HTMLInputElement {
  const element = document.querySelector(selector);
  if (!(element instanceof HTMLInputElement)) {
    throw new Error(`No input ${selector} on the page`);
  }
  return element;
}

export function area(): HTMLTextAreaElement {
  const element = document.getElementById("composer-text");
  if (!(element instanceof HTMLTextAreaElement)) {
    throw new Error("No #composer-text on the page");
  }
  return element;
}

/** A key press as the browser delivers it: bubbling and cancelable. */
export function keydown(
  target: EventTarget,
  key: string,
  init: KeyboardEventInit = {},
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

export function keyup(
  target: EventTarget,
  key: string,
  init: KeyboardEventInit = {},
): void {
  target.dispatchEvent(
    new KeyboardEvent("keyup", {
      key,
      bubbles: true,
      cancelable: true,
      ...init,
    }),
  );
}

export function click(
  target: EventTarget,
  init: MouseEventInit = {},
): MouseEvent {
  const event = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

/** Types into a field the way a keystroke does: value, then `input`. */
export function type(
  field: HTMLTextAreaElement | HTMLInputElement,
  value: string,
): void {
  field.value = value;
  field.setSelectionRange(value.length, value.length);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

/** An htmx lifecycle event, bubbling from the swapped element. */
export function htmxEvent(
  target: EventTarget,
  name: string,
  detail: unknown = {},
): CustomEvent {
  const event = new CustomEvent(name, { bubbles: true, detail });
  target.dispatchEvent(event);
  return event;
}

/** Runs the animation frame callbacks queued so far (timers are faked). */
export function frame(): void {
  vi.advanceTimersToNextFrame();
}

/** Lets pending promise callbacks run. */
export async function flush(): Promise<void> {
  for (let round = 0; round < 5; round += 1) await Promise.resolve();
}

/** A fetch that answers by URL and records every call. */
export function mockFetch(
  answer: (url: string, init: RequestInit | undefined) => Response,
): Mock<(input: string | URL, init?: RequestInit) => Promise<Response>> {
  const mock = vi.fn((input: string | URL, init?: RequestInit) =>
    Promise.resolve(answer(input instanceof URL ? input.href : input, init)),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function text(body: string, status = 200): Response {
  return new Response(body, { status });
}

/**
 * A private window: every storage call throws. Replaces the global, because
 * happy-dom's storage proxy caches the methods it has handed out, so a spy
 * on `Storage.prototype` outlives the test.
 */
export function blockStorage(): void {
  const refuse = () => {
    throw new Error("storage is blocked");
  };
  vi.stubGlobal("localStorage", {
    getItem: refuse,
    setItem: refuse,
    removeItem: refuse,
    clear: refuse,
  });
}

/**
 * The Web Audio API, which happy-dom lacks: enough for the completion tone.
 * `played` counts the notes started since the last reset.
 */
export class FakeAudioContext {
  static played = 0;
  state: "running" | "suspended" = "running";
  currentTime = 0;
  destination = {};
  resume(): Promise<void> {
    this.state = "running";
    return Promise.resolve();
  }
  createGain(): { gain: Record<string, () => void>; connect(): object } {
    const gain = {
      setValueAtTime: () => {},
      linearRampToValueAtTime: () => {},
      exponentialRampToValueAtTime: () => {},
    };
    return { gain, connect: () => ({}) };
  }
  createOscillator(): {
    type: string;
    frequency: { value: number };
    connect(target: { connect(next: unknown): object }): object;
    start(): void;
    stop(): void;
  } {
    return {
      type: "sine",
      frequency: { value: 0 },
      connect: (target) => target,
      start: () => {
        FakeAudioContext.played += 1;
      },
      stop: () => {},
    };
  }
}

export type FakeServiceWorker = {
  register: Mock<(src: string, options: unknown) => Promise<unknown>>;
  getRegistration: Mock<() => Promise<unknown>>;
};

/**
 * `navigator.serviceWorker`, which happy-dom lacks, answering
 * `getRegistration()` with what the test hands in. Gone after the test.
 */
export function serviceWorker(registration: unknown): FakeServiceWorker {
  const fake: FakeServiceWorker = {
    register: vi.fn(() => Promise.resolve(registration)),
    getRegistration: vi.fn(() => Promise.resolve(registration)),
  };
  Object.defineProperty(navigator, "serviceWorker", {
    value: fake,
    configurable: true,
  });
  onTestFinished(() => {
    Reflect.deleteProperty(navigator, "serviceWorker");
  });
  return fake;
}

type Device = {
  prefersColorScheme: "light" | "dark";
  prefersReducedMotion: "no-preference" | "reduce";
};

/** The system preferences happy-dom answers media queries from. */
export function device(settings: Partial<Device>): void {
  const happy = (globalThis as { happyDOM?: { settings: { device: Device } } })
    .happyDOM;
  if (!happy) throw new Error("happy-dom is not the test environment");
  Object.assign(happy.settings.device, settings);
}

/** Lets a test give a box the geometry happy-dom has no layout for. */
export function setGeometry(
  element: Element,
  values: Partial<
    Record<
      "scrollHeight" | "clientHeight" | "clientWidth" | "offsetParent",
      number | Element | null
    >
  >,
): void {
  for (const [name, value] of Object.entries(values)) {
    Object.defineProperty(element, name, { value, configurable: true });
  }
}

export function setRect(element: Element, rect: Partial<DOMRect>): void {
  const box = {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    bottom: 0,
    right: 0,
    width: 0,
    height: 0,
    ...rect,
  };
  Object.defineProperty(element, "getBoundingClientRect", {
    value: () => ({ ...box, toJSON: () => box }),
    configurable: true,
  });
}
