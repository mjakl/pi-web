import { createWebApp } from "@web/app";
import { serve } from "@hono/node-server";
import { loadConfig } from "./config.ts";
import { createDeps } from "./container.ts";

const config = loadConfig();
const { workspace } = createDeps(config);
const app = createWebApp({
  workspace,
  staticRoot: config.staticRoot,
  defaultCwd: config.defaultCwd,
});

const server = serve(
  { fetch: app.fetch, hostname: config.host, port: config.port },
  (info) => {
    process.stdout.write(
      `web-pi listening on http://${info.address}:${String(info.port)} (${config.runtime} runtime)\n`,
    );
  },
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
