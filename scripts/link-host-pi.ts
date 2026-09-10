import { CHECKOUT_DIR, linkHostPi, resolveHostPi } from "./host-pi.ts";

try {
  const host = resolveHostPi();
  const relinked = linkHostPi(CHECKOUT_DIR, host);
  const detail =
    relinked.length === 0
      ? "already linked"
      : `linked\n${relinked
          .map((name) => `  ${name} -> ${host.packages[name] ?? ""}`)
          .join("\n")}`;
  process.stdout.write(
    `Pi ${host.version} from ${host.executable}: ${detail}\n`,
  );
} catch (error) {
  process.stderr.write(
    `Cannot resolve the Pi SDK from PATH: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}
