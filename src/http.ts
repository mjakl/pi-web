import { EventEmitter } from "node:events";
import * as undici from "undici";

// Every server-side fetch (providers through the Pi SDK, Web Push) goes
// through one dispatcher. Node's built-in fetch ignores HTTP_PROXY,
// HTTPS_PROXY and NO_PROXY; undici's EnvHttpProxyAgent reads them itself, so
// behind a corporate proxy this is the difference between working and not.

/** undici's own default: long enough for a streaming model call to idle. */
export const HTTP_IDLE_TIMEOUT_MS = 300_000;

const ignore = (): void => {};

// undici can emit an internal Client "error" while tearing a response body
// down. The body stream still rejects for the caller; an unhandled emitter
// error would take the whole server with it.
function quiet<T extends undici.Dispatcher>(dispatcher: T): T {
  if (dispatcher instanceof EventEmitter) {
    EventEmitter.prototype.on.call(dispatcher, "error", ignore);
  }
  return dispatcher;
}

function client(origin: string | URL, options: object): undici.Dispatcher {
  return quiet(new undici.Client(origin, options as undici.Client.Options));
}

function pool(origin: string | URL, options: object): undici.Dispatcher {
  const settings = options as undici.Pool.Options;
  if (settings.connections === 1) return client(origin, settings);
  return quiet(new undici.Pool(origin, { ...settings, factory: client }));
}

/** Point global fetch and the SDK at a proxy-aware dispatcher. */
export function configureHttpDispatcher(
  timeoutMs: number = HTTP_IDLE_TIMEOUT_MS,
): void {
  undici.setGlobalDispatcher(
    quiet(
      new undici.EnvHttpProxyAgent({
        allowH2: false,
        bodyTimeout: timeoutMs,
        headersTimeout: timeoutMs,
        clientFactory: client,
        factory: pool,
      }),
    ),
  );
  // Global fetch is Node's own copy of undici and would ignore the dispatcher
  // above until install() points it at this one.
  undici.install();
}
