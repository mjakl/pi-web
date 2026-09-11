// Everything the composer sends and everything it needs to offer: prompts,
// commands, the queue, the model, and the session's own event stream. The
// composer area owns this module.

import { bashCommand } from "@core/composer";
import { FileAccessError } from "@core/path-access";
import { type ThinkingLevel } from "@core/ports";
import { isSessionId } from "@core/sessions";
import { ForbiddenPath } from "@core/workspace";
import {
  CommandMenu,
  ComposerText,
  ModelSelector,
  modelPick,
  RecalledImages,
  Toasts,
} from "@web/views/Composer";
import {
  CustomFrameBody,
  CustomPanelBody,
  ExtensionDialogBody,
  customSignature,
  dialogSignature,
} from "@web/views/Extensions";
import { type ItemActions, Items, TurnFragment } from "@web/views/Items";
import { Rail } from "@web/views/Rail";
import { ShelfBody, changedWidgets, shelfSignature } from "@web/views/Shelf";
import { Status } from "@web/views/Status";
import { type Context } from "hono";
import { streamSSE } from "hono/streaming";
import {
  type RouteContext,
  type WebApp,
  disposition,
  errorText,
  field,
  html,
  readSubmission,
  sleep,
  toastHeader,
} from "./shared.ts";

export function composerRoutes(app: WebApp, ctx: RouteContext): void {
  const { deps, renderIntervalMs, warnTokens, guard } = ctx;

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
    const [provider, ...rest] = field(form, "model").split("/");
    const modelId = rest.join("/");
    const thinking = field(form, "thinking");
    return guard(c, async () => {
      const id = await deps.workspace.startSession(
        cwd,
        submission.text,
        { images: submission.images },
        {
          ...(provider && modelId ? { model: { provider, modelId } } : {}),
          ...(thinking ? { thinkingLevel: thinking as ThinkingLevel } : {}),
        },
      );
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

  /**
   * Recall answers with the composer's textarea holding the queued texts, and
   * the images those messages carried riding along out of band for the client
   * bundle to put back into the attachment strip.
   */
  app.post("/sessions/:id/queue/recall", (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    const recalled = deps.workspace.recallQueue(id);
    return c.html(
      <>
        <ComposerText draft={recalled.text} />
        <RecalledImages images={recalled.images} />
      </>,
    );
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
      if (error instanceof FileAccessError) {
        return c.json({ error: "" }, error.status);
      }
      return c.json({ error: "Cannot list that directory" }, 404);
    }
  }

  app.get("/sessions/:id/bash-output", async (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    const path = c.req.query("path") ?? "";
    const download = c.req.query("download") === "1";
    try {
      const output = await deps.workspace.bashOutput(id, path);
      return c.text(output, 200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...(download
          ? { "Content-Disposition": disposition("bash-output.log", true) }
          : {}),
      });
    } catch (error) {
      if (error instanceof ForbiddenPath) return c.text(errorText(error), 403);
      // Too large to read is not "missing": the reader is told the size and
      // the cap rather than being sent looking for a file that is right there.
      if (error instanceof FileAccessError) {
        return c.text(errorText(error), error.status);
      }
      return c.text("Cannot read that output file", 404);
    }
  });

  app.post("/sessions/:id/abort", async (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    await deps.workspace.abort(id);
    return c.body(null, 204);
  });

  /**
   * The composer's model menu. The pick rides in the query so the request
   * carries none of the composer form it was clicked inside, and the answer
   * is the re-rendered selector, which is what closes the popover and shows
   * the new name.
   */
  app.post("/sessions/:id/model", async (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    const [provider, ...rest] = (c.req.query("model") ?? "").split("/");
    const modelId = rest.join("/");
    // Only the reasoning select posts a body; the option buttons send none.
    const thinking = await c.req
      .formData()
      .then((form) => field(form, "thinking"))
      .catch(() => "");
    if (!provider || !modelId) return c.text("model is required", 400);
    try {
      await deps.workspace.setModel(id, {
        provider,
        modelId,
        ...(thinking ? { thinkingLevel: thinking as ThinkingLevel } : {}),
      });
    } catch (error) {
      return c.text(errorText(error), 400);
    }
    const view = await deps.workspace.viewSession(id, warnTokens(c));
    if (!view) return c.notFound();
    return c.html(<ModelSelector pick={modelPick(view)} />);
  });

  /**
   * The same menu before a session exists: nothing is applied, the pick is
   * only recorded in the hidden field the first prompt posts.
   */
  app.get("/workspaces/model-selector", async (c) => {
    const cwd = c.req.query("cwd") ?? "";
    const picked = c.req.query("model") ?? "";
    return guard(c, async () => {
      const view = await deps.workspace.newSession(cwd);
      const chosen = view.models.find(
        (model) => `${model.provider}/${model.id}` === picked,
      );
      return c.html(
        <ModelSelector
          pick={{
            models: view.models,
            current: chosen ?? view.model ?? null,
            levels: chosen?.thinkingLevels ?? view.model?.thinkingLevels ?? [],
            ...(chosen ? {} : { level: view.thinkingLevel }),
            auto: true,
            cwd: view.cwd,
          }}
        />,
      );
    });
  });

  // --- Composer menus before a session exists ------------------------------

  app.get("/workspaces/commands", async (c) => {
    const cwd = c.req.query("cwd") ?? "";
    return guard(c, async () => {
      const commands = await deps.workspace.folderCommands(
        cwd,
        c.req.query("q") ?? "",
      );
      return c.html(<CommandMenu commands={commands} />);
    });
  });

  for (const [path, isPath] of [
    ["file-index", false],
    ["file-completion", true],
  ] as const) {
    app.get(`/workspaces/${path}`, async (c) => {
      const cwd = c.req.query("cwd") ?? "";
      try {
        return c.json(
          await deps.workspace.folderFiles(cwd, c.req.query("q") ?? "", isPath),
        );
      } catch (error) {
        const status = error instanceof FileAccessError ? error.status : 400;
        return c.json({ error: errorText(error) }, status);
      }
    });
  }

  app.get("/sessions/:id/events", (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    const thresholds = warnTokens(c);
    return streamSSE(c, async (stream) => {
      // The shelf holds open panels, so it is only re-sent when an extension
      // actually changed a status or a widget.
      let shelf = "";
      // The model selector is a whole subtree with an open popover in it, and
      // a turn renders ten times a second: send it only when the pick moved.
      let model = "";
      // Same for the dialog and the custom-UI shell: re-sending either would
      // wipe what the reader typed, or take focus out of the panel.
      let dialog = "";
      let custom = "";
      let frame = "";
      const widgetLines = new Map<string, string>();
      const render = async (kind: "activity" | "turn_done") => {
        const view = await deps.workspace.viewSession(id, thresholds);
        if (!view) return;
        const actions: ItemActions = {
          sessionId: id,
          cwd: view.summary.cwd,
          starred: view.starred,
        };
        if (kind === "turn_done") {
          // The rail rides along out of band: a settled turn is the only
          // thing that adds marks to it.
          await stream.writeSSE({
            event: "settled",
            data: await html(
              <>
                <Items items={view.settledTurn} actions={actions} />
                <Rail view={view} oob />
              </>,
            ),
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
        const pick = modelPick(view);
        const nextModel = JSON.stringify([
          pick.current,
          pick.level,
          pick.levels,
          pick.models.length,
        ]);
        const modelChanged = nextModel !== model;
        model = nextModel;
        await stream.writeSSE({
          event: "status",
          data: await html(<Status view={view} model={modelChanged} oob />),
        });
        const signature = shelfSignature(view.status);
        if (signature !== shelf) {
          shelf = signature;
          await stream.writeSSE({
            event: "shelf",
            data: await html(
              <ShelfBody
                status={view.status}
                updated={changedWidgets(widgetLines, view.status)}
              />,
            ),
          });
        }
        const nextDialog = dialogSignature(view.status?.dialog ?? null);
        if (nextDialog !== dialog) {
          dialog = nextDialog;
          await stream.writeSSE({
            event: "dialog",
            data: await html(
              <ExtensionDialogBody
                sessionId={id}
                dialog={view.status?.dialog ?? null}
              />,
            ),
          });
        }
        const panel = view.status?.custom ?? null;
        if ((panel?.id ?? "") !== custom) {
          custom = panel?.id ?? "";
          frame = "";
          await stream.writeSSE({
            event: "custom",
            data: await html(<CustomPanelBody sessionId={id} frame={panel} />),
          });
        }
        const nextFrame = customSignature(panel);
        if (nextFrame !== frame) {
          frame = nextFrame;
          await stream.writeSSE({
            event: "custom-frame",
            data: await html(<CustomFrameBody frame={panel} />),
          });
        }
        // Text an extension asked to put in the composer, and a title it set.
        for (const text of view.status?.editorText ?? []) {
          await stream.writeSSE({
            event: "editor",
            data: await html(<span data-insert={text} />),
          });
        }
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
      /**
       * The agent finished a run and went idle. The browser decides what to
       * do with it — a tone, a notification, an unread dot — because only it
       * knows whether anyone is looking.
       */
      const announceDone = () => {
        queue = queue
          .then(async () => {
            await stream.writeSSE({ event: "done", data: id });
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
        } else if (event.type === "completed") {
          announceDone();
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
}
