import { parseArgs } from "node:util";
import {
  linkHostPi,
  PACKAGE_ROOT,
  resolveHostPi,
  webPiVersion,
} from "./host-pi.ts";

// The `web-pi` bin is composition only: parse the flags, point
// node_modules/@earendil-works at the installed Pi, then start the server.

const HELP = `web-pi — a web interface for the Pi coding agent

Usage: web-pi [options]

  --host <name>      address to bind (default 127.0.0.1, or WEB_PI_HOST)
  --port <number>    port to listen on (default 30142, or WEB_PI_PORT)
  --lan              bind 0.0.0.0; see the security note in the README
  --runtime <name>   "pi" (default) or "fake" for a scripted demo runtime
  --help             show this text
  --version          show the web-pi and Pi versions

Environment: WEB_PI_HOST, WEB_PI_PORT, WEB_PI_RUNTIME, WEB_PI_DEFAULT_CWD,
PI_CODING_AGENT_DIR, HTTP_PROXY, HTTPS_PROXY, NO_PROXY.
`;

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export type CliOptions = {
  help: boolean;
  version: boolean;
  /** Flag values as environment overrides; loadConfig() validates them. */
  env: Record<string, string>;
};

export function parseOptions(argv: string[]): CliOptions {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        host: { type: "string" },
        port: { type: "string" },
        lan: { type: "boolean" },
        runtime: { type: "string" },
        help: { type: "boolean" },
        version: { type: "boolean" },
      },
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}\nRun \`web-pi --help\` for the options.`, {
      cause: error,
    });
  }
  const env: Record<string, string> = {};
  // An explicit --host after --lan wins; both are rarely given together.
  if (values.lan === true) env["WEB_PI_HOST"] = "0.0.0.0";
  if (values.host !== undefined) env["WEB_PI_HOST"] = values.host;
  if (values.port !== undefined) env["WEB_PI_PORT"] = values.port;
  if (values.runtime !== undefined) env["WEB_PI_RUNTIME"] = values.runtime;
  return {
    help: values.help === true,
    version: values.version === true,
    env,
  };
}

function versionLines(): string {
  let pi = "not found on PATH";
  try {
    pi = resolveHostPi().version;
  } catch {
    // A real start reports why; --version stays useful without Pi.
  }
  return `web-pi ${webPiVersion()}\npi ${pi}\n`;
}

/** Link the host Pi into this package so `@earendil-works/*` resolves. */
function linkPi(): void {
  const host = resolveHostPi();
  try {
    linkHostPi(PACKAGE_ROOT, host);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `cannot link Pi ${host.version} into ${PACKAGE_ROOT}: ${message}\nInstall web-pi somewhere writable, or run it from a checkout.`,
      { cause: error },
    );
  }
}

export async function run(argv: string[]): Promise<void> {
  try {
    const options = parseOptions(argv);
    if (options.help) {
      process.stdout.write(HELP);
      return;
    }
    if (options.version) {
      process.stdout.write(versionLines());
      return;
    }
    linkPi();
    Object.assign(process.env, options.env);
    const host = process.env["WEB_PI_HOST"] ?? "127.0.0.1";
    if (!LOOPBACK.has(host)) {
      process.stderr.write(
        `Warning: web-pi is listening on ${host} without any authentication. Use it only on a trusted network or behind an external security layer.\n`,
      );
    }
    // Resolved at run time, not bundled: the server is its own entry point,
    // and it must not load before the SDK links above are in place.
    await import(new URL("./server.js", import.meta.url).href);
  } catch (error) {
    process.stderr.write(
      `web-pi: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
