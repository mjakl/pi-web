import { isSessionId } from "@core/sessions";
import { staticAssets } from "@web/assets";
import type { Workspace } from "@core/workspace";
import { honoFactory } from "@web/hono";
import { HtmlLayout } from "@web/HtmlLayout";
import { Items, StarButton } from "@web/views/Items";
import {
  IndexPage,
  NewSessionPage,
  Notice,
  SessionPage,
} from "@web/views/SessionPage";
import { SessionList, SessionRow } from "@web/views/Sidebar";
import { StatsPanel } from "@web/views/Stats";
import { Status } from "@web/views/Status";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Context } from "hono";
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
  const assets = staticAssets(deps.staticRoot);

  /** The whole session page, swapped into <body> after a history change. */
  async function page(
    c: Context,
    id: string,
    draft?: string,
  ): Promise<Response> {
    const [groups, view] = await Promise.all([
      deps.workspace.listSessions(),
      deps.workspace.viewSession(id),
    ]);
    if (!view) return c.notFound();
    c.header("HX-Push-Url", `/sessions/${id}`);
    return c.render(<SessionPage groups={groups} view={view} draft={draft} />);
  }

  async function row(c: Context, id: string): Promise<Response> {
    const found = await deps.workspace.row(id);
    if (!found) return c.notFound();
    return c.html(<SessionRow {...found} />);
  }

  /** Reports the failure in the shared notice instead of breaking the page. */
  async function guard(
    c: Context,
    action: () => Promise<Response>,
  ): Promise<Response> {
    try {
      return await action();
    } catch (error) {
      c.header("HX-Retarget", "#notice");
      c.header("HX-Reswap", "innerHTML");
      return c.html(<Notice message={errorText(error)} />);
    }
  }

  app.use("*", (c, next) => {
    c.set("workspace", deps.workspace);
    c.set("assets", assets);
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
    return c.render(
      <NewSessionPage
        groups={groups}
        cwd={c.req.query("cwd") ?? deps.defaultCwd}
        draft={c.req.query("text")}
      />,
    );
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
      deps.workspace.viewSession(id, c.req.query("leaf")),
    ]);
    if (!view) return c.notFound();
    return c.render(<SessionPage groups={groups} view={view} />);
  });

  app.get("/sessions/:id/row", async (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    return row(c, id);
  });

  app.get("/sessions/:id/stats", async (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    const found = await deps.workspace.sessionStats(id);
    if (!found) return c.notFound();
    return c.html(<StatsPanel {...found} />);
  });

  app.get("/sessions/:id/export", async (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    try {
      const exported = await deps.workspace.exportHtml(id);
      return c.body(exported.html, 200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `inline; filename="${exported.filename}"`,
        "Cache-Control": "no-cache",
        "Content-Security-Policy": "frame-ancestors 'none'",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
      });
    } catch (error) {
      return c.text(errorText(error), 500);
    }
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

  // Row actions. Each answers with the row it changed, so the sidebar updates
  // without a page load.
  for (const [path, act] of [
    ["stop", (id: string) => deps.workspace.stop(id)],
    ["activate", (id: string) => deps.workspace.activate(id)],
    ["stars/clear", (id: string) => deps.workspace.clearStars(id)],
  ] as const) {
    app.post(`/sessions/:id/${path}`, async (c) => {
      const id = c.req.param("id");
      if (!isSessionId(id)) return c.notFound();
      return guard(c, async () => {
        await act(id);
        return row(c, id);
      });
    });
  }

  app.post("/sessions/:id/rename", async (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    const form = await c.req.formData();
    return guard(c, async () => {
      await deps.workspace.rename(id, field(form, "name"));
      return row(c, id);
    });
  });

  app.post("/sessions/:id/delete", async (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    return guard(c, async () => {
      await deps.workspace.remove(id);
      if (c.req.header("HX-Current-URL")?.includes(`/sessions/${id}`)) {
        c.header("HX-Redirect", "/");
      }
      return c.body(null, 200);
    });
  });

  app.post("/sessions/:id/star", async (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    const form = await c.req.formData();
    const entryId = field(form, "entryId");
    const starred = field(form, "starred") === "true";
    return guard(c, async () => {
      await deps.workspace.setStar(id, entryId, starred);
      const [view, found] = await Promise.all([
        deps.workspace.viewSession(id),
        deps.workspace.row(id),
      ]);
      if (!view) return c.notFound();
      return c.html(
        <>
          <StarButton
            entryId={entryId}
            actions={{ sessionId: id, starred: view.starred }}
          />
          {found ? <SessionRow {...found} oob /> : null}
        </>,
      );
    });
  });

  app.post("/sessions/:id/clone", async (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    return guard(c, async () => {
      const cloned = await deps.workspace.clone(id);
      c.header("HX-Redirect", `/sessions/${cloned}`);
      return c.body(null, 200);
    });
  });

  app.post("/sessions/:id/fork", async (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    const form = await c.req.formData();
    return guard(c, async () => {
      const forked = await deps.workspace.fork(id, field(form, "entryId"));
      return page(c, forked.id, forked.text);
    });
  });

  // Both "New branch" on a message and switching to another branch: Pi moves
  // the leaf and hands back the text of a user message to edit again.
  app.post("/sessions/:id/navigate", async (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    const form = await c.req.formData();
    return guard(c, async () => {
      const draft = await deps.workspace.navigateTree(
        id,
        field(form, "entryId"),
      );
      return page(c, id, draft);
    });
  });

  app.post("/sessions/:id/rewind", async (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    const form = await c.req.formData();
    return guard(c, async () => {
      const draft = await deps.workspace.rewind(id, field(form, "entryId"));
      return page(c, id, draft);
    });
  });

  /** One stream for the sidebar: every session's lifecycle, re-rendered. */
  app.get("/events", (c) =>
    streamSSE(c, async (stream) => {
      let queue: Promise<void> = Promise.resolve();
      const send = (event: {
        type: "opened" | "finished" | "stopped";
        sessionId: string;
      }) => {
        queue = queue
          .then(async () => {
            if (event.type === "opened") {
              // A session that was not in the list yet has no row to swap.
              const groups = await deps.workspace.listSessions();
              await stream.writeSSE({
                event: "rows",
                data: await html(<SessionList groups={groups} oob />),
              });
              return;
            }
            const found = await deps.workspace.row(event.sessionId);
            if (found) {
              await stream.writeSSE({
                event: "rows",
                data: await html(<SessionRow {...found} oob />),
              });
            }
            if (event.type === "finished") {
              await stream.writeSSE({
                event: "finished",
                data: event.sessionId,
              });
            }
          })
          .catch(() => {
            // A closed stream ends rendering; the abort handler cleans up.
          });
      };
      const unsubscribe = deps.workspace.subscribeSessions(send);
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
      unsubscribe();
    }),
  );

  app.get("/sessions/:id/events", (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    return streamSSE(c, async (stream) => {
      const render = async (kind: "activity" | "turn_done") => {
        const view = await deps.workspace.viewSession(id);
        if (!view) return;
        const actions = { sessionId: id, starred: view.starred };
        if (kind === "turn_done") {
          await stream.writeSSE({
            event: "settled",
            data: await html(<Items items={view.turn} actions={actions} />),
          });
          await stream.writeSSE({ event: "turn", data: "" });
        } else {
          await stream.writeSSE({
            event: "turn",
            data: await html(<Items items={view.turn} actions={actions} />),
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
