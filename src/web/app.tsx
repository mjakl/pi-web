import { bashCommand, imageLimitError } from "@core/composer";
import type { ImageAttachment } from "@core/ports";
import { isSessionId } from "@core/sessions";
import { staticAssets } from "@web/assets";
import { ForbiddenPath, type Workspace } from "@core/workspace";
import { honoFactory } from "@web/hono";
import { HtmlLayout } from "@web/HtmlLayout";
import { renderMarkdown } from "@web/markdown";
import { CommandMenu, ComposerText, Toasts } from "@web/views/Composer";
import {
  EarlierPage,
  type ItemActions,
  Items,
  StarButton,
  TurnFragment,
} from "@web/views/Items";
import { IndexPage, NewSessionPage, SessionPage } from "@web/views/SessionPage";
import { SessionList, SessionRow } from "@web/views/Sidebar";
import { StatsPanel } from "@web/views/Stats";
import { Status } from "@web/views/Status";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Context } from "hono";
import { raw } from "hono/html";
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

/** Errors reach the reader as a toast, wherever the request came from. */
function toastHeader(
  c: Context,
  message: string,
  level: "info" | "warning" | "error" = "error",
): void {
  c.header(
    "HX-Trigger",
    JSON.stringify({ "web-pi:toast": { level, message } }),
  );
}

type Submission = {
  text: string;
  images: ImageAttachment[];
  behavior: "steer" | "followUp";
};

