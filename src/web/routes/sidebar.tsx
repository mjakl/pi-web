// The session list and its rows, the project selector, the folder picker,
// and the shared stream that keeps the list live. The sidebar area owns this
// module.

import { FileAccessError } from "@core/path-access";
import { type RuntimeEvent } from "@core/ports";
import { isSessionId, projectKeyOf } from "@core/sessions";
import {
  ProjectNav,
  ProjectPicker,
  ProjectSelect,
  RenameRow,
  SIDEBAR_PAGE,
  SessionList,
  SessionRow,
  SessionRows,
} from "@web/views/Sidebar";
import { BrowsePane, DirectoryPicker, FolderList } from "@web/views/Workspace";
import { getCookie, setCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import {
  type RouteContext,
  type WebApp,
  CWD_COOKIE,
  PROJECT_COOKIE,
  currentSessionId,
  errorText,
  field,
  fileFailure,
  html,
  toastHeader,
} from "./shared.ts";

export function sidebarRoutes(app: WebApp, ctx: RouteContext): void {
  const { deps, sidebarOf, remember, currentCwd, row, guard } = ctx;

  /**
   * Switching project or working folder: remember both, re-render the nav,
   * and send the pill along out of band so it names the new folder.
   * Validating the folder is also what makes files in it readable, the same
   * grant the picker's commit makes.
   */
  app.get("/sidebar", async (c) => {
    const project = c.req.query("project");
    const cwd = c.req.query("cwd");
    if (project !== undefined && project !== "") {
      setCookie(c, PROJECT_COOKIE, project, {
        path: "/",
        sameSite: "Lax",
        maxAge: 60 * 60 * 24 * 365,
      });
    }
    let folder = cwd;
    if (cwd !== undefined && cwd !== "") {
      const chosen = await deps.workspace
        .validateFolder(cwd)
        .catch(() => undefined);
      folder = chosen?.cwd ?? cwd;
      remember(c, CWD_COOKIE, folder);
    }
    const sidebar = await deps.workspace.sidebar(
      project === undefined ? {} : { remembered: project },
    );
    const activeId = currentSessionId(c);
    return c.html(
      <>
        <ProjectNav
          view={sidebar}
          {...(activeId === undefined ? {} : { activeId })}
        />
        {folder === undefined ? null : (
          <ProjectSelect
            view={sidebar}
            cwd={folder}
            oob
            {...(deps.home === undefined ? {} : { home: deps.home })}
          />
        )}
      </>,
    );
  });

  /** The projects to choose from; fetched when the selector opens. */
  app.get("/sidebar/projects", async (c) => {
    return c.html(
      <ProjectPicker
        view={await sidebarOf(c, currentSessionId(c))}
        cwd={currentCwd(c)}
        {...(deps.home === undefined ? {} : { home: deps.home })}
      />,
    );
  });

  /** The next page of rows for the project on screen. */
  app.get("/sidebar/rows", async (c) => {
    const project = c.req.query("project");
    const offset = Number(c.req.query("after") ?? "0");
    if (!Number.isInteger(offset) || offset < 0) return c.notFound();
    const view = await deps.workspace.sidebar(
      project === undefined || project === "" ? {} : { remembered: project },
    );
    const activeId = currentSessionId(c);
    return c.html(
      <SessionRows
        view={view}
        offset={offset}
        {...(activeId === undefined ? {} : { activeId })}
      />,
    );
  });

  /** The runs behind a collapsed "N subagent runs" line. */
  app.get("/sidebar/subagents", async (c) => {
    const project = c.req.query("project") ?? "";
    const parent = c.req.query("parent");
    const runs = await deps.workspace.subagentRuns(
      project,
      parent === undefined || parent === "" ? undefined : parent,
    );
    if (runs.length === 0) {
      return c.html(<li>No runs</li>);
    }
    // A project can hold thousands of runs; the newest page is enough to
    // find the one a reader is after.
    const shown = runs.slice(0, SIDEBAR_PAGE);
    return c.html(
      <>
        {shown.map((summary) => (
          <SessionRow summary={summary} />
        ))}
        {runs.length > shown.length ? (
          <li>{String(runs.length - shown.length)} older runs not shown</li>
        ) : null}
      </>,
    );
  });

  app.get("/sessions/:id/row", async (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    return row(c, id);
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

  /** The row turned into an input, which is how pi-web renames (§3.4). */
  app.get("/sessions/:id/rename", async (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    const found = await deps.workspace.row(id);
    if (!found) return c.notFound();
    return c.html(<RenameRow {...found} />);
  });

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

  app.post("/sessions/:id/clone", async (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    return guard(c, async () => {
      const cloned = await deps.workspace.clone(id);
      c.header("HX-Redirect", `/sessions/${cloned}`);
      return c.body(null, 200);
    });
  });

  // --- Workspace selection ------------------------------------------------

  app.get("/workspaces/picker", async (c) => {
    const browse = await deps.workspace
      .browse(currentCwd(c))
      .catch(() => deps.workspace.browse());
    return c.html(<DirectoryPicker {...browse} />);
  });

  /** The worktrees of one project row, probed when it is opened. */
  app.get("/workspaces/folders", async (c) => {
    const cwd = c.req.query("cwd") ?? "";
    if (cwd === "") return c.text("cwd is required", 400);
    try {
      const choice = await deps.workspace.folders(cwd);
      return await c.html(
        <FolderList
          choice={choice}
          {...(deps.home === undefined ? {} : { home: deps.home })}
        />,
      );
    } catch (error) {
      return fileFailure(c, error);
    }
  });

  /**
   * Directory names only. There is deliberately no allowed-root check here:
   * a reader has to be able to browse to a folder before validating it, and
   * listing a name grants no access to any file in it.
   */
  app.get("/workspaces/browse", async (c) => {
    const path = c.req.query("path");
    try {
      const listing = await deps.workspace.browse(
        path === undefined || path.trim() === "" ? undefined : path,
      );
      return await c.html(<BrowsePane {...listing} />);
    } catch (error) {
      const listing = await deps.workspace.browse();
      return c.html(<BrowsePane {...listing} error={errorText(error)} />);
    }
  });

  /**
   * The picker's commit. Validating is what makes a folder reachable, and the
   * project root it resolves to is the sidebar's key for it, so both cookies
   * are written here and the reader lands on a new session in that folder.
   */
  app.post("/workspaces/validate", async (c) => {
    const form = await c.req.formData();
    try {
      const chosen = await deps.workspace.validateFolder(field(form, "cwd"));
      remember(c, CWD_COOKIE, chosen.cwd);
      remember(c, PROJECT_COOKIE, chosen.projectRoot);
      if (c.req.header("HX-Request") !== "true") {
        return c.json({ ...chosen, projectKey: chosen.projectRoot });
      }
      c.header("HX-Redirect", "/new");
      return c.body(null, 200);
    } catch (error) {
      if (c.req.header("HX-Request") === "true") {
        toastHeader(c, errorText(error));
        c.header("HX-Reswap", "none");
        return c.body(null, 200);
      }
      if (error instanceof FileAccessError) {
        return c.json({ error: error.message }, error.status);
      }
      return c.json({ error: "Cannot use that folder" }, 400);
    }
  });

  /**
   * One stream for the sidebar: every session's lifecycle, re-rendered. Rows
   * are only sent for the project on screen — the other few thousand sessions
   * have no row to swap — while the selector's badges are re-sent whenever the
   * running counts change, so activity elsewhere still shows.
   */
  app.get("/events", (c) => {
    const remembered = getCookie(c, PROJECT_COOKIE);
    const activeId = currentSessionId(c);
    const cwd = currentCwd(c);
    return streamSSE(c, async (stream) => {
      let badges = "";
      let queue: Promise<void> = Promise.resolve();
      const sidebar = () =>
        deps.workspace.sidebar({
          ...(remembered === undefined ? {} : { remembered }),
          ...(activeId === undefined ? {} : { activeId }),
        });
      const send = (event: RuntimeEvent) => {
        // A completed run is the session stream's business; this one is the
        // sidebar's, and a session that completed also emits `finished`.
        if (event.type === "completed") return;
        queue = queue
          .then(async () => {
            const view = await sidebar();
            const found = await deps.workspace.row(event.sessionId);
            const project = found && projectKeyOf(found.summary);
            if (found && project === view.selected) {
              // A session with no row yet needs the whole list; an existing
              // row is swapped on its own.
              const known = view.sessions.some(
                (row) => row.summary.id === event.sessionId,
              );
              await stream.writeSSE({
                event: "rows",
                data: await html(
                  known && event.type !== "opened" ? (
                    <SessionRow {...found} oob />
                  ) : (
                    <SessionList
                      view={view}
                      oob
                      {...(activeId === undefined ? {} : { activeId })}
                    />
                  ),
                ),
              });
            }
            const signature = view.projects
              .map((entry) => `${entry.key}:${String(entry.running)}`)
              .join("|");
            if (signature !== badges) {
              badges = signature;
              await stream.writeSSE({
                event: "rows",
                data: await html(
                  <ProjectSelect
                    view={view}
                    cwd={cwd}
                    oob
                    {...(deps.home === undefined ? {} : { home: deps.home })}
                  />,
                ),
              });
            }
            if (event.type === "finished") {
              // The browser marks it unread; the project it belongs to is
              // what the selector needs to badge.
              await stream.writeSSE({
                event: "finished",
                data: JSON.stringify({
                  id: event.sessionId,
                  project: project ?? "",
                }),
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
    });
  });
}
