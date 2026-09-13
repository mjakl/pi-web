import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

// `npx` without a shell. On Windows `spawn("npx.cmd")` needs `shell: true`
// since Node 20.12, and a shell would reintroduce quoting bugs for arguments
// a reader typed, so the npm CLI's own entry script is run with this Node.

function npxCli(): string | undefined {
  const nodeDir = dirname(process.execPath);
  for (const candidate of [
    join(nodeDir, "node_modules", "npm", "bin", "npx-cli.js"),
    join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npx-cli.js"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export type NpxResult = { stdout: string; stderr: string; failed: boolean };

/** Combined output either way: `npx skills` reports success in prose. */
export function runNpx(
  args: string[],
  options: { cwd?: string; timeout: number },
): Promise<NpxResult> {
  const cli = npxCli();
  const [command, argv] = cli
    ? [process.execPath, [cli, ...args]]
    : ["npx", args];
  return new Promise((resolve) => {
    execFile(
      command,
      argv,
      {
        timeout: options.timeout,
        maxBuffer: 8 * 1024 * 1024,
        // FORCE_COLOR neutralises escape codes at the source; the caller
        // strips whatever still gets through.
        env: { ...process.env, FORCE_COLOR: "0" },
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      },
      (error, stdout, stderr) => {
        resolve({
          stdout,
          stderr: stderr + (error && !stdout && !stderr ? error.message : ""),
          failed: error !== null,
        });
      },
    );
  });
}
