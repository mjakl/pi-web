// The file explorer, the viewer, the watch stream, and Git changes. The
// files area owns this module.

import { extensionOf, mimeOf } from "@core/file-types";
import { FileAccessError } from "@core/path-access";
import { type GitChangeFile } from "@core/ports";
import { isSessionId } from "@core/sessions";
import { type Workspace } from "@core/workspace";
import {
  Explorer,
  SearchResults,
  type TreeContext,
  TreeNodes,
  type ViewMode,
  Viewer,
  defaultMode,
} from "@web/views/Files";
import { type Context } from "hono";
import { streamSSE } from "hono/streaming";
import {
  type RouteContext,
  type WebApp,
  disposition,
  fileFailure,
} from "./shared.ts";

export function filesRoutes(app: WebApp, ctx: RouteContext): void {
  const { deps } = ctx;

  // --- Files, Git, and the viewer ----------------------------------------
  //
  // Every route here goes through the workspace's one containment policy and
  // maps `FileAccessError` onto the status it carries. `session` is optional:
  // it names the folder the panel is rooted in, and it is what lets a file a
  // transcript mentioned be read from outside the allowed roots.

  function sessionParameter(c: Context): string | undefined {
    const id = c.req.query("session");
    return id !== undefined && isSessionId(id) ? id : undefined;
  }

  async function treeContext(sessionId: string): Promise<
    | {
        context: TreeContext;
        status: Awaited<ReturnType<Workspace["gitChanges"]>>;
      }
    | undefined
  > {
    const cwd = await deps.workspace.sessionFolder(sessionId);
    if (cwd === undefined) return undefined;
    const status = await deps.workspace.gitChanges(sessionId);
    const changes = new Map<string, GitChangeFile>(
      status.files.map((file) => [file.path, file]),
    );
    return { context: { sessionId, cwd, changes }, status };
  }

  app.get("/files/explorer", async (c) => {
    const sessionId = sessionParameter(c);
    if (sessionId === undefined) return c.notFound();
    try {
      const found = await treeContext(sessionId);
      if (!found) return await c.notFound();
      // The sidebar's changed-files toggle asks for the same fragment with
      // the changes list in place of the tree, as pi-web swaps the two. With
      // nothing changed there is no list to show, so the tree stays.
      const changes =
        c.req.query("changes") === "1" && found.status.files.length > 0;
      const listing = changes
        ? { entries: [] }
        : await deps.workspace.listDirectory(sessionId, found.context.cwd);
      return await c.html(
        <Explorer
          context={found.context}
          status={found.status}
          entries={listing.entries}
          changes={changes}
        />,
      );
    } catch (error) {
      return fileFailure(c, error);
    }
  });

  app.get("/files/tree", async (c) => {
    const sessionId = sessionParameter(c);
    const path = c.req.query("path") ?? "";
    const depth = Number(c.req.query("depth") ?? "1");
    if (sessionId === undefined || !Number.isInteger(depth) || depth < 0) {
      return c.notFound();
    }
    try {
      const found = await treeContext(sessionId);
      if (!found) return await c.notFound();
      const listing = await deps.workspace.listDirectory(sessionId, path);
      return await c.html(
        <TreeNodes
          context={found.context}
          directory={path}
          entries={listing.entries}
          depth={depth}
        />,
      );
    } catch (error) {
      return fileFailure(c, error);
    }
  });

  /** An empty query puts the tree back; that is what closing search means. */
  app.get("/files/search", async (c) => {
    const sessionId = sessionParameter(c);
    if (sessionId === undefined) return c.notFound();
    const query = (c.req.query("q") ?? "").slice(0, 500).trim();
    try {
      const found = await treeContext(sessionId);
      if (!found) return await c.notFound();
      if (query === "") {
        const listing = await deps.workspace.listDirectory(
          sessionId,
          found.context.cwd,
        );
        return await c.html(
          <Explorer
            context={found.context}
            status={found.status}
            entries={listing.entries}
            changes={false}
          />,
        );
      }
      const matches = await deps.workspace.searchFiles(sessionId, query);
      return await c.html(
        <SearchResults
          context={found.context}
          matches={matches.map((entry) => entry.path)}
        />,
      );
    } catch (error) {
      return fileFailure(c, error);
    }
  });

  app.get("/files/view", async (c) => {
    const sessionId = sessionParameter(c);
    const path = c.req.query("path") ?? "";
    try {
      const view = await deps.workspace.fileView(sessionId, path);
      const asked = c.req.query("mode");
      const mode: ViewMode =
        asked === "source" || asked === "preview" || asked === "diff"
          ? asked
          : defaultMode(view, c.req.query("hint"));
      // A mode the file does not offer falls back rather than showing an
      // empty pane: a diff can disappear between two requests.
      const shown: ViewMode =
        mode === "diff" && view.diff === undefined ? "source" : mode;
      return await c.html(
        <Viewer view={view} mode={shown} sessionId={sessionId ?? ""} />,
      );
    } catch (error) {
      return fileFailure(c, error);
    }
  });

  app.get("/files/meta", async (c) => {
    const sessionId = sessionParameter(c);
    try {
      const meta = await deps.workspace.fileMeta(
        sessionId,
        c.req.query("path") ?? "",
      );
      c.header("Cache-Control", "no-store");
      return c.json(meta);
    } catch (error) {
      if (error instanceof FileAccessError) {
        return c.json({ error: error.message }, error.status);
      }
      return c.json({ error: "Cannot read that file" }, 500);
    }
  });

  const RANGE = /^bytes=(\d*)-(\d*)$/;

  app.get("/files/raw", async (c) => {
    const sessionId = sessionParameter(c);
    const path = c.req.query("path") ?? "";
    const download = c.req.query("download") === "1";
    try {
      const header = c.req.header("Range");
      // One call only: every `fileBytes` opens a stream, and a second one
      // would leak the file descriptor of the first.
      const meta = await deps.workspace.fileMeta(sessionId, path);
      const { size } = meta;
      const mime = download ? "application/octet-stream" : mimeOf(path);
      const headers: Record<string, string> = {
        "Content-Type": mime,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": disposition(path, download),
      };
      // An SVG opened directly would run its own script in this origin.
      if (mime === "image/svg+xml") {
        headers["Content-Security-Policy"] =
          "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
      }
      if (header === undefined) {
        const { stream } = await deps.workspace.fileBytes(sessionId, path);
        return c.body(stream, 200, {
          ...headers,
          "Content-Length": String(size),
        });
      }
      const match = RANGE.exec(header);
      const unsatisfiable = () =>
        c.body(null, 416, {
          ...headers,
          "Content-Range": `bytes */${String(size)}`,
        });
      if (!match) return unsatisfiable();
      const [, first = "", last = ""] = match;
      let start: number;
      let end: number;
      if (first === "") {
        // Suffix form: the last N bytes.
        const length = Number(last);
        if (last === "" || !Number.isFinite(length) || length <= 0) {
          return unsatisfiable();
        }
        start = Math.max(0, size - length);
        end = size - 1;
      } else {
        start = Number(first);
        end = last === "" ? size - 1 : Number(last);
      }
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        return unsatisfiable();
      }
      end = Math.min(end, size - 1);
      if (start > end || start >= size) return unsatisfiable();
      const { stream } = await deps.workspace.fileBytes(sessionId, path, {
        start,
        end,
      });
      return c.body(stream, 206, {
        ...headers,
        "Content-Range": `bytes ${String(start)}-${String(end)}/${String(size)}`,
        "Content-Length": String(end - start + 1),
      });
    } catch (error) {
      return fileFailure(c, error);
    }
  });

  app.get("/files/docx", async (c) => {
    const sessionId = sessionParameter(c);
    const path = c.req.query("path") ?? "";
    if (extensionOf(path) !== "docx") return c.text("Not a Word document", 400);
    try {
      const body = await deps.workspace.docxPreview(sessionId, path);
      return c.body(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>body{font:14px/1.6 system-ui,sans-serif;margin:1rem;color:#1a1a1a;background:#fff}img{max-width:100%}</style></head><body>${body}</body></html>`,
        200,
        {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy":
            "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-cache",
        },
      );
    } catch (error) {
      return fileFailure(c, error);
    }
  });

  /** One stream per open tab: the viewer re-reads whenever the file moves. */
  app.get("/files/watch", (c) => {
    const sessionId = sessionParameter(c);
    const path = c.req.query("path") ?? "";
    return streamSSE(c, async (stream) => {
      let queue: Promise<void> = Promise.resolve();
      const send = (event: string, data: string) => {
        queue = queue
          .then(async () => {
            await stream.writeSSE({ event, data });
          })
          .catch(() => {
            // A closed stream ends the watch; the abort handler cleans up.
          });
      };
      const fail = (message: string) => {
        queue = queue
          .then(async () => {
            await stream.writeSSE({
              event: "error",
              data: JSON.stringify({ message }),
            });
            await stream.close();
          })
          .catch(() => {
            // Already closed.
          });
        return queue;
      };
      let stop: (() => void) | undefined;
      try {
        stop = await deps.workspace.watchFile(sessionId, path, {
          change(info) {
            send("change", JSON.stringify(info));
          },
          error() {
            void fail("Failed to watch file");
          },
        });
      } catch (error) {
        await fail(
          error instanceof FileAccessError
            ? error.message
            : "Failed to watch file",
        );
        return;
      }
      send("connected", JSON.stringify({ path }));
      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          resolve();
        });
      });
      stop();
    });
  });
}
