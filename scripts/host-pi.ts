import {
  accessSync,
  constants,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { findPackageJSON } from "node:module";
import { basename, delimiter, dirname, join, resolve } from "node:path";

// web-pi pins nothing: the SDK this checkout compiles and runs against is the
// one behind the `pi` on PATH, symlinked into node_modules. A pin would drift
// from the CLI that writes the session files we read.

const CODING_AGENT = "@earendil-works/pi-coding-agent";

const PI_PACKAGES = [
  CODING_AGENT,
  "@earendil-works/pi-ai",
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-tui",
];

export const CHECKOUT_DIR = resolve(import.meta.dirname, "..");

export type HostPi = {
  executable: string;
  version: string;
  /** Package name to the real directory holding its package.json. */
  packages: Record<string, string>;
};

/** The version of `name` installed in `packageJsonPath`, if it is that package. */
function packageVersion(
  packageJsonPath: string,
  name: string,
): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const manifest = parsed as Record<string, unknown>;
  if (manifest["name"] !== name) return undefined;
  const version = manifest["version"];
  return typeof version === "string" ? version : undefined;
}

function isExecutable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function ancestors(start: string): string[] {
  const result: string[] = [];
  for (let current = resolve(start); ;) {
    result.push(current);
    const parent = dirname(current);
    if (parent === current) return result;
    current = parent;
  }
}

/**
 * The first `pi` on PATH, ignoring this checkout's own `node_modules/.bin`,
 * which package managers put first on PATH for every script they run.
 */
export function findPiExecutable(
  env: NodeJS.ProcessEnv,
  checkoutDir: string,
): string {
  // POSIX only: Windows would have to try each PATHEXT suffix in turn.
  const local = join(checkoutDir, "node_modules", ".bin", "pi");
  for (const entry of (env["PATH"] ?? "").split(delimiter)) {
    const candidate = resolve(entry === "" ? "." : entry, "pi");
    if (candidate === local) continue;
    if (isExecutable(candidate)) return candidate;
  }
  throw new Error(
    "no `pi` executable on PATH; install Pi (see https://github.com/earendil-works/pi) and open a new shell",
  );
}

/**
 * The package directory the executable belongs to. A version-manager shim that
 * lives outside a Pi install has no such directory and is rejected: it tells us
 * nothing about which SDK version we would be compiling against.
 */
export function findCodingAgentRoot(executable: string): string {
  for (const dir of ancestors(dirname(realpathSync(executable)))) {
    const candidates = [
      dir,
      join(dir, "node_modules", ...CODING_AGENT.split("/")),
    ];
    for (const candidate of candidates) {
      if (packageVersion(join(candidate, "package.json"), CODING_AGENT)) {
        return realpathSync(candidate);
      }
    }
  }
  throw new Error(
    `${executable} is not inside a ${CODING_AGENT} install; a bare version-manager shim does not say which SDK it runs`,
  );
}

/** Locate the host Pi install and every SDK package this checkout imports. */
export function resolveHostPi(
  env: NodeJS.ProcessEnv = process.env,
  checkoutDir: string = CHECKOUT_DIR,
): HostPi {
  const executable = findPiExecutable(env, checkoutDir);
  const codingRoot = findCodingAgentRoot(executable);
  const codingManifest = join(codingRoot, "package.json");
  const version = packageVersion(codingManifest, CODING_AGENT);
  if (version === undefined) {
    throw new Error(`${codingManifest} has no version`);
  }

  const packages: Record<string, string> = { [CODING_AGENT]: codingRoot };
  for (const name of PI_PACKAGES) {
    if (name === CODING_AGENT) continue;
    // Pi's siblings are not next to it under every installer, so ask Node to
    // resolve them the way the coding agent itself does.
    const manifest = findPackageJSON(name, codingManifest);
    if (manifest === undefined) {
      throw new Error(
        `${name} is missing from ${CODING_AGENT} in ${codingRoot}`,
      );
    }
    const found = packageVersion(manifest, name);
    if (found !== version) {
      throw new Error(
        `${name} is ${found ?? "unreadable"} but ${CODING_AGENT} is ${version}; reinstall Pi`,
      );
    }
    packages[name] = realpathSync(dirname(manifest));
  }
  return { executable, version, packages };
}

function linkPath(checkoutDir: string, name: string): string {
  return join(checkoutDir, "node_modules", "@earendil-works", basename(name));
}

function currentTarget(link: string): string | undefined {
  try {
    return readlinkSync(link);
  } catch {
    return undefined;
  }
}

/** Symlinks that are missing or point somewhere other than the host install. */
export function staleLinks(checkoutDir: string, host: HostPi): string[] {
  return Object.entries(host.packages)
    .filter(
      ([name, target]) => currentTarget(linkPath(checkoutDir, name)) !== target,
    )
    .map(([name]) => name);
}

/** Point node_modules/@earendil-works/* at the host install; returns what moved. */
export function linkHostPi(checkoutDir: string, host: HostPi): string[] {
  mkdirSync(join(checkoutDir, "node_modules", "@earendil-works"), {
    recursive: true,
  });
  const relinked: string[] = [];
  for (const [name, target] of Object.entries(host.packages)) {
    const link = linkPath(checkoutDir, name);
    if (currentTarget(link) === target) continue;
    relinked.push(name);
    const staging = `${link}.tmp${String(process.pid)}`;
    rmSync(staging, { recursive: true, force: true });
    symlinkSync(target, staging, "dir");
    try {
      renameSync(staging, link);
    } catch {
      // rename cannot replace a real directory a package manager installed.
      rmSync(link, { recursive: true, force: true });
      renameSync(staging, link);
    }
  }
  return relinked;
}