/** The composer's multipart body: text, attachments, and how to deliver it. */
async function readSubmission(
  form: FormData,
): Promise<Submission | { error: string }> {
  const files = form
    .getAll("images[]")
    .filter((value): value is File => value instanceof File && value.size > 0);
  const limit = imageLimitError(
    files.map((file) => ({ mimeType: file.type, bytes: file.size })),
  );
  if (limit) return { error: limit };
  const images = await Promise.all(
    files.map(async (file) => ({
      data: Buffer.from(await file.arrayBuffer()).toString("base64"),
      mimeType: file.type,
    })),
  );
  return {
    text: field(form, "text"),
    images,
    behavior: field(form, "behavior") === "followUp" ? "followUp" : "steer",
  };
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

  /** Reports the failure as a toast instead of breaking the page. */
  async function guard(
    c: Context,
    action: () => Promise<Response>,
  ): Promise<Response> {
    try {
      return await action();
    } catch (error) {
      toastHeader(c, errorText(error));
      c.header("HX-Reswap", "none");
      return c.body(null, 200);
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
    const submission = await readSubmission(form);
    if ("error" in submission) {
      toastHeader(c, submission.error);
      return c.body(null, 200);
    }
    if (!cwd || !submission.text) {
      toastHeader(c, "A working folder and a first request are required.");
      return c.body(null, 200);
    }
    return guard(c, async () => {
      const id = await deps.workspace.startSession(cwd, submission.text, {
        images: submission.images,
      });
      if (c.req.header("HX-Request") !== "true") {
        return c.redirect(`/sessions/${id}`, 303);
      }
      // The browser holds this session's draft under a provisional key.
      c.header(
        "HX-Trigger",
        JSON.stringify({ "web-pi:session-created": { cwd, id } }),
      );
      c.header("HX-Redirect", `/sessions/${id}`);
      return c.body(null, 200);
    });
  });

  app.get("/sessions/:id", async (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    const through = c.req.query("through");
    const options = {
      ...(c.req.query("leaf") === undefined
        ? {}
        : { leaf: c.req.query("leaf") }),
      ...(through === undefined ? {} : { through }),
    };
    const [groups, view] = await Promise.all([
      deps.workspace.listSessions(),
      deps.workspace.viewSession(id, options).catch(() => undefined),
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

  /**
   * One entry point for everything typed into the composer: built-in slash
   * commands, `!` shell runs, and prompts with attachments. Built-ins are
   * dispatched here rather than in the browser so a reload cannot lose them.
   */
  app.post("/sessions/:id/prompt", async (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    const form = await c.req.formData();
    const submission = await readSubmission(form);
    if ("error" in submission) {
      toastHeader(c, submission.error);
      return c.body(null, 200);
    }
    const { text, images, behavior } = submission;
    if (!text && images.length === 0) {
      toastHeader(c, "Type a request first.");
      return c.body(null, 200);
    }
    return guard(c, async () => {
      if (images.length === 0) {
        const shell = bashCommand(text);
        if (shell) {
          await deps.workspace.runBash(id, shell.command, shell.excluded);
          return c.body(null, 204);
        }
        const builtin = /^\/(compact|reload|name|clone)(?:\s+([\s\S]*))?$/.exec(
          text,
        );
        if (builtin) return runBuiltin(c, id, builtin[1] ?? "", builtin[2]);
      }
      await deps.workspace.send(id, text, { images, behavior });
      return c.body(null, 204);
    });
  });

  async function runBuiltin(
    c: Context,
    id: string,
    name: string,
    argument: string | undefined,
  ): Promise<Response> {
    const argumentText = argument?.trim() ?? "";
    switch (name) {
      case "compact":
        await deps.workspace.compact(
          id,
          argumentText === "" ? undefined : argumentText,
        );
        return c.body(null, 204);
      case "reload":
        await deps.workspace.reload(id);
        toastHeader(c, "Extensions, skills, and prompts reloaded.", "info");
        return c.body(null, 200);
      case "name":
        if (argumentText === "") {
          toastHeader(c, "Usage: /name <session name>");
          return c.body(null, 200);
        }
        await deps.workspace.rename(id, argumentText);
        toastHeader(c, `Renamed to "${argumentText}".`, "info");
        return c.body(null, 200);
      default: {
        const cloned = await deps.workspace.clone(id);
        c.header("HX-Redirect", `/sessions/${cloned}`);
        return c.body(null, 200);
      }
    }
  }

  app.get("/sessions/:id/commands", async (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    const commands = await deps.workspace.commands(id, c.req.query("q") ?? "");
    return c.html(<CommandMenu commands={commands} />);
  });

  app.post("/sessions/:id/compact", async (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    return guard(c, async () => {
      await deps.workspace.compact(id);
      return c.body(null, 204);
    });
  });

  app.post("/sessions/:id/compact/abort", (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    deps.workspace.abortCompaction(id);
    return c.body(null, 204);
  });

  /** Recall answers with the composer's textarea holding the queued texts. */
  app.post("/sessions/:id/queue/recall", (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    return c.html(<ComposerText draft={deps.workspace.recallQueue(id)} />);
  });

  app.post("/sessions/:id/queue/clear", (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    deps.workspace.clearQueue(id);
    return c.body(null, 204);
  });

  /** The previous page of a long transcript, with its own sentinel on top. */
  app.get("/sessions/:id/earlier", async (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    const leaf = c.req.query("leaf");
    const before = c.req.query("before");
    const through = c.req.query("through");
    if (before === undefined) return c.text("before is required", 400);
    let view;
    try {
      view = await deps.workspace.viewSession(id, {
        before,
        ...(leaf === undefined ? {} : { leaf }),
        ...(through === undefined ? {} : { through }),
      });
    } catch {
      return c.text("Unknown entry for this branch", 400);
    }
    if (!view) return c.notFound();
    return c.html(
      <EarlierPage
        items={view.items}
        actions={{
          sessionId: id,
          cwd: view.summary.cwd,
          starred: view.starred,
          ...(view.otherBranch ? { readOnly: true } : {}),
        }}
        hasMore={view.hasMore}
        {...(view.oldestId === undefined ? {} : { oldestId: view.oldestId })}
        {...(leaf === undefined ? {} : { leaf })}
      />,
    );
  });

  /** One thinking block, for the ones a long page left out. */
  app.get("/sessions/:id/entries/:entryId/thinking/:index", async (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    const index = Number(c.req.param("index"));
    if (!Number.isInteger(index) || index < 0) return c.notFound();
    const thinking = await deps.workspace.entryThinking(
      id,
      c.req.param("entryId"),
      index,
    );
    if (thinking === undefined) {
      return c.html(<p class="text-error">Thinking content unavailable</p>);
    }
    // No cwd here: reading the session again to resolve relative file links
    // would cost a full pass over the file for one collapsed block.
    return c.html(
      <div class="prose max-w-none break-words">
        {raw(renderMarkdown(thinking))}
      </div>,
    );
  });

  app.get("/sessions/:id/entries/:entryId/image/:index", async (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    const index = Number(c.req.param("index"));
    if (!Number.isInteger(index) || index < 0) return c.notFound();
    const image = await deps.workspace.entryImage(
      id,
      c.req.param("entryId"),
      index,
    );
    if (!image) return c.notFound();
    return c.body(Buffer.from(image.data, "base64"), 200, {
      "Content-Type": image.mimeType,
      "Cache-Control": "private, max-age=3600",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "X-Content-Type-Options": "nosniff",
    });
  });

  /** The two JSON endpoints of this phase: a menu cannot be a round trip. */
  app.get("/sessions/:id/file-index", async (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    return files(c, () =>
      deps.workspace.fileIndex(
        id,
        c.req.query("cwd"),
        (c.req.query("q") ?? "").slice(0, 500),
      ),
    );
  });

  app.get("/sessions/:id/file-completion", async (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    return files(c, async () => ({
      matches: await deps.workspace.fileCompletion(
        id,
        (c.req.query("q") ?? "").slice(0, 500),
        c.req.query("cwd"),
      ),
    }));
  });

  async function files(
    c: Context,
    action: () => Promise<unknown>,
  ): Promise<Response> {
    try {
      c.header("Cache-Control", "no-store");
      return c.json(await action());
    } catch (error) {
      if (error instanceof ForbiddenPath) return c.json({ error: "" }, 403);
      return c.json({ error: "Cannot list that directory" }, 404);
    }
  }

  app.get("/sessions/:id/bash-output", async (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    const path = c.req.query("path") ?? "";
    try {
      const output = await deps.workspace.bashOutput(id, path);
      return c.text(output, 200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
    } catch (error) {
      if (error instanceof ForbiddenPath) return c.text(errorText(error), 403);
      return c.text("Cannot read that output file", 404);
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
            actions={{
              sessionId: id,
              cwd: view.summary.cwd,
              starred: view.starred,
            }}
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
        const actions: ItemActions = {
          sessionId: id,
          cwd: view.summary.cwd,
          starred: view.starred,
        };
        if (kind === "turn_done") {
          await stream.writeSSE({
            event: "settled",
            data: await html(<Items items={view.turn} actions={actions} />),
          });
          await stream.writeSSE({ event: "turn", data: "" });
        } else {
          await stream.writeSSE({
            event: "turn",
            data: await html(
              <TurnFragment
                items={view.turn}
                actions={actions}
                status={view.status}
              />,
            ),
          });
        }
        await stream.writeSSE({
          event: "status",
          data: await html(<Status view={view} />),
        });
        // Notices are drained by the snapshot: send them once, as toasts.
        const notices = view.status?.notices ?? [];
        if (notices.length > 0) {
          await stream.writeSSE({
            event: "notice",
            data: await html(<Toasts notices={notices} />),
          });
        }
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
