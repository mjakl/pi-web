// Transcript pages and fragments: paging, entry sub-resources, stars,
// branching, and the export. The transcript area owns this module.

import { isSessionId } from "@core/sessions";
import { renderMarkdown } from "@web/markdown";
import { EarlierPage, StarButton, ToolBody } from "@web/views/Items";
import { SessionRow } from "@web/views/Sidebar";
import { turnBusy } from "@web/views/Status";
import { raw } from "hono/html";
import {
  type RouteContext,
  type WebApp,
  currentSessionId,
  errorText,
  field,
} from "./shared.ts";

export function transcriptRoutes(app: WebApp, ctx: RouteContext): void {
  const { deps, page, guard } = ctx;

  app.get("/sessions/:id/last-assistant-text", async (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    c.header("Cache-Control", "no-store");
    return c.text((await deps.workspace.lastAssistantText(id)) ?? "");
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
          ...(turnBusy(view.status) ? { busy: true } : {}),
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
      return c.html(<p>Thinking content unavailable</p>);
    }
    // No cwd here: reading the session again to resolve relative file links
    // would cost a full pass over the file for one collapsed block.
    return c.html(
      <div class="markdown-body markdown-assistant-message">
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
          {found ? (
            <SessionRow {...found} activeId={currentSessionId(c) ?? ""} oob />
          ) : null}
        </>,
      );
    });
  });

  app.post("/sessions/:id/fork", async (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    const form = await c.req.formData();
    return guard(c, async () => {
      const forked = await deps.workspace.fork(id, field(form, "entryId"));
      return page(c, forked.id, forked.text, forked.images);
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
      return page(c, id, draft.text, draft.images);
    });
  });

  /** The full body behind a truncated tool result. */
  app.get("/sessions/:id/entries/:entryId/tool-result/:callId", async (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    const call = await deps.workspace.toolCall(
      id,
      c.req.param("entryId"),
      c.req.param("callId"),
    );
    if (!call) return c.notFound();
    const view = await deps.workspace.viewSession(id);
    return c.html(
      <ToolBody
        call={call}
        {...(view
          ? {
              actions: {
                sessionId: id,
                cwd: view.summary.cwd,
                starred: view.starred,
              },
            }
          : {})}
        {...(c.req.query("full") === "1" ? { full: true } : {})}
      />,
    );
  });
}
