import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { getHelpText, parseLaunchOptions } = require("../bin/pi-web-options.js");
const cliPath = fileURLToPath(new URL("../bin/pi-web.js", import.meta.url));

test("uses loopback startup defaults", () => {
  assert.deepEqual(parseLaunchOptions([], {}), {
    help: false,
    port: "30141",
    hostname: "127.0.0.1",
  });
});

test("supports --help and -h without starting the server", () => {
  assert.deepEqual(parseLaunchOptions(["--help"], {}), { help: true });
  assert.deepEqual(parseLaunchOptions(["-h"], {}), { help: true });
  assert.match(getHelpText(), /Usage: pi-web/);
  assert.match(getHelpText(), /--port/);
  assert.match(getHelpText(), /--hostname/);
});

test("rejects unknown and removed options with a help hint", () => {
  for (const option of ["--unknown-flag", "--no-open"]) {
    assert.throws(
      () => parseLaunchOptions([option], {}),
      /Use --help to see available options/,
    );
  }
});

test("rejects unexpected positional arguments", () => {
  assert.throws(
    () => parseLaunchOptions(["start"], {}),
    /Unexpected argument/,
  );
});

test("CLI writes help and parse errors before exiting", () => {
  const help = spawnSync(process.execPath, [cliPath, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: pi-web/);

  const invalid = spawnSync(process.execPath, [cliPath, "--unknown-flag"], {
    encoding: "utf8",
  });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Use --help to see available options/);
});

test("preserves port and hostname options", () => {
  assert.deepEqual(
    parseLaunchOptions(["-p", "8080", "-H", "0.0.0.0"], {}),
    {
      help: false,
      port: "8080",
      hostname: "0.0.0.0",
    },
  );
});

test("rejects port values that could inject cmd arguments", () => {
  assert.throws(
    () => parseLaunchOptions(["-p", "30141&whoami"], {}),
    /Port must be a non-negative integer/,
  );
  assert.throws(
    () => parseLaunchOptions([], { PORT: "30141&whoami" }),
    /Port must be a non-negative integer/,
  );
});

test("supports PI_WEB_HOSTNAME without trusting the ambient system HOSTNAME", () => {
  assert.equal(
    parseLaunchOptions([], { HOSTNAME: "container-id" }).hostname,
    "127.0.0.1",
  );
  assert.equal(
    parseLaunchOptions([], { PI_WEB_HOSTNAME: "0.0.0.0" }).hostname,
    "0.0.0.0",
  );
});
