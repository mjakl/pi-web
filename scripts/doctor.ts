import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// The Pi SDK is a pinned dependency, while sessions and settings are shared
// with the `pi` on PATH. A version gap can mean a session format this
// checkout cannot read; say so before it surprises anyone.
const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
  dependencies: Record<string, string>;
};
const pinned = manifest.dependencies["@earendil-works/pi-coding-agent"];
let host = "not found";
try {
  host = execFileSync("pi", ["--version"], { encoding: "utf8" }).trim();
} catch {
  // A missing host pi is reported below.
}
const ok = host === pinned;
process.stdout.write(
  `pinned @earendil-works/pi-coding-agent: ${pinned ?? "?"}\nhost pi on PATH: ${host}\n${
    ok
      ? "OK: versions match"
      : "WARNING: bump the pin to the host version (pnpm add @earendil-works/pi-coding-agent@<v> @earendil-works/pi-ai@<v> @earendil-works/pi-agent-core@<v>)"
  }\n`,
);
process.exit(ok ? 0 : 1);
