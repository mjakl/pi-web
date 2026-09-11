import { parseWarnTokens, WARN_TOKENS_COOKIE } from "@core/context-usage";
import type { SidebarView } from "@core/workspace";
import { staticAssets } from "@web/assets";
import { honoFactory } from "@web/hono";
import { HtmlLayout } from "@web/HtmlLayout";
import { composerRoutes } from "@web/routes/composer";
import { filesRoutes } from "@web/routes/files";
import {
  CWD_COOKIE,
  errorText,
  PROJECT_COOKIE,
  type RouteContext,
  toastHeader,
  type WebDeps,
  YEAR,
} from "@web/routes/shared";
import { shellRoutes } from "@web/routes/shell";
import { sidebarRoutes } from "@web/routes/sidebar";
import { transcriptRoutes } from "@web/routes/transcript";
import { SessionPage } from "@web/views/SessionPage";
import { SessionRow } from "@web/views/Sidebar";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Context } from "hono";
import { jsxRenderer } from "hono/jsx-renderer";
import { getCookie, setCookie } from "hono/cookie";

export type { WebDeps };

/**
 * The application: the shared request helpers, then one module per area of the
 * screen. Route order does not matter — Hono matches on the path — so the five
 * modules can be worked on at once without touching each other.
 */
export function createWebApp(deps: WebDeps) {
  const app = honoFactory.createApp();
  const renderIntervalMs = deps.renderIntervalMs ?? 100;
  const assets = staticAssets(deps.staticRoot);

  /** The remembered project, and the sidebar the current request shows. */
  function sidebarOf(c: Context, activeId?: string) {
    const remembered = getCookie(c, PROJECT_COOKIE);
    return deps.workspace.sidebar({
      ...(remembered === undefined ? {} : { remembered }),
      ...(activeId === undefined ? {} : { activeId }),
    });
  }

  function remember(c: Context, name: string, value: string): void {
    if (getCookie(c, name) === value) return;
    setCookie(c, name, value, {
      path: "/",
      sameSite: "Lax",
      maxAge: YEAR,
    });
  }

  /** Opening a session selects its project, for this and every later page. */
  function rememberProject(c: Context, sidebar: SidebarView): void {
    if (sidebar.selected === undefined) return;
    remember(c, PROJECT_COOKIE, sidebar.selected);
  }

  /** The folder new sessions start in: the picker's choice, else the default. */
  function currentCwd(c: Context): string {
    return c.req.query("cwd") ?? getCookie(c, CWD_COOKIE) ?? deps.defaultCwd;
  }

  /**
   * The reader's context-warning threshold. It belongs to the browser, but
   * the badge is rendered here, so it travels in a cookie rather than in
   * every request.
   */
  function warnTokens(c: Context): { warnTokens: number } {
    return { warnTokens: parseWarnTokens(getCookie(c, WARN_TOKENS_COOKIE)) };
  }

  /** The whole session page, swapped into <body> after a history change. */
  async function page(
    c: Context,
    id: string,
    draft?: string,
  ): Promise<Response> {
    const [sidebar, view] = await Promise.all([
      sidebarOf(c, id),
      deps.workspace.viewSession(id, warnTokens(c)),
    ]);
    if (!view) return c.notFound();
    rememberProject(c, sidebar);
    c.header("HX-Push-Url", `/sessions/${id}`);
    return c.render(
      <SessionPage sidebar={sidebar} view={view} draft={draft} />,
    );
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

  const context: RouteContext = {
    deps,
    assets,
    renderIntervalMs,
    sidebarOf,
    remember,
    rememberProject,
    currentCwd,
    warnTokens,
    page,
    row,
    guard,
  };
  shellRoutes(app, context);
  sidebarRoutes(app, context);
  transcriptRoutes(app, context);
  composerRoutes(app, context);
  filesRoutes(app, context);

  return app;
}
