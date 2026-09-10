import { isSessionId } from "@core/sessions";
import type { Workspace } from "@core/workspace";
import { honoFactory } from "@web/hono";
import { HtmlLayout } from "@web/HtmlLayout";
import { Items } from "@web/views/Items";
import {
  IndexPage,
  NewSessionPage,
  Notice,
  SessionPage,
} from "@web/views/SessionPage";
import { Status } from "@web/views/Status";
import { serveStatic } from "@hono/node-server/serve-static";
import { jsxRenderer } from "hono/jsx-renderer";
import { streamSSE } from "hono/streaming";

export type WebDeps = {
  workspace: Workspace;
  /** Directory served under /static. */
  staticRoot: string;
  /** Suggested working folder for new sessions. */
  defaultCwd: string;
  /** Streaming re-render interval. */
  renderIntervalMs?: number;
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function html(node: { toString(): string | Promise<string> }): Promise<string> {
  return Promise.resolve(node.toString());
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function createWebApp(deps: WebDeps) {
  const app = honoFactory.createApp();
  const renderIntervalMs = deps.renderIntervalMs ?? 100;

  app.use("*", (c, next) => {
    c.set("workspace", deps.workspace);
    return next();
  });
  app.use(
    "/static/*",
    serveStatic({
      root: deps.staticRoot,
      rewriteRequestPath: (p) => p.replace(/^\/static/, ""),
    }),
  );
  app.use("*", jsxRenderer(HtmlLayout));

  app.get("/", async (c) => {
    const groups = await deps.workspace.listSessions();
    return c.render(<IndexPage groups={groups} />);
  });

  app.get("/new", async (c) => {
    const groups = await deps.workspace.listSessions();
    return c.render(<NewSessionPage groups={groups} cwd={deps.defaultCwd} />);
  });

  app.post("/sessions", async (c) => {
    const form = await c.req.formData();
    const cwd = field(form, "cwd");
    const text = field(form, "text");
    if (!cwd || !text) return c.text("cwd and text are required", 400);
    const id = await deps.workspace.startSession(cwd, text);
    return c.redirect(`/sessions/${id}`, 303);
  });

  app.get("/sessions/:id", async (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    const [groups, view] = await Promise.all([
      deps.workspace.listSessions(),
      deps.workspace.viewSession(id),
    ]);
    if (!view) return c.notFound();
    return c.render(<SessionPage groups={groups} view={view} />);
  });

  app.post("/sessions/:id/prompt", async (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    const form = await c.req.formData();
    const text = field(form, "text");
    if (!text) return c.html(<Notice message="Type a request first." />);
    try {
      await deps.workspace.send(id, text);
      return await Promise.resolve(c.html(<Notice />));
    } catch (error) {
      return c.html(<Notice message={errorText(error)} />);
    }
  });

  app.post("/sessions/:id/abort", async (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    await deps.workspace.abort(id);
    return c.body(null, 204);
  });

  app.post("/sessions/:id/model", async (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    const form = await c.req.formData();
    const [provider, ...rest] = field(form, "model").split("/");
    const modelId = rest.join("/");
    const thinking = field(form, "thinking");
    if (!provider || !modelId) return c.text("model is required", 400);
    try {
      await deps.workspace.setModel(id, {
        provider,
        modelId,
        ...(thinking
          ? {
              thinkingLevel: thinking as Parameters<
                Workspace["setModel"]
              >[1]["thinkingLevel"],
            }
          : {}),
      });
      return c.body(null, 204);
    } catch (error) {
      return c.text(errorText(error), 400);
    }
  });

  app.get("/sessions/:id/events", (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    return streamSSE(c, async (stream) => {
      const render = async (kind: "activity" | "turn_done") => {
        const view = await deps.workspace.viewSession(id);
        if (!view) return;
        if (kind === "turn_done") {
          await stream.writeSSE({
            event: "settled",
            data: await html(<Items items={view.turn} />),
          });
          await stream.writeSSE({ event: "turn", data: "" });
        } else {
          await stream.writeSSE({
            event: "turn",
            data: await html(<Items items={view.turn} />),
          });
        }
        await stream.writeSSE({
          event: "status",
          data: await html(<Status view={view} />),
        });
      };

      let timer: ReturnType<typeof setTimeout> | undefined;
      let queue: Promise<void> = Promise.resolve();
      const enqueue = (kind: "activity" | "turn_done") => {
        queue = queue
          .then(async () => {
            await render(kind);
          })
          .catch(() => {
            // A closed stream ends rendering; the abort handler cleans up.
          });
      };
      let aborted = false;
      stream.onAbort(() => {
        aborted = true;
      });
      const listener = (event: { type: string }) => {
        if (event.type === "activity") {
          // Coalesce bursts of deltas into one re-render per interval.
          timer ??= setTimeout(() => {
            timer = undefined;
            enqueue("activity");
          }, renderIntervalMs);
        } else if (event.type === "turn_done") {
          if (timer) clearTimeout(timer);
          timer = undefined;
          enqueue("turn_done");
        } else {
          void stream.close();
        }
      };
      // A page for a stored session opens its stream before any runtime
      // exists; wait for the first prompt to create one instead of closing.
      let unsubscribe = deps.workspace.subscribe(id, listener);
      while (!unsubscribe && !aborted) {
        await sleep(500);
        unsubscribe = deps.workspace.subscribe(id, listener);
      }
      if (!unsubscribe) return;
      // The client may have missed activity between page render and connect.
      enqueue("activity");
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      await new Promise<void>((resolve) => {
        heartbeat = setInterval(() => {
          queue = queue
            .then(async () => {
              await stream.write(": ping\n\n");
            })
            .catch(() => {
              resolve();
            });
        }, 30_000);
        stream.onAbort(() => {
          resolve();
        });
      });
      if (heartbeat) clearInterval(heartbeat);
      if (timer) clearTimeout(timer);
      unsubscribe();
    });
  });

  return app;
}
