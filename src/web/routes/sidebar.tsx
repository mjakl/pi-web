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
  SessionList,
  SessionRow,
  SessionRows,
} from "@web/views/Sidebar";
import { Partial } from "@web/views/Partial";
import { BrowsePane, DirectoryPicker, FolderList } from "@web/views/Workspace";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import {
  type RouteContext,
  type WebApp,
  CWD_COOKIE,
  PROJECT_COOKIE,
  SESSION_COOKIE,
  currentSessionId,
  errorText,
  field,
  fileFailure,
  html,
  sessionLocation,
  toastHeader,
} from "./shared.ts";

export function sidebarRoutes(app: WebApp, ctx: RouteContext): void {
  const { deps, sidebarOf, remember, currentCwd, row, guard } = ctx;

  /**
   * Switching project or working folder: remember both, re-render the nav,
   * and send the pill along out of band so it names the new folder.
   * Validating the folder is also what makes files in it readable, the same
   * grant the picker's commit makes.
   *
   * A session stays open across the worktrees of its own project and closes
   * when the selector moves to another one, as in pi-web (AppShell.tsx
   * handleCwdChange): the reader lands on the
   * new-session view under the folder just chosen, so the list, the chat,
   * the explorer and every page opened from here agree on the project.
   */
  app.get("/sidebar", async (c) => {
    const project = c.req.query("project");
    const cwd = c.req.query("cwd");
    const inApp = c.req.header("HX-Request") === "true";
    if (!inApp && project !== undefined && project !== "") {
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
      if (!inApp) remember(c, CWD_COOKIE, folder);
    }
    const activeId = currentSessionId(c);
    const open =
      activeId === undefined ? undefined : await deps.workspace.row(activeId);
    const sidebar = await deps.workspace.sidebar(
      project === undefined ? {} : { remembered: project },
    );
    if (
      (open &&
        project !== undefined &&
        project !== "" &&
        projectKeyOf(open.summary) !== project) ||
      (inApp && !open && (folder !== undefined || project !== undefined))
    ) {
      if (inApp) {
        const destination =
          folder ??
          sidebar.projects.find((entry) => entry.key === sidebar.selected)
            ?.entryPath ??
          currentCwd(c, sidebar);
        sessionLocation(c, `/new?cwd=${encodeURIComponent(destination)}`);
      } else {
        deleteCookie(c, SESSION_COOKIE, { path: "/" });
        c.header("HX-Redirect", "/");
      }
      return c.body(null, 200);
    }
    return c.html(
      <>
        <ProjectNav
          view={sidebar}
          cwd={folder}
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
    const view = await sidebarOf(c, currentSessionId(c));
    return c.html(
      <ProjectPicker
        view={view}
        cwd={currentCwd(c, view)}
        {...(deps.home === undefined ? {} : { home: deps.home })}
      />,
    );
  });

  /** The next page of rows for the project on screen. */
  app.get("/sidebar/rows", async (c) => {
    const project = c.req.query("project");
    const offset = Number(c.req.query("after") ?? "0");
    if (!Number.isInteger(offset) || offset < 0) return c.notFound();
    const view = await deps.workspace.sidebar({
      offset,
      ...(project === undefined || project === ""
        ? {}
        : { remembered: project }),
    });
    const activeId = currentSessionId(c);
    return c.html(
      <SessionRows
        view={view}
        {...(activeId === undefined ? {} : { activeId })}
      />,
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
      if (currentSessionId(c) === id) {
        if (c.req.header("HX-Request") === "true")
          sessionLocation(c, `/new?cwd=${encodeURIComponent(currentCwd(c))}`);
        else c.header("HX-Redirect", "/");
      }
      return c.body(null, 200);
    });
  });

  app.post("/sessions/:id/clone", async (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    return guard(c, async () => {
      const cloned = await deps.workspace.clone(id);
      sessionLocation(c, `/sessions/${cloned}`);
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
   * project root it resolves to is the sidebar's key. In-app choices commit
   * preference cookies only when the new session region mounts.
   */
  app.post("/workspaces/validate", async (c) => {
    const form = await c.req.formData();
    try {
      const chosen = await deps.workspace.validateFolder(field(form, "cwd"));
      if (c.req.header("HX-Request") !== "true") {
        remember(c, CWD_COOKIE, chosen.cwd);
        remember(c, PROJECT_COOKIE, chosen.projectRoot);
        return c.json({ ...chosen, projectKey: chosen.projectRoot });
      }
      sessionLocation(c, `/new?cwd=${encodeURIComponent(chosen.cwd)}`);
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
    // The page says which project it is showing. Without it a reader who
    // never picked one drifts: a session started elsewhere makes that project
    // the newest, the stream follows it, and the sidebar on screen stops
    // getting both its rows and the selector's activity dot.
    const shown = c.req.query("project");
    const remembered =
      shown === undefined || shown === ""
        ? getCookie(c, PROJECT_COOKIE)
        : shown;
    const cwd = currentCwd(c);
    return streamSSE(c, async (stream) => {
      let badges = "";
      let queue: Promise<void> = Promise.resolve();
      const sidebar = () =>
        deps.workspace.sidebar({
          ...(remembered === undefined ? {} : { remembered }),
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
              // Opening or stopping changes the row's sorting group. Send
              // the sorted list, not a replacement stuck in the old position.
              const known = view.sessions.some(
                (row) => row.id === event.sessionId,
              );
              await stream.writeSSE({
                data: await html(
                  known &&
                    event.type !== "opened" &&
                    event.type !== "stopped" ? (
                    <Partial
                      target={`#row-${event.sessionId}`}
                      swap="outerHTML"
                    >
                      <SessionRow {...found} />
                    </Partial>
                  ) : (
                    <SessionList view={view} partial />
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
                data: await html(
                  <Partial target="#project-picker" swap="outerHTML">
                    <ProjectSelect
                      view={view}
                      cwd={cwd}
                      {...(deps.home === undefined ? {} : { home: deps.home })}
                    />
                  </Partial>,
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
