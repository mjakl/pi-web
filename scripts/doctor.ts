import { CHECKOUT_DIR, resolveHostPi, staleLinks } from "./host-pi.ts";

// Nothing is pinned: report which Pi this checkout compiles and runs against.
let host;
try {
  host = resolveHostPi();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}

const stale = staleLinks(CHECKOUT_DIR, host);
const lines = Object.entries(host.packages).map(
  ([name, target]) =>
    `  ${name} -> ${target}${stale.includes(name) ? "  (not linked)" : ""}`,
);
process.stdout.write(
  `pi executable: ${host.executable}\nversion: ${host.version}\n${lines.join("\n")}\n${
    stale.length === 0
      ? "OK: node_modules/@earendil-works points at the host install\n"
      : "WARNING: run `just link-pi` to relink node_modules/@earendil-works\n"
  }`,
);
process.exit(stale.length === 0 ? 0 : 1);
