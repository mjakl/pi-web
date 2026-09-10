import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { resolve } from "node:path";

export type Config = {
  host: string;
  port: number;
  /** Pi's agent directory (~/.pi/agent or PI_CODING_AGENT_DIR). */
  agentDir: string;
  defaultCwd: string;
  runtime: "pi" | "fake";
  staticRoot: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env["WEB_PI_PORT"] ?? 30142);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("WEB_PI_PORT must be a positive integer");
  }
  const runtime = env["WEB_PI_RUNTIME"] ?? "pi";
  if (runtime !== "pi" && runtime !== "fake") {
    throw new Error('WEB_PI_RUNTIME must be "pi" or "fake"');
  }
  return {
    host: env["WEB_PI_HOST"] ?? "127.0.0.1",
    port,
    agentDir: getAgentDir(),
    defaultCwd: env["WEB_PI_DEFAULT_CWD"] ?? homedir(),
    runtime,
    staticRoot: resolve(import.meta.dirname, "../static"),
  };
}
