import {
  type BashOperations,
  createBashToolDefinition,
  createLocalBashOperations,
  type InlineExtension,
  type LoadExtensionsResult,
  type SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { delimiter, join } from "node:path";

// A shell command a project runs must see the project's environment, not the
// web server's. See docs/adr/0001-project-command-environment.md.

const DROPPED = new Set(["PORT", "NODE_ENV"]);

function isDropped(name: string, platform: NodeJS.Platform): boolean {
  const key = platform === "win32" ? name.toUpperCase() : name;
  return DROPPED.has(key) || key.startsWith("WEB_PI_");
}

/**
 * The web server's own variables leak the wrong values into a project's
 * scripts (`PORT` reroutes a dev server, `NODE_ENV=production` skips dev
 * dependencies), so they are removed. `<agentDir>/bin` is prepended to PATH
 * the way Pi's terminal does, so extension-installed tools are found.
 */
export function sanitizeCommandEnvironment(
  env: NodeJS.ProcessEnv,
  agentDir: string,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    if (!isDropped(name, platform)) clean[name] = value;
  }
  const pathKey =
    (platform === "win32"
      ? Object.keys(clean).find((name) => name.toUpperCase() === "PATH")
      : "PATH") ?? "PATH";
  const binDir = join(agentDir, "bin");
  const current = clean[pathKey] ?? "";
  const separator = platform === "win32" ? ";" : delimiter;
  if (!current.split(separator).includes(binDir)) {
    clean[pathKey] =
      current === "" ? binDir : `${binDir}${separator}${current}`;
  }
  return clean;
}

/** Pi's local shell backend with the sanitised environment applied. */
export function createProjectBashOperations(options: {
  agentDir: string;
  shellPath?: string;
}): BashOperations {
  const base = createLocalBashOperations(
    options.shellPath === undefined ? {} : { shellPath: options.shellPath },
  );
  return {
    exec: (command, cwd, execOptions) =>
      base.exec(command, cwd, {
        ...execOptions,
        env: sanitizeCommandEnvironment(
          execOptions.env ?? process.env,
          options.agentDir,
        ),
      }),
  };
}

const EXTENSION_NAME = "web-pi-project-command-environment";

/**
 * The agent's own `bash` tool, with the same sanitised environment. Registered
 * inline and hidden: it replaces Pi's built-in tool rather than adding one.
 */
export function createProjectBashExtension(options: {
  cwd: string;
  agentDir: string;
  settings: SettingsManager;
}): InlineExtension {
  return {
    name: EXTENSION_NAME,
    hidden: true,
    factory: (pi) => {
      const prefix = options.settings.getShellCommandPrefix();
      const shellPath = options.settings.getShellPath();
      pi.registerTool(
        createBashToolDefinition(options.cwd, {
          operations: createProjectBashOperations({
            agentDir: options.agentDir,
            ...(shellPath === undefined ? {} : { shellPath }),
          }),
          ...(prefix === undefined ? {} : { commandPrefix: prefix }),
          ...(shellPath === undefined ? {} : { shellPath }),
        }),
      );
    },
  };
}

/**
 * A user extension that registers its own `bash` wins outright: drop ours and
 * the conflict error the loader raised for it, so their environment applies.
 */
export function preferUserBashExtension(
  base: LoadExtensionsResult,
): LoadExtensionsResult {
  const ours = base.extensions.find((extension) =>
    extension.path.includes(EXTENSION_NAME),
  );
  if (!ours) return base;
  const owner = base.extensions.find(
    (extension) => extension !== ours && extension.tools.has("bash"),
  );
  if (!owner) return base;
  return {
    ...base,
    extensions: base.extensions.filter((extension) => extension !== ours),
    errors: base.errors.filter(
      (error) => !error.error.includes('Tool "bash" conflicts'),
    ),
  };
}
