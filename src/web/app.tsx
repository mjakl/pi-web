import { bashCommand, imageLimitError } from "@core/composer";
import { extensionOf, mimeOf } from "@core/file-types";
import { FileAccessError } from "@core/path-access";
import type {
  GitChangeFile,
  ImageAttachment,
  RuntimeEvent,
  ThinkingLevel,
} from "@core/ports";
import type { DialogAnswer } from "@core/extension-ui";
import { isPackageAction, type PackageScope } from "@core/packages";
import { isSessionId, projectKeyOf } from "@core/sessions";
import { clampSearchLimit, type SkillScope } from "@core/skills";
import { staticAssets } from "@web/assets";
import {
  ForbiddenPath,
  type SidebarView,
  type Workspace,
} from "@core/workspace";
import { honoFactory } from "@web/hono";
import { HtmlLayout } from "@web/HtmlLayout";
import { renderMarkdown } from "@web/markdown";
import { CommandMenu, ComposerText, Toasts } from "@web/views/Composer";
import {
  EarlierPage,
  type ItemActions,
  Items,
  StarButton,
  ToolBody,
  TurnFragment,
} from "@web/views/Items";
import {
  defaultMode,
  Explorer,
  SearchResults,
  type TreeContext,
  TreeNodes,
  Viewer,
  type ViewMode,
} from "@web/views/Files";
import { Rail } from "@web/views/Rail";
import { changedWidgets, ShelfBody, shelfSignature } from "@web/views/Shelf";
import {
  CustomFrameBody,
  CustomPanelBody,
  customSignature,
  dialogSignature,
  ExtensionDialogBody,
} from "@web/views/Extensions";
import { manifest, offlinePage, OFFLINE_URL, serviceWorker } from "@web/pwa";
import { ToolsPanel, SystemPromptPanel } from "@web/views/Panels";
import { IndexPage, NewSessionPage, SessionPage } from "@web/views/SessionPage";
import {
  PluginsSection,
  resolveSection,
  SettingsBody,
  SettingsPage,
  SkillDetail,
  SkillSearchResults,
  type SkillsView,
} from "@web/views/Settings";
import {
  BrowsePane,
  FolderList,
  TrustDialog,
  WorkspacePicker,
} from "@web/views/Workspace";
import {
  ProjectNav,
  ProjectPicker,
  ProjectSelect,
  SessionList,
  SessionRow,
  SessionRows,
  SIDEBAR_PAGE,
} from "@web/views/Sidebar";
import { StatsPanel } from "@web/views/Stats";
import { Status } from "@web/views/Status";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Context } from "hono";
import { raw } from "hono/html";
import { jsxRenderer } from "hono/jsx-renderer";
import { streamSSE } from "hono/streaming";
import { getCookie, setCookie } from "hono/cookie";

export type WebDeps = {
  workspace: Workspace;
  /** Directory served under /static. */
  staticRoot: string;
  /** Suggested working folder for new sessions. */
  defaultCwd: string;
  /** The reader's home folder, for shortening paths on screen. */
  home?: string;
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

/**
 * Which project the sidebar shows, across page loads and the shared stream.
 * A cookie name is an RFC 6265 token, so the `web-pi:` prefix the browser
 * storage keys use is spelled with a dash here.
 */
const PROJECT_COOKIE = "web-pi-project";

/** The working folder the picker last committed: where `/new` starts. */
const CWD_COOKIE = "web-pi-cwd";

/** Which settings section was open last. */
const SETTINGS_COOKIE = "web-pi-settings";

const YEAR = 60 * 60 * 24 * 365;

/** The session the reader has open, for requests that only carry a referrer. */
function currentSessionId(c: Context): string | undefined {
  const url = c.req.header("HX-Current-URL") ?? c.req.header("Referer") ?? "";
  const id = /\/sessions\/([^/?#]+)/.exec(url)?.[1];
  return id !== undefined && isSessionId(id) ? id : undefined;
}

/** Only an https endpoint with both keys can receive an encrypted payload. */
function isPushSubscription(
  value: unknown,
): value is { endpoint: string; keys: { p256dh: string; auth: string } } {
  if (typeof value !== "object" || value === null) return false;
  const { endpoint, keys } = value as { endpoint?: unknown; keys?: unknown };
  if (typeof endpoint !== "string" || !endpoint.startsWith("https://")) {
    return false;
  }
  if (typeof keys !== "object" || keys === null) return false;
  const { p256dh, auth } = keys as { p256dh?: unknown; auth?: unknown };
  return (
    typeof p256dh === "string" &&
    p256dh !== "" &&
    typeof auth === "string" &&
    auth !== ""
  );
}

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

  /** The whole session page, swapped into <body> after a history change. */
  async function page(
    c: Context,
    id: string,
    draft?: string,
  ): Promise<Response> {
    const [sidebar, view] = await Promise.all([
      sidebarOf(c, id),
      deps.workspace.viewSession(id),
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

  app.get("/", async (c) => {
    return c.render(<IndexPage sidebar={await sidebarOf(c)} />);
  });

  app.get("/new", async (c) => {
    const cwd = currentCwd(c);
    const [sidebar, view] = await Promise.all([
      sidebarOf(c),
      deps.workspace.newSession(cwd),
    ]);
    if (view.available) remember(c, CWD_COOKIE, cwd);
    return c.render(
      <NewSessionPage
        sidebar={sidebar}
        view={view}
        draft={c.req.query("text")}
      />,
    );
  });

  /** Switching project: remember the choice and re-render the whole nav. */
  app.get("/sidebar", async (c) => {
    const project = c.req.query("project");
    if (project !== undefined && project !== "") {
      setCookie(c, PROJECT_COOKIE, project, {
        path: "/",
        sameSite: "Lax",
        maxAge: 60 * 60 * 24 * 365,
      });
    }
    const sidebar = await deps.workspace.sidebar(
      project === undefined ? {} : { remembered: project },
    );
    const activeId = currentSessionId(c);
    return c.html(
      <ProjectNav
        view={sidebar}
        {...(activeId === undefined ? {} : { activeId })}
      />,
    );
  });

  /** The projects to choose from; fetched when the selector opens. */
  app.get("/sidebar/projects", async (c) => {
    return c.html(
      <ProjectPicker view={await sidebarOf(c, currentSessionId(c))} />,
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
      return c.html(
        <li class="px-2 py-1 text-xs text-base-content/50">No runs</li>,
      );
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
          <li class="px-2 py-1 text-xs text-base-content/50">
            {String(runs.length - shown.length)} older runs not shown
          </li>
        ) : null}
      </>,
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
    const [sidebar, view] = await Promise.all([
      sidebarOf(c, id),
      deps.workspace.viewSession(id, options).catch(() => undefined),
    ]);
    if (!view) return c.notFound();
    rememberProject(c, sidebar);
    // Opening a session also selects its folder, so `/new` and the settings
    // page follow the reader from session to session.
    if (view.summary.cwdAvailable !== false) {
      remember(c, CWD_COOKIE, view.summary.cwd);
    }
    const trust = await deps.workspace
      .trustStatus(view.summary.cwd)
      .catch(() => undefined);
    return c.render(
      <SessionPage
        sidebar={sidebar}
        view={view}
        {...(trust === undefined ? {} : { trust })}
      />,
    );
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
        ...(thinking ? { thinkingLevel: thinking as ThinkingLevel } : {}),
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

  // --- Files, Git, and the viewer ----------------------------------------
  //
  // Every route here goes through the workspace's one containment policy and
  // maps `FileAccessError` onto the status it carries. `session` is optional:
  // it names the folder the panel is rooted in, and it is what lets a file a
  // transcript mentioned be read from outside the allowed roots.

  function fileFailure(c: Context, error: unknown): Response {
    if (error instanceof FileAccessError) {
      return c.text(error.message, error.status);
    }
    return c.text("Cannot read that file", 500);
  }

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
      const listing = await deps.workspace.listDirectory(
        sessionId,
        found.context.cwd,
      );
      return await c.html(
        <Explorer
          context={found.context}
          status={found.status}
          entries={listing.entries}
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
          <ul id="file-tree" role="tree" aria-label="Files" class="tree">
            <TreeNodes
              context={found.context}
              directory={found.context.cwd}
              entries={listing.entries}
              depth={0}
            />
          </ul>,
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

  /** A file name safe in a header, plus the encoded form for everyone else. */
  function disposition(path: string, attachment: boolean): string {
    const name = path.split(/[\\/]/).pop() ?? "download";
    const ascii = name.replaceAll(/[^\x20-\x7E]/g, "_").replaceAll('"', "");
    const kind = attachment ? "attachment" : "inline";
    return `${kind}; filename="${ascii === "" ? "download" : ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
  }

  app.get("/files/raw", async (c) => {
    const sessionId = sessionParameter(c);
    const path = c.req.query("path") ?? "";
    const download = c.req.query("download") === "1";
    try {
      const { size } = await deps.workspace.fileBytes(sessionId, path);
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
      const header = c.req.header("Range");
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

  // --- Workspace selection ------------------------------------------------

  app.get("/workspaces/picker", async (c) => {
    const [sidebar, browse] = await Promise.all([
      sidebarOf(c, currentSessionId(c)),
      deps.workspace.browse(currentCwd(c)).catch(() => deps.workspace.browse()),
    ]);
    return c.html(
      <WorkspacePicker
        sidebar={sidebar}
        browse={browse}
        {...(deps.home === undefined ? {} : { home: deps.home })}
      />,
    );
  });

  /** The worktrees of one project row, probed when it is opened. */
  app.get("/workspaces/folders", async (c) => {
    const cwd = c.req.query("cwd") ?? "";
    if (cwd === "") return c.text("cwd is required", 400);
    const choice = await deps.workspace.folders(cwd);
    return c.html(
      <FolderList
        choice={choice}
        {...(deps.home === undefined ? {} : { home: deps.home })}
      />,
    );
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
      return await c.html(
        <BrowsePane
          {...listing}
          {...(deps.home === undefined ? {} : { home: deps.home })}
        />,
      );
    } catch (error) {
      const listing = await deps.workspace.browse();
      return c.html(
        <BrowsePane
          {...listing}
          error={errorText(error)}
          {...(deps.home === undefined ? {} : { home: deps.home })}
        />,
      );
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

  // --- Project trust --------------------------------------------------------

  app.get("/workspaces/trust", (c) => {
    const cwd = c.req.query("cwd") ?? "";
    if (cwd === "") return c.text("cwd is required", 400);
    return c.html(<TrustDialog cwd={cwd} />);
  });

  app.post("/workspaces/trust", async (c) => {
    const form = await c.req.formData();
    const cwd = field(form, "cwd");
    return guard(c, async () => {
      await deps.workspace.trustProject(cwd);
      toastHeader(
        c,
        "Project trusted. Its sessions restart on next use.",
        "info",
      );
      c.header("HX-Refresh", "true");
      return c.body(null, 200);
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

  // --- Settings ------------------------------------------------------------

  /** Skills and plugins need a folder; general does not. */
  async function settingsView(
    section: "general" | "skills" | "plugins",
    cwd: string,
    options: { updates?: SkillsView["updates"] } = {},
  ) {
    if (section === "skills") {
      const listed = await deps.workspace.skills(cwd);
      return {
        skills: {
          cwd,
          ...listed,
          ...(options.updates === undefined
            ? {}
            : { updates: options.updates }),
        } satisfies SkillsView,
      };
    }
    if (section === "plugins") {
      return { plugins: await deps.workspace.plugins(cwd) };
    }
    return {};
  }

  app.get("/settings", async (c) => {
    const cwd = currentCwd(c);
    const available = await deps.workspace.newSession(cwd);
    const usable = available.available ? cwd : "";
    const section = resolveSection(
      c.req.query("section") ?? getCookie(c, SETTINGS_COOKIE),
      usable !== "",
    );
    remember(c, SETTINGS_COOKIE, section);
    // A section that cannot load says so; falling back to general would
    // quietly show the wrong page under the right tab.
    const sections = await settingsView(section, usable).catch(
      (error: unknown) => ({ error: errorText(error) }),
    );
    const back = currentSessionId(c);
    return c.render(
      <SettingsPage
        section={section}
        cwd={usable}
        back={back === undefined ? "/" : `/sessions/${back}`}
        {...(deps.home === undefined ? {} : { home: deps.home })}
        {...sections}
      />,
    );
  });

  /** One skill's detail pane, and the toggle that rewrites its frontmatter. */
  app.get("/settings/skills/detail", async (c) => {
    const cwd = c.req.query("cwd") ?? "";
    const path = c.req.query("path") ?? "";
    return guard(c, async () => {
      const listed = await deps.workspace.skills(cwd);
      const skill = listed.skills.find((entry) => entry.filePath === path);
      return c.html(
        <SkillDetail
          cwd={cwd}
          {...(skill ? { skill } : {})}
          {...(deps.home === undefined ? {} : { home: deps.home })}
        />,
      );
    });
  });

  app.post("/settings/skills/toggle", async (c) => {
    const form = await c.req.formData();
    const cwd = field(form, "cwd");
    const path = field(form, "path");
    return guard(c, async () => {
      const skill = await deps.workspace.toggleSkill(
        cwd,
        path,
        field(form, "disable") !== "",
      );
      return c.html(
        <SkillDetail
          cwd={cwd}
          {...(skill ? { skill } : {})}
          {...(deps.home === undefined ? {} : { home: deps.home })}
        />,
      );
    });
  });

  app.post("/settings/skills/search", async (c) => {
    const form = await c.req.formData();
    const cwd = field(form, "cwd");
    const query = field(form, "query");
    const trusted = await deps.workspace.trustStatus(cwd).then(
      (status) => status.trusted,
      () => true,
    );
    if (query === "") {
      return c.html(
        <SkillSearchResults
          hits={[]}
          cwd={cwd}
          trusted={trusted}
          message="Type something to search skills.sh."
        />,
      );
    }
    try {
      const hits = await deps.workspace.searchSkills(
        query,
        clampSearchLimit(field(form, "limit")),
      );
      return await c.html(
        <SkillSearchResults hits={hits} cwd={cwd} trusted={trusted} />,
      );
    } catch (error) {
      return c.html(
        <SkillSearchResults
          hits={[]}
          cwd={cwd}
          trusted={trusted}
          message={errorText(error)}
        />,
      );
    }
  });

  app.post("/settings/skills/install", async (c) => {
    const form = await c.req.formData();
    const cwd = field(form, "cwd");
    const scope: SkillScope =
      field(form, "scope") === "project" ? "project" : "global";
    const trusted = await deps.workspace.trustStatus(cwd).then(
      (status) => status.trusted,
      () => true,
    );
    let message: string;
    try {
      message = await deps.workspace.installSkill(
        cwd,
        field(form, "package"),
        scope,
      );
    } catch (error) {
      message = errorText(error);
    }
    return c.html(
      <SkillSearchResults
        hits={[]}
        cwd={cwd}
        trusted={trusted}
        message={message}
      />,
    );
  });

  /**
   * With a package the check is one skill's detail pane; without one it is
   * the whole section, so the list can carry its update markers.
   */
  app.post("/settings/skills/check", async (c) => {
    const form = await c.req.formData();
    const cwd = field(form, "cwd");
    const pkg = field(form, "package");
    const scope: SkillScope =
      field(form, "scope") === "project" ? "project" : "global";
    return guard(c, async () => {
      const updates = await deps.workspace.checkSkills(
        cwd,
        pkg === "" ? undefined : { package: pkg, scope },
      );
      if (pkg === "") {
        const sections = await settingsView("skills", cwd, { updates });
        return c.html(
          <SettingsBody
            section="skills"
            cwd={cwd}
            {...(deps.home === undefined ? {} : { home: deps.home })}
            {...sections}
          />,
        );
      }
      const listed = await deps.workspace.skills(cwd);
      const path = field(form, "path");
      const skill = listed.skills.find((entry) => entry.filePath === path);
      const update = updates[0];
      return c.html(
        <SkillDetail
          cwd={cwd}
          {...(skill ? { skill } : {})}
          {...(update ? { update } : {})}
          {...(deps.home === undefined ? {} : { home: deps.home })}
        />,
      );
    });
  });

  app.post("/settings/skills/update", async (c) => {
    const form = await c.req.formData();
    const cwd = field(form, "cwd");
    const path = field(form, "path");
    const scope: SkillScope =
      field(form, "scope") === "project" ? "project" : "global";
    return guard(c, async () => {
      let message: string;
      try {
        message = await deps.workspace.updateSkill(
          cwd,
          field(form, "package"),
          scope,
        );
      } catch (error) {
        message = errorText(error);
      }
      const listed = await deps.workspace.skills(cwd);
      const skill = listed.skills.find((entry) => entry.filePath === path);
      return c.html(
        <SkillDetail
          cwd={cwd}
          {...(skill ? { skill } : {})}
          message={message}
          {...(deps.home === undefined ? {} : { home: deps.home })}
        />,
      );
    });
  });

  app.get("/settings/plugins", async (c) => {
    const cwd = c.req.query("cwd") ?? "";
    const selected = c.req.query("selected");
    return guard(c, async () => {
      const view = await deps.workspace.plugins(cwd);
      return c.html(
        <PluginsSection
          cwd={cwd}
          view={view}
          {...(selected === undefined ? {} : { selected })}
          {...(deps.home === undefined ? {} : { home: deps.home })}
        />,
      );
    });
  });

  /** Every action answers with the freshly re-read list: Pi is the truth. */
  app.post("/settings/plugins", async (c) => {
    const form = await c.req.formData();
    const cwd = field(form, "cwd");
    const action = field(form, "action");
    const selected = field(form, "selected");
    const source = field(form, "source");
    const scope: PackageScope =
      field(form, "scope") === "project" ? "project" : "user";
    if (!isPackageAction(action)) {
      toastHeader(c, `Unsupported action: ${action}`);
      c.header("HX-Reswap", "none");
      return c.body(null, 200);
    }
    let message: string | undefined;
    let view;
    try {
      view = await deps.workspace.runPluginAction(action, {
        cwd,
        scope,
        ...(source === "" ? {} : { source }),
      });
      message = `Package ${action}d.`;
    } catch (error) {
      message = errorText(error);
      view = await deps.workspace.plugins(cwd);
    }
    return c.html(
      <PluginsSection
        cwd={cwd}
        view={view}
        message={message}
        {...(selected === "" ? {} : { selected })}
        {...(deps.home === undefined ? {} : { home: deps.home })}
      />,
    );
  });

  // --- Session inspection ---------------------------------------------------

  app.get("/sessions/:id/tools", (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    const tool = c.req.query("tool");
    return c.html(
      <ToolsPanel
        sessionId={id}
        tools={deps.workspace.toolDefinitions(id)}
        {...(tool === undefined ? {} : { selected: tool })}
      />,
    );
  });

  app.get("/sessions/:id/system-prompt", (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    return c.html(
      <SystemPromptPanel prompt={deps.workspace.systemPrompt(id)} />,
    );
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

  /**
   * An answer to an extension dialog. The first tab to get here resolves the
   * extension's promise; a second one finds the request gone and says so,
   * rather than pretending it answered.
   */
  app.post("/sessions/:id/ui/:requestId", async (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    const form = await c.req.formData();
    const answer: DialogAnswer =
      field(form, "cancelled") !== ""
        ? { cancelled: true }
        : form.has("confirmed")
          ? { confirmed: field(form, "confirmed") !== "" }
          : form.has("value")
            ? { value: field(form, "value") }
            : { cancelled: true };
    const answered = deps.workspace.answerDialog(
      id,
      c.req.param("requestId"),
      answer,
    );
    if (!answered) toastHeader(c, "That dialog is already closed.", "info");
    c.header("HX-Reswap", "none");
    return c.body(null, 200);
  });

  /** One keystroke or paste for an extension's custom UI. */
  app.post("/sessions/:id/ui/:requestId/input", async (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    const form = await c.req.formData();
    const data = form.get("data");
    if (typeof data !== "string" || data === "") return c.body(null, 204);
    deps.workspace.customInput(id, c.req.param("requestId"), data);
    return c.body(null, 204);
  });

  // --- Installable app --------------------------------------------------

  app.get("/manifest.webmanifest", (c) => {
    c.header("Content-Type", "application/manifest+json");
    c.header("Cache-Control", "no-cache");
    return c.body(JSON.stringify(manifest()));
  });

  /**
   * Served from the root so its scope covers the whole app. Never cached by
   * the browser itself: the registration asks for it fresh every time, and a
   * stale worker would keep serving a stale build's assets.
   */
  app.get("/sw.js", (c) => {
    c.header("Content-Type", "text/javascript; charset=utf-8");
    c.header("Cache-Control", "no-cache");
    c.header("Service-Worker-Allowed", "/");
    return c.body(serviceWorker(assets));
  });

  app.get(OFFLINE_URL, (c) => c.html(offlinePage()));

  /** The key a browser needs before it can subscribe; the private one stays. */
  app.get("/push/config", (c) =>
    c.json({ publicKey: deps.workspace.pushKey() }),
  );

  app.post("/push/subscribe", async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const subscription =
      typeof body === "object" && body !== null && "subscription" in body
        ? (body as { subscription?: unknown }).subscription
        : undefined;
    if (!isPushSubscription(subscription)) {
      return c.json({ error: "Invalid push subscription" }, 400);
    }
    deps.workspace.subscribePush({
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
    });
    return c.json({ ok: true });
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
                data: await html(<ProjectSelect view={view} oob />),
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

  app.get("/sessions/:id/events", (c) => {
    const id = c.req.param("id");
    if (!isSessionId(id)) return c.notFound();
    return streamSSE(c, async (stream) => {
      // The shelf holds open panels, so it is only re-sent when an extension
      // actually changed a status or a widget.
      let shelf = "";
      // Same for the dialog and the custom-UI shell: re-sending either would
      // wipe what the reader typed, or take focus out of the panel.
      let dialog = "";
      let custom = "";
      let frame = "";
      const widgetLines = new Map<string, string>();
      const render = async (kind: "activity" | "turn_done") => {
        const view = await deps.workspace.viewSession(id);
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
                <Items items={view.turn} actions={actions} />
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
        await stream.writeSSE({
          event: "status",
          data: await html(<Status view={view} />),
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

  return app;
}
