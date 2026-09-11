import {
  assistantEntry,
  createFakeWorld,
  type ScriptedStep,
  userEntry,
} from "@adapters/fake/index";
import { createWorkspace } from "@core/workspace";
import { createWebApp } from "@web/app";
import { describe, expect, it } from "vitest";

function testApp(options: Parameters<typeof createFakeWorld>[0] = {}) {
  const world = createFakeWorld({
    delayMs: 2,
    sessions: [
      {
        summary: {
          id: "s1",
          cwd: "/repo/one",
          name: "Stored one",
          createdAt: "2026-09-01T00:00:00.000Z",
          modifiedAt: "2026-09-02T00:00:00.000Z",
          fileSize: 10,
        },
        entries: [
          userEntry("u1", null, "first <b>question</b>"),
          assistantEntry("a1", "u1", "**bold** <script>x</script>", 40_000),
        ],
      },
    ],
    ...options,
  });
  const app = createWebApp({
    workspace: createWorkspace(world),
    staticRoot: "/nonexistent",
    defaultCwd: "/repo",
    renderIntervalMs: 1,
  });
  return { app, world };
}

/** The URL behind a collapsed tool card, as htmx would follow it. */
function deferredUrl(page: string): string {
  const url = /hx-get="([^"]*tool-result[^"]*)"/.exec(page)?.[1] ?? "";
  expect(url).not.toBe("");
  return url.replaceAll("&amp;", "&");
}

describe("web app", () => {
  it("lists stored sessions grouped by project", async () => {
    const { app } = testApp();
    const res = await app.request("/");
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain("repo/one");
    expect(html).toContain('href="/sessions/s1"');
  });

  it("renders a stored session with escaped user text and markdown answers", async () => {
    const { app } = testApp();
    const html = await (await app.request("/sessions/s1")).text();
    expect(html).toContain("first &lt;b&gt;question&lt;/b&gt;");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain('class="composer-surface"');
  });

  it("ships the shell: theme before paint, pi-web's containers, hashed assets", async () => {
    const { app } = testApp();
    const html = await (await app.request("/sessions/s1")).text();
    expect(html).toContain('localStorage.getItem("pi-theme")');
    expect(html).toContain('classList.add("dark")');
    expect(html).toContain('<script type="module" src="/static/client.js?v=');
    expect(html).toContain('<link rel="stylesheet" href="/static/app.css?v=');
    expect(html).toContain('data-session-id="s1"');
    expect(html).toContain('id="composer-text"');
    expect(html).toContain('id="toasts"');
  });

  it("renders pi-web's shell skeleton: the containers its CSS keys on", async () => {
    const { app } = testApp();
    const html = await (await app.request("/sessions/s1")).text();
    // Sidebar column, its resize handle, and the header controls.
    expect(html).toContain('id="session-sidebar"');
    expect(html).toContain('class="sidebar-container sidebar-open');
    expect(html).toContain("panel-resize-handle sidebar-resize-handle");
    expect(html).toContain("sidebar-overlay-backdrop");
    expect(html).toContain("Pi Web");
    expect(html).toContain('class="anchor-sidebar-project"');
    expect(html).toContain('id="session-list"');
    expect(html).toContain('id="explorer-section"');
    // Top bar: pi-web's order of controls.
    const bar = html.slice(html.indexOf('id="top-bar"'));
    const order = [
      "sidebar-toggle",
      "Full history",
      "System",
      "Tools",
      "context-compact-button",
      "page-refresh-button",
      "file-panel-toggle",
    ];
    let at = 0;
    for (const label of order) {
      const found = bar.indexOf(label, at);
      expect([label, found > -1]).toStrictEqual([label, true]);
      at = found;
    }
    // Chat window, transcript column and rail.
    expect(html).toContain('class="chat-window"');
    expect(html).toContain('class="chat-body"');
    expect(html).toContain('class="chat-scroll"');
    expect(html).toContain('class="chat-scroll-content"');
    expect(html).toContain('class="chat-transcript"');
    expect(html).toContain('class="chat-minimap"');
    expect(html).toContain('class="chat-composer"');
    // Right panel. Both buttons name what the click does next, as pi-web's
    // files.showPanel / files.hidePanel do.
    expect(html).toContain('id="file-panel"');
    expect(html).toContain("right-panel-container right-panel-closed");
    expect(html).toContain("panel-resize-handle right-panel-resize-handle");
    expect(html).toContain('id="file-panel-toggle"');
    expect(html).toContain('title="Show file panel"');
    expect(html).toContain('id="file-panel-close"');
    expect(html).toContain('title="Hide file panel"');
  });

  it("reads the session out in the top bar, as pi-web does", async () => {
    const { app, world } = testApp();
    // The gauge comes off the running agent, as pi-web's does.
    await world.runtime.open({ sessionId: "s1" });
    const bar = (await (await app.request("/sessions/s1")).text()).slice(
      0,
      undefined,
    );
    const stats = bar.slice(bar.indexOf('id="stats-trigger"'));
    // Cumulative totals first, then the context gauge, both compacted.
    expect(stats).toContain("40k");
    expect(stats).toContain("40k / 100k (40%)");
    // The exact numbers live in the hover text.
    expect(bar).toContain("in: 39,990");
    expect(bar).toContain("cache write: 0");
    expect(bar).toContain("Context: 40,000 / 100,000 tokens (40%)");
    // Compact carries the dumb-zone marker only above the threshold.
    expect(bar).not.toContain("data-warning");
    const warned = await (
      await app.request("/sessions/s1", {
        headers: { cookie: "web-pi-warn-tokens=1000" },
      })
    ).text();
    expect(warned).toContain("data-warning");
    expect(warned).toContain("rgba(234,179,8,0.95)");
  });

  it("tints the System and Tools icons from the attached session", async () => {
    const { app, world } = testApp();
    // A stored session tells the page nothing about either, so pi-web leaves
    // both icons dim until something attaches.
    const stored = await (await app.request("/sessions/s1")).text();
    const dim = stored.slice(stored.indexOf('data-top-panel="system"'));
    expect(dim).toContain(
      'data-panel-icon="true" style="display:flex; color:var(--text-dim)"',
    );
    await world.runtime.open({ sessionId: "s1" });
    const live = await (await app.request("/sessions/s1")).text();
    const tabs = live.slice(
      live.indexOf('data-top-panel="system"'),
      live.indexOf('id="stats-trigger"'),
    );
    expect(tabs).toContain(
      'data-panel-icon="true" style="display:flex; color:var(--accent)"',
    );
    // Both of them, and neither left dim.
    expect(tabs.split("var(--accent)").length - 1).toBe(2);
    expect(tabs).not.toContain("color:var(--text-dim)");
  });

  it("renders the top panels with pi-web's menu-panel classes", async () => {
    const { app } = testApp();
    const prompt = await (
      await app.request("/sessions/s1/system-prompt")
    ).text();
    expect(prompt).toContain("system-prompt-panel menu-surface menu-panel");
    expect(prompt).toContain("system-prompt-text");
    const tools = await (await app.request("/sessions/s1/tools")).text();
    expect(tools).toContain("tool-definitions-panel menu-surface menu-panel");
    expect(tools).toContain("tool-definitions-sidebar");
    expect(tools).toContain("tool-definitions-item selected");
    expect(tools).toContain("tool-definition-field-name");
    expect(tools).toContain('hx-target="#top-panel"');
    // Before there is a session both panels are their own empty state, as
    // pi-web shows them with nothing loaded.
    const empty = await (await app.request("/panels/tools")).text();
    expect(empty).toContain("tool-definitions-empty");
    expect(await (await app.request("/panels/system")).text()).toContain(
      "system-prompt-empty",
    );
  });

  it("draws the session info panel as pi-web's three-column popover", async () => {
    const { app } = testApp();
    const stats = await (await app.request("/sessions/s1/stats")).text();
    expect(stats).toContain('class="session-info-popover menu-surface"');
    for (const title of [
      "Session Info",
      "Project Info",
      "Messages",
      "Tokens",
    ]) {
      expect([title, stats.includes(title)]).toStrictEqual([title, true]);
    }
    expect(stats).toContain("minmax(360px, 1.7fr)");
    expect(stats).toContain('data-session-copy="s1"');
    expect(stats).toContain("Copy session ID");
  });

  it("dresses an extension dialog in pi-web's panel", async () => {
    const { app } = testApp({
      script: () =>
        [
          {
            dialog: { method: "confirm", title: "Push it?", message: "Sure?" },
          },
        ] as ScriptedStep[],
    });
    const body = new FormData();
    body.set("text", "go");
    await app.request("/sessions/s1/prompt", { method: "POST", body });
    await new Promise((resolve) => setTimeout(resolve, 40));
    const page = await (await app.request("/sessions/s1")).text();
    const dialog = page.slice(page.indexOf('class="extension-dialog"'));
    expect(dialog).toContain("extension request");
    expect(dialog).toContain("width:min(560px, 100%)");
    expect(dialog).toContain("Push it?");
    expect(dialog).toContain("Confirm");
    expect(dialog).toContain("data-dialog-cancel");
  });

  it("returns a fragment for HTMX requests and 404 for unknown ids", async () => {
    const { app } = testApp();
    const fragment = await (
      await app.request("/sessions/s1", { headers: { "HX-Request": "true" } })
    ).text();
    expect(fragment).not.toContain("<html");
    expect((await app.request("/sessions/nope")).status).toBe(404);
    expect((await app.request("/sessions/..%2Fetc")).status).toBe(404);
  });

  it("starts a session from the form and redirects to it", async () => {
    const { app, world } = testApp();
    const form = new FormData();
    form.set("cwd", "/repo/two");
    form.set("text", "hello");
    const res = await app.request("/sessions", { method: "POST", body: form });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/sessions/new-1");
    expect(world.runtime.get("new-1")?.snapshot().status.running).toBe(true);
  });

  it("streams the turn and then settles it", async () => {
    const { app } = testApp({ reply: () => "alpha beta" });
    const form = new FormData();
    form.set("text", "go");
    const prompt = await app.request("/sessions/s1/prompt", {
      method: "POST",
      body: form,
    });
    expect(prompt.status).toBe(204);

    const res = await app.request("/sessions/s1/events");
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
    let received = "";
    const decoder = new TextDecoder();
    while (!received.includes("event: settled")) {
      const chunk = await reader.read();
      if (chunk.done) break;
      received += decoder.decode(chunk.value);
    }
    await reader.cancel();
    expect(received).toContain("event: turn");
    expect(received).toContain("alpha beta");
    expect(received).toContain("event: status");
    expect(received).toMatch(/event: settled\ndata: <section class="turn"/);
    // pi-web's streaming header: the model, the running token estimate, and
    // the rate, in its three fixed columns. web-pi gets both from the
    // runtime instead of a meter in the browser.
    expect(received).toContain("grid-template-columns:minmax(0, 1fr) 9ch 10ch");
    expect(received).toContain("Estimated token count while streaming");
    // The rate column is there from the start; it stays blank until half a
    // second of the message has arrived, which this turn never reaches.
    expect(received).toContain(
      "text-align:right; color:var(--text-dim); font-size:11px",
    );
  });

  it("loads row metadata lazily and shows the title, counts, and stars", async () => {
    const { app } = testApp();
    const list = await (await app.request("/")).text();
    // The listing itself stays header-only: the row asks for its own counts.
    expect(list).toContain('hx-get="/sessions/s1/row"');
    expect(list).toContain('hx-trigger="revealed"');
    expect(list).not.toContain("msgs");

    const row = await (await app.request("/sessions/s1/row")).text();
    expect(row).toContain("Stored one");
    expect(row).toContain("2 msgs");
    expect(row).toContain("Activate");
    expect(row).toContain("Delete");
  });

  it("renames a session and answers with the row", async () => {
    const { app, world } = testApp();
    const form = new FormData();
    form.set("name", "Renamed");
    const res = await app.request("/sessions/s1/rename", {
      method: "POST",
      body: form,
    });
    expect(await res.text()).toContain("Renamed");
    expect(world.store.get("s1")?.summary.name).toBe("Renamed");
  });

  it("stars an answer, updates the row out of band, and clears again", async () => {
    const { app } = testApp();
    const form = new FormData();
    form.set("entryId", "a1");
    form.set("starred", "true");
    const starred = await (
      await app.request("/sessions/s1/star", { method: "POST", body: form })
    ).text();
    expect(starred).toContain('aria-pressed="true"');
    expect(starred).toContain('hx-swap-oob="true"');
    // pi-web's row counts stars with a filled star icon beside the number.
    expect(starred).toContain('class="session-star-count"');
    expect(starred).toContain("1 starred answers");

    const cleared = await (
      await app.request("/sessions/s1/stars/clear", { method: "POST" })
    ).text();
    expect(cleared).not.toContain('class="session-star-count"');
    const page = await (await app.request("/sessions/s1")).text();
    expect(page).toContain('aria-label="Star answer"');
  });

  it("forks a message into a new session with the text as its draft", async () => {
    const { app, world } = testApp();
    const form = new FormData();
    form.set("entryId", "a1");
    const res = await app.request("/sessions/s1/fork", {
      method: "POST",
      body: form,
      headers: { "HX-Request": "true" },
    });
    const id = res.headers.get("hx-push-url")?.split("/").pop() ?? "";
    expect(world.store.has(id)).toBe(true);
    expect(world.store.get(id)?.entries).toHaveLength(2);
  });

  it("switches branch read-only and offers to continue from it", async () => {
    const { app, world } = testApp();
    const stored = world.store.get("s1");
    if (!stored) throw new Error("missing session");
    stored.entries.push(userEntry("u2", "u1", "other branch"));
    stored.leafId = "a1";

    const other = await (await app.request("/sessions/s1?leaf=u2")).text();
    expect(other).toContain("other branch");
    expect(other).toContain("read only");
    expect(other).not.toContain('id="composer"');
    // pi-web has no branch menu in the header: branches are rail marks.
    expect(other).toContain('data-branched="true"');

    const form = new FormData();
    form.set("entryId", "u2");
    const switched = await app.request("/sessions/s1/navigate", {
      method: "POST",
      body: form,
    });
    expect(switched.headers.get("hx-push-url")).toBe("/sessions/s1");
    // The user message came back as the composer draft.
    expect(await switched.text()).toContain("other branch</textarea>");
  });

  it("rewinds a user message back into the composer", async () => {
    const { app, world } = testApp();
    const stored = world.store.get("s1");
    if (!stored) throw new Error("missing session");
    const form = new FormData();
    form.set("entryId", "u1");
    const res = await app.request("/sessions/s1/rewind", {
      method: "POST",
      body: form,
    });
    expect(await res.text()).toContain(
      "first &lt;b&gt;question&lt;/b&gt;</textarea>",
    );
    expect(stored.entries).toHaveLength(0);
  });

  it("deletes a session and sends the open page home", async () => {
    const { app, world } = testApp();
    const res = await app.request("/sessions/s1/delete", {
      method: "POST",
      headers: { "HX-Current-URL": "http://localhost/sessions/s1" },
    });
    expect(res.headers.get("hx-redirect")).toBe("/");
    expect(world.store.has("s1")).toBe(false);
  });

  it("reports a failed action as a toast", async () => {
    const { app } = testApp();
    const form = new FormData();
    form.set("entryId", "u1");
    const res = await app.request("/sessions/s1/star", {
      method: "POST",
      body: form,
    });
    expect(res.headers.get("hx-trigger")).toContain("assistant answer");
    expect(res.headers.get("hx-trigger")).toContain("web-pi:toast");
  });

  it("serves session statistics and the exported transcript", async () => {
    const { app } = testApp();
    const stats = await (await app.request("/sessions/s1/stats")).text();
    expect(stats).toContain("session-info-popover");
    expect(stats).toContain("Tool Results");
    expect(stats).toContain("Tokens");

    const exported = await app.request("/sessions/s1/export");
    expect(exported.headers.get("content-disposition")).toBe(
      'inline; filename="pi-session-s1.html"',
    );
    expect(exported.headers.get("x-frame-options")).toBe("DENY");
  });

  it("lists built-in and session commands, filtered and badged", async () => {
    const { app } = testApp();
    const all = await (await app.request("/sessions/s1/commands?q=")).text();
    expect(all).toContain("/compact");
    expect(all).toContain("/skill:testing");
    expect(all).toContain("Manual");
    // A stopped session lists extension commands too, as pi-web's does.
    expect(all).toContain("/review");

    const filtered = await (
      await app.request("/sessions/s1/commands?q=comp")
    ).text();
    expect(filtered).toContain("/compact");
    expect(filtered).not.toContain("/clone");
  });

  it("accepts attachments and serves them back from the session file", async () => {
    const { app, world } = testApp();
    const form = new FormData();
    form.set("text", "look at this");
    form.append(
      "images[]",
      new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" }),
    );
    expect(
      (await app.request("/sessions/s1/prompt", { method: "POST", body: form }))
        .status,
    ).toBe(204);
    const entry = world.store.get("s1")?.entries.at(-1);
    expect(entry?.type).toBe("message");

    const page = await (await app.request("/sessions/s1")).text();
    const match = /\/sessions\/s1\/entries\/([^/]+)\/image\/0/.exec(page);
    expect(match).not.toBeNull();
    const image = await app.request(match?.[0] ?? "");
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/gif");
  });

  it("refuses more than ten attachments", async () => {
    const { app } = testApp();
    const form = new FormData();
    form.set("text", "many");
    for (let index = 0; index < 11; index += 1) {
      form.append(
        "images[]",
        new File([new Uint8Array([1])], "x.png", { type: "image/png" }),
      );
    }
    const res = await app.request("/sessions/s1/prompt", {
      method: "POST",
      body: form,
    });
    expect(res.headers.get("hx-trigger")).toContain("10 images");
  });

  it("queues a follow-up while a turn runs, then recalls it", async () => {
    const { app } = testApp({ delayMs: 200 });
    const first = new FormData();
    first.set("text", "go");
    await app.request("/sessions/s1/prompt", { method: "POST", body: first });

    const queued = new FormData();
    queued.set("text", "and then this");
    queued.set("behavior", "followUp");
    await app.request("/sessions/s1/prompt", { method: "POST", body: queued });

    const page = await (await app.request("/sessions/s1")).text();
    expect(page).toContain("Queued · 1");
    expect(page).toContain("follow-up");

    const recalled = await (
      await app.request("/sessions/s1/queue/recall", { method: "POST" })
    ).text();
    expect(recalled).toContain('id="composer-text"');
    expect(recalled).toContain("and then this");
    expect(await (await app.request("/sessions/s1")).text()).not.toContain(
      "Queued ·",
    );
  });

  it("runs a built-in slash command instead of prompting", async () => {
    const { app, world } = testApp();
    const form = new FormData();
    form.set("text", "/name Renamed by command");
    const res = await app.request("/sessions/s1/prompt", {
      method: "POST",
      body: form,
    });
    expect(res.headers.get("hx-trigger")).toContain("Renamed");
    expect(world.store.get("s1")?.summary.name).toBe("Renamed by command");
  });

  it("compacts on request and shows the result", async () => {
    const { app } = testApp({ delayMs: 1 });
    expect(
      (await app.request("/sessions/s1/compact", { method: "POST" })).status,
    ).toBe(204);
    await new Promise((resolve) => setTimeout(resolve, 40));
    const page = await (await app.request("/sessions/s1")).text();
    expect(page).toContain("Compacted");
    expect(page).toContain("40k");
  });

  it("runs a shell command from the composer and shows its output", async () => {
    const { app, world } = testApp({ delayMs: 1 });
    const form = new FormData();
    form.set("text", "!echo hi");
    expect(
      (await app.request("/sessions/s1/prompt", { method: "POST", body: form }))
        .status,
    ).toBe(204);
    const entry = world.store.get("s1")?.entries.at(-1);
    expect(entry?.type === "message" && entry.message.role).toBe(
      "bashExecution",
    );
    expect(await (await app.request("/sessions/s1")).text()).toContain(
      "echo hi: ok",
    );
  });

  it("serves the file index only inside the session's own folder", async () => {
    const { app } = testApp({ files: ["src/main.ts"] });
    const index = await app.request("/sessions/s1/file-index");
    expect(await index.json()).toEqual({
      files: ["src/main.ts"],
      truncated: false,
    });

    // A folder inside the session's own is allowed but still has to exist,
    // and one outside every root is refused before any file system call.
    const missing = await app.request(
      "/sessions/s1/file-index?cwd=%2Frepo%2Fone%2Fsrc&q=main",
    );
    expect(missing.status).toBe(404);
    const outside = await app.request("/sessions/s1/file-index?cwd=%2Fetc");
    expect(outside.status).toBe(403);
  });

  it("keeps path completion inside the session folder", async () => {
    const { app } = testApp({ files: ["src/main.ts"] });
    const res = await app.request("/sessions/s1/file-completion?q=.%2Fsrc");
    expect(await res.json()).toEqual({
      matches: [{ path: "/repo/one/src/main.ts", isDir: false }],
    });
  });

  it("refuses shell output this session never produced", async () => {
    const { app } = testApp();
    const res = await app.request(
      "/sessions/s1/bash-output?path=%2Ftmp%2Fpi-bash-abc.log",
    );
    expect(res.status).toBe(403);
    const wrong = await app.request(
      "/sessions/s1/bash-output?path=%2Fetc%2Fpasswd",
    );
    expect(wrong.status).toBe(403);
  });

  it("tells the browser to re-key its draft once a session exists", async () => {
    const { app } = testApp();
    const form = new FormData();
    form.set("cwd", "/repo/two");
    form.set("text", "hello");
    const res = await app.request("/sessions", {
      method: "POST",
      body: form,
      headers: { "HX-Request": "true" },
    });
    expect(res.headers.get("hx-redirect")).toBe("/sessions/new-1");
    expect(res.headers.get("hx-trigger")).toContain("web-pi:session-created");
    expect(res.headers.get("hx-trigger")).toContain("/repo/two");
  });

  it("pushes rows and a finished marker on the shared stream", async () => {
    const { app } = testApp({ reply: () => "done" });
    const res = await app.request("/events");
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
    const form = new FormData();
    form.set("text", "go");
    await app.request("/sessions/s1/prompt", { method: "POST", body: form });

    let received = "";
    const decoder = new TextDecoder();
    while (!received.includes("event: finished")) {
      const chunk = await reader.read();
      if (chunk.done) break;
      received += decoder.decode(chunk.value);
    }
    await reader.cancel();
    // Opening the session re-renders the list; finishing swaps just its row.
    expect(received).toContain("event: rows");
    expect(received).toContain('hx-swap-oob="true"');
    expect(received).toContain('id="row-s1"');
    // The finished marker names the project, so the selector can badge it.
    expect(received).toContain('data: {"id":"s1","project":"/repo/one"}');
  });

  it("scopes the sidebar to one project and remembers the choice", async () => {
    const { app, world } = testApp();
    world.store.set("s2", {
      summary: {
        id: "s2",
        cwd: "/repo/two",
        name: "Other project",
        createdAt: "2026-09-03T00:00:00.000Z",
        modifiedAt: "2026-09-03T00:00:00.000Z",
        fileSize: 2,
      },
      entries: [userEntry("v1", null, "second project")],
    });

    // The newest project wins with nothing remembered.
    const first = await (await app.request("/")).text();
    expect(first).toContain('href="/sessions/s2"');
    expect(first).not.toContain('href="/sessions/s1"');

    // Choosing a project sets the cookie and answers with the whole nav.
    const chosen = await app.request("/sidebar?project=%2Frepo%2Fone");
    expect(chosen.headers.get("set-cookie")).toContain("web-pi-project=");
    const nav = await chosen.text();
    expect(nav).toContain('id="project-nav"');
    expect(nav).toContain('href="/sessions/s1"');
    expect(nav).not.toContain('href="/sessions/s2"');

    // Opening a session of the other project selects that project again.
    const page = await (
      await app.request("/sessions/s2", {
        headers: { cookie: "web-pi-project=/repo/one" },
      })
    ).text();
    expect(page).toContain('href="/sessions/s2"');
    expect(page).not.toContain('href="/sessions/s1"');
  });

  it("lists subagent runs inline, as pi-web does", async () => {
    const { app, world } = testApp();
    world.store.set("subagent.abc", {
      summary: {
        id: "subagent.abc",
        cwd: "/repo/one",
        createdAt: "2026-09-04T00:00:00.000Z",
        modifiedAt: "2026-09-04T00:00:00.000Z",
        fileSize: 1,
        parentId: "s1",
      },
      entries: [userEntry("g1", null, "explore the repo")],
    });

    const list = await (await app.request("/")).text();
    expect(list).not.toContain("subagent run");
    expect(list).toContain('href="/sessions/subagent.abc"');
  });
});

/** A session long enough to page, with one thinking block per answer. */
function longApp(answers = 60) {
  const entries = [];
  let parent: string | null = null;
  for (let index = 0; index < answers; index += 1) {
    const userId = `u${String(index)}`;
    const answerId = `a${String(index)}`;
    entries.push(userEntry(userId, parent, `question ${String(index)}`));
    const answer = assistantEntry(
      answerId,
      userId,
      `answer ${String(index)}`,
      100,
    );
    if (answer.type === "message" && answer.message.role === "assistant") {
      answer.message.content = [
        { type: "thinking", thinking: "z".repeat(2000) },
        ...answer.message.content,
      ];
    }
    entries.push(answer);
    parent = answerId;
  }
  return testApp({
    sessions: [
      {
        summary: {
          id: "s1",
          cwd: "/repo/one",
          createdAt: "2026-09-01T00:00:00.000Z",
          modifiedAt: "2026-09-02T00:00:00.000Z",
          fileSize: 10,
        },
        entries,
      },
    ],
  });
}

/** A store with several projects, a worktree and enough projects to filter. */
function sidebarApp() {
  const sessions = [
    {
      summary: {
        id: "s1",
        cwd: "/repo/one",
        name: "Stored one",
        createdAt: "2026-09-01T00:00:00.000Z",
        modifiedAt: "2026-09-02T00:00:00.000Z",
        fileSize: 10,
        projectRoot: "/repo/one",
      },
      entries: [
        userEntry("u1", null, "first question"),
        assistantEntry("a1", "u1", "an answer", 40_000),
      ],
    },
    {
      summary: {
        id: "s2",
        cwd: "/repo/one.wt",
        name: "In a worktree",
        createdAt: "2026-09-03T00:00:00.000Z",
        modifiedAt: "2026-09-03T00:00:00.000Z",
        fileSize: 4,
        projectRoot: "/repo/one",
        worktreeBranch: "feature/x",
      },
      entries: [userEntry("u2", null, "worktree question")],
    },
  ];
  // Nine more projects, which is what turns the menu's filter box on.
  for (let index = 0; index < 9; index += 1) {
    sessions.push({
      summary: {
        id: `p${String(index)}`,
        cwd: `/repo/other${String(index)}`,
        name: `Other ${String(index)}`,
        createdAt: "2026-08-01T00:00:00.000Z",
        modifiedAt: `2026-08-0${String(index + 1)}T00:00:00.000Z`,
        fileSize: 1,
        projectRoot: `/repo/other${String(index)}`,
      },
      entries: [userEntry(`o${String(index)}`, null, "question")],
    });
  }
  const world = createFakeWorld({
    delayMs: 2,
    sessions,
    // /repo/one.wt is a worktree of /repo/one, so the two group together.
    projects: (cwd) =>
      cwd.startsWith("/repo/one")
        ? {
            root: "/repo/one",
            branch: cwd === "/repo/one.wt" ? "feature/x" : "main",
            isWorktree: cwd !== "/repo/one",
            isTopLevel: cwd === "/repo/one",
          }
        : { root: cwd, branch: null, isWorktree: false, isTopLevel: true },
  });
  const app = createWebApp({
    workspace: createWorkspace(world),
    staticRoot: "/nonexistent",
    defaultCwd: "/repo/one",
    home: "/repo",
    renderIntervalMs: 1,
  });
  return { app, world };
}

describe("the sidebar", () => {
  it("renders pi-web's header block above the workspace pill", async () => {
    const { app } = sidebarApp();
    const html = await (await app.request("/sessions/s1")).text();
    const header = html.slice(html.indexOf('id="sidebar"'));
    const order = [
      ">Pi Web<",
      'aria-label="New session"',
      'id="sidebar-refresh"',
      'aria-label="Settings"',
      'id="project-select"',
      'id="sidebar-project-menu"',
      'id="session-list"',
    ];
    let at = 0;
    for (const marker of order) {
      const found = header.indexOf(marker, at);
      expect([marker, found > -1]).toStrictEqual([marker, true]);
      at = found;
    }
    expect(header).toContain('class="anchor-sidebar-project"');
    // The pill names the working folder, shortened against the reader's home.
    expect(header).toContain(">~/one<");
    expect(header).toContain("direction:rtl");
  });

  it("names the branch in Project Info, the worktree only when it is one", async () => {
    const { app } = sidebarApp();
    const main = await (await app.request("/sessions/s1/stats")).text();
    const worktree = await (await app.request("/sessions/s2/stats")).text();
    // pi-web shows the branch of any checkout, and the Worktree row only for
    // a linked one (AppShell.tsx L2186-L2210).
    expect(main).toContain("Git Branch");
    expect(main).toContain(">main<");
    expect(main).not.toContain("Worktree");
    expect(worktree).toContain(">feature/x<");
    expect(worktree).toContain("Worktree");
    expect(worktree).toContain(">/repo/one.wt<");
  });

  it("marks a live session's row with the success colour", async () => {
    const { app, world } = sidebarApp();
    await world.runtime.open({ sessionId: "s2" });
    const row = await (await app.request("/sessions/s2/row")).text();
    expect(row).toContain("Session active");
    expect(row).toContain('data-colour="var(--success)"');
    expect(row).toContain("color:var(--success)");
  });

  it("renders a 54px session row with pi-web's three columns", async () => {
    const { app } = sidebarApp();
    const html = await (await app.request("/sessions/s2")).text();
    const row = html.slice(html.indexOf('id="row-s2"'));
    expect(row).toContain('class="session-row"');
    expect(row).toContain("height:54px");
    // Selected: pi-web tints the row and puts an accent bar down its left.
    expect(row).toContain("background:var(--bg-selected)");
    expect(row).toContain("border-left:2px solid var(--accent)");
    const inOrder = (text: string, markers: string[]) => {
      let at = 0;
      for (const marker of markers) {
        const found = text.indexOf(marker, at);
        expect([marker, found > -1]).toStrictEqual([marker, true]);
        at = found;
      }
    };
    inOrder(row, [
      "In a worktree",
      'class="session-indicator"',
      "Session stopped",
      " ago",
      "feature/x",
      'class="session-shortcut"',
    ]);
    // An unselected row keeps the transparent bar and no tint.
    const start = html.indexOf('id="row-s1"');
    // s1 is the last row of this project, so the list's end bounds the slice.
    const other = html.slice(start, html.indexOf('id="session-finished"'));
    expect(other).toContain("border-left:2px solid transparent");
    expect(other).not.toContain("background:var(--bg-selected)");

    // The state's own colour rides along: the browser paints the unread tint
    // over it and has to be able to put it back (client/sidebar.ts).
    expect(row).toContain('data-colour="var(--text-dim)"');

    // The right column arrives with the row's own metadata.
    const loaded = await (await app.request("/sessions/s2/row")).text();
    inOrder(loaded, [
      'class="session-shortcut"',
      'class="session-menu-trigger"',
      'class="session-counts"',
      "1 msgs",
    ]);
    expect(loaded).toContain("min-width:64px");
  });

  it("hangs pi-web's 144px action menu off a row that knows its counts", async () => {
    const { app } = sidebarApp();
    // The list renders placeholders; a row fetches its own metadata, and only
    // then can it say whether Stop or Activate belongs in the menu.
    const html = await (await app.request("/sessions/s1/row")).text();
    expect(html).toContain('id="row-menu-s1"');
    const menu = html.slice(html.indexOf('id="row-menu-s1"'));
    expect(menu).toContain('popover="auto"');
    expect(menu).toContain('role="group"');
    expect(menu).toContain("width:min(144px, calc(100vw - 16px))");
    expect(menu).toContain("position:fixed");
    const items = [...menu.matchAll(/class="menu-item[^"]*"[^>]*>([^<]+)</g)]
      .map((match) => match[1])
      .slice(0, 3);
    expect(items).toStrictEqual(["Activate", "Rename", "Delete"]);
    expect(menu).toContain("menu-item menu-item-danger");
  });

  it("offers Clear all stars only while a session has stars", async () => {
    const { app } = sidebarApp();
    const before = await (await app.request("/sessions/s1/row")).text();
    expect(before).not.toContain("Clear all stars");
    const form = new FormData();
    form.set("entryId", "a1");
    form.set("starred", "true");
    await app.request("/sessions/s1/star", { method: "POST", body: form });
    const row = await (await app.request("/sessions/s1/row")).text();
    expect(row).toContain("Clear all stars");
    expect(row).toContain('class="session-star-count"');
  });

  it("swaps the row for an input when Rename is chosen, and back again", async () => {
    const { app } = sidebarApp();
    const renaming = await (await app.request("/sessions/s1/rename")).text();
    expect(renaming).toContain('<form id="row-s1" class="session-row"');
    expect(renaming).toContain("border:1px solid var(--accent)");
    expect(renaming).toContain('value="Stored one"');
    // Escape asks for the row back.
    expect(renaming).toContain('hx-get="/sessions/s1/row"');

    const posted = new FormData();
    posted.set("name", "Renamed");
    const row = await (
      await app.request("/sessions/s1/rename", {
        method: "POST",
        body: posted,
      })
    ).text();
    expect(row).toContain("Renamed");
    expect(row).toContain('class="session-row"');
  });

  it("groups the workspace menu by project, with worktrees under it", async () => {
    const { app } = sidebarApp();
    const menu = await (
      await app.request("/sidebar/projects", {
        headers: { "HX-Current-URL": "http://x/sessions/s2" },
      })
    ).text();
    // Eleven projects, so the filter box is there (pi-web shows it above 8).
    expect(menu).toContain('class="menu-filter"');
    expect(menu).toContain("Filter projects…");
    // A plain text box that opens unfocused, as pi-web's does: its autoFocus
    // fires when the sidebar mounts, long before the popover is opened, so
    // the field shows neither a focus ring nor a caret.
    const filter = menu.slice(menu.indexOf('id="project-filter"'));
    expect(filter.slice(0, filter.indexOf(">"))).not.toMatch(
      /autofocus|type="search"/,
    );
    // The project with two folders expands; the others select directly.
    const group = menu.slice(menu.indexOf('data-project-key="/repo/one"'));
    expect(group).toContain('aria-expanded="true"');
    expect(group).toContain('class="menu-item project-folder-row"');
    expect(group).toContain("project-folder-child");
    expect(group).toContain('class="project-folder-path"');
    expect(group).toContain(">~/one.wt<");
    // Exactly one row carries the tick, on the folder the sidebar is showing.
    expect([...menu.matchAll(/aria-current="true"/g)]).toHaveLength(1);
    expect(menu).toContain("/sidebar?project=%2Frepo%2Fone&amp;cwd=");
    // "Custom path…" sits outside the scrolling list, as pi-web has it.
    expect(menu.indexOf("Custom path…")).toBeGreaterThan(
      menu.indexOf("project-folder-child"),
    );
  });

  it("spells out the home folder itself in the workspace menu", async () => {
    // pi-web abbreviates a project path only *below* home, so a session
    // started in the home directory reads "/repo", not "~".
    const world = createFakeWorld({
      delayMs: 2,
      sessions: [
        {
          summary: {
            id: "h1",
            cwd: "/repo",
            name: "At home",
            createdAt: "2026-09-01T00:00:00.000Z",
            modifiedAt: "2026-09-02T00:00:00.000Z",
            fileSize: 10,
            projectRoot: "/repo",
          },
          entries: [userEntry("u1", null, "question")],
        },
      ],
    });
    const app = createWebApp({
      workspace: createWorkspace(world),
      staticRoot: "/nonexistent",
      defaultCwd: "/repo",
      home: "/repo",
      renderIntervalMs: 1,
    });
    const menu = await (await app.request("/sidebar/projects")).text();
    expect(menu).toContain('class="project-folder-path">/repo<');
    expect(menu).not.toContain('class="project-folder-path">~<');
  });

  it("drops the filter box when there are few projects", async () => {
    const { app } = testApp();
    const menu = await (await app.request("/sidebar/projects")).text();
    expect(menu).not.toContain('class="menu-filter"');
    expect(menu).toContain("Custom path…");
  });

  it("switches folder and project together, and re-titles the pill", async () => {
    const { app } = sidebarApp();
    const res = await app.request(
      "/sidebar?project=%2Frepo%2Fone&cwd=%2Frepo%2Fone.wt",
    );
    const html = await res.text();
    expect(html).toContain('id="project-nav"');
    // The pill rides along out of band so it names the folder just chosen.
    expect(html).toContain('id="project-picker"');
    expect(html).toContain('hx-swap-oob="true"');
    expect(html).toContain(">~/one.wt<");
    const cookies = res.headers.getSetCookie().join(" ");
    expect(cookies).toContain("web-pi-project=");
    expect(cookies).toContain("web-pi-cwd=");
  });
});

describe("the composer, as pi-web draws it", () => {
  /** The order of one region's controls, by the marker each one carries. */
  function order(html: string, markers: string[]): void {
    let at = 0;
    for (const marker of markers) {
      const found = html.indexOf(marker, at);
      expect([marker, found > -1]).toStrictEqual([marker, true]);
      at = found;
    }
  }

  it("renders ChatInput's skeleton: surface, textarea, toolbar", async () => {
    const { app } = testApp();
    const page = await (await app.request("/sessions/s1")).text();
    const composer = page.slice(page.indexOf('id="composer"'));
    order(composer, [
      'class="chat-input"',
      'id="image-input"',
      "max-width:820px; margin:0 auto",
      'id="status"',
      'id="slash-menu" class="menu-surface menu-panel"',
      'id="at-menu" class="menu-surface menu-panel"',
      'class="composer-surface"',
      'id="image-previews"',
      'class="composer-textarea"',
      'placeholder="Message…"',
      'class="composer-toolbar"',
      'class="composer-attach"',
      'class="anchor-composer-controls composer-more"',
      'class="model-selector is-composer"',
      'class="composer-action-primary"',
      'class="composer-shell-mode" id="shell-hint"',
    ]);
    // The surface's own metrics come from globals.css, so the markup only has
    // to carry the classes; the strips, though, are pi-web's inline styles.
    expect(composer).toContain("bottom:calc(100% + 8px)");
    expect(composer).toContain("max-height:min(48vh, 400px)");
    // The stream swaps into the status div, not into the form's toast target.
    expect(composer).toContain(
      'id="status" sse-swap="status" hx-target="this"',
    );
  });

  it("groups the slash menu the way pi-web does", async () => {
    const { app } = testApp();
    const menu = await (await app.request("/sessions/s1/commands")).text();
    order(menu, [
      "Slash commands · ",
      " commands",
      "Tab / Enter",
      'class="menu-section-label"',
      "Built-in",
      'class="menu-item"',
      "/clone",
      "Clone the current branch into a new session",
      // pi-web's group order: built-in, extension, prompt, skill.
      "Extensions",
      "/review",
      "Prompts",
      "/changelog",
      "Skills",
      "/skill:testing",
    ]);
    expect(menu).toContain("font-size:12.5px");
    expect(menu).toContain('data-index="0"');
  });

  it("counts commands until the slash is filtered, then matches", async () => {
    const { app } = testApp();
    const all = await (await app.request("/sessions/s1/commands?q=")).text();
    expect(all).toContain("Slash commands · 9 commands");
    const one = await (
      await app.request("/sessions/s1/commands?q=clone")
    ).text();
    expect(one).toContain("Slash commands · 1 match");
  });

  it("offers every model, grouped by provider, with a filter above eight", async () => {
    const many = Array.from({ length: 9 }, (_, index) => ({
      provider: index < 5 ? "fake" : "other",
      id: `m${String(index)}`,
      name: `Model ${String(index)}`,
      contextWindow: 100_000,
      reasoning: false,
    }));
    const { app } = testApp({ models: many });
    const page = await (await app.request("/sessions/s1")).text();
    const selector = page.slice(page.indexOf('id="model-selector"'));
    expect(selector).toContain('id="model-menu" popover="auto"');
    expect(selector).toContain(
      "anchored-menu menu-surface opens-up menu-model-selector",
    );
    expect(selector).toContain('class="menu-filter"');
    expect(selector).toContain('placeholder="Filter models…"');
    // Showing a popover focuses the first autofocus element inside it.
    expect(selector).toContain("autofocus");
    order(selector, ['data-provider="fake"', 'data-provider="other"']);
    // A pick is a request of its own: none of the composer's fields ride along.
    expect(selector).toContain('hx-params="none"');
    expect(selector).toContain("/sessions/s1/model?model=fake%2Fm0");
    expect(selector).toContain('hx-target="closest .model-selector"');
  });

  it("lists models by name and keeps the reasoning row above them", async () => {
    const { app } = testApp({
      models: [
        {
          provider: "fake",
          id: "zulu",
          name: "zulu",
          contextWindow: 100_000,
          reasoning: false,
        },
        {
          provider: "fake",
          id: "alpha",
          name: "Alpha via OpenRouter",
          contextWindow: 100_000,
          reasoning: false,
        },
      ],
    });
    const page = await (await app.request("/sessions/s1")).text();
    const selector = page.slice(page.indexOf('id="model-selector"'));
    // pi-web sorts by display name and never hoists the current model.
    order(selector, [
      'class="composer-thinking-field"',
      "Change reasoning level",
      'role="listbox"',
      "Alpha via OpenRouter",
      ">zulu<",
    ]);
  });

  it("applies a model pick and answers with the new selector", async () => {
    const { app } = testApp();
    const res = await app.request("/sessions/s1/model?model=fake%2Ffake-1", {
      method: "POST",
    });
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('id="model-selector"');
    expect(html).toContain('aria-selected="true"');
    // The reasoning control travels with it, as a child of the popover.
    expect(html).toContain('class="composer-thinking-field"');
    expect(html).toContain("Change reasoning level");
  });

  it("renders the queue panel and the compaction strip pi-web shows", async () => {
    const { app } = testApp({ delayMs: 200 });
    const first = new FormData();
    first.set("text", "go");
    await app.request("/sessions/s1/prompt", { method: "POST", body: first });
    const queued = new FormData();
    queued.set("text", "and then this");
    queued.set("behavior", "followUp");
    await app.request("/sessions/s1/prompt", { method: "POST", body: queued });
    const page = await (await app.request("/sessions/s1")).text();
    const status = page.slice(page.indexOf('id="status"'));
    order(status, [
      "text-transform:uppercase",
      "Queued · 1",
      "Remove all queued messages",
      "Recall to input",
      "border-radius:999px",
      "follow-up",
      "and then this",
    ]);
    // The recall must not post the draft and its attachments with it.
    expect(status).toContain('hx-params="none"');
  });
});

describe("conversation rail, shelf, and written files", () => {
  it("renders a mark per prompt, star, and branch, with previews", async () => {
    const { app, world } = testApp();
    const stored = world.store.get("s1");
    if (!stored) throw new Error("no session");
    // A second branch off the first question.
    stored.entries.push(userEntry("u2", "u1", "another approach"));
    stored.entries.push(assistantEntry("a2", "u2", "other answer", 41_000));
    stored.leafId = "a1";

    const page = await (await app.request("/sessions/s1")).text();
    expect(page).toContain('id="rail"');
    expect(page).toContain('data-branched="true"');
    expect(page).toContain('data-preview="first &lt;b&gt;question&lt;/b&gt;"');
    // The mark on the other branch navigates instead of scrolling.
    expect(page).toContain('data-branch="true"');
    expect(page).toContain('hx-post="/sessions/s1/navigate"');
    expect(page).toContain("minimap-graph");
    // pi-web keeps the root, the fork and each tip as bare graph nodes, which
    // is what gives the other branch a lane of its own (§5).
    expect(page).toContain('class="minimap-junction"');
    expect(page).toContain('data-graph-width="72"');
  });

  it("places marks on pi-web's rail geometry without measuring", async () => {
    const { app, world } = testApp();
    const stored = world.store.get("s1");
    if (!stored) throw new Error("no session");
    stored.entries.push(userEntry("u2", "a1", "second question"));
    stored.entries.push(assistantEntry("a2", "u2", "second answer", 41_000));

    const page = await (await app.request("/sessions/s1")).text();
    // Row r sits at 12px + r * min(50px, (height - 54px) / rows), which is
    // pi-web's `graphY` expressed against the rail's own height.
    expect(page).toContain("top:calc(12px + 0 * min(50px, (100% - 54px) / 1))");
    expect(page).toContain("top:calc(12px + 1 * min(50px, (100% - 54px) / 1))");
    expect(page).toContain('class="minimap-row"');
    expect(page).toContain('class="minimap-message"');
    expect(page).toContain('class="minimap-dot"');
    // A mark is never taller than pi-web's 32px cap.
    expect(page).toContain("height:max(1px, min(32px, 100%))");
  });

  it("draws the spine between marks on a linear session too", async () => {
    const { app, world } = testApp();
    const stored = world.store.get("s1");
    if (!stored) throw new Error("no session");
    stored.entries.push(userEntry("u2", "a1", "second question"));
    stored.entries.push(assistantEntry("a2", "u2", "second answer", 41_000));

    const page = await (await app.request("/sessions/s1")).text();
    expect(page).toContain('data-branched="false"');
    expect(page).toContain("minimap-graph");
    // No fork, so no structural nodes: pi-web draws the anchors alone.
    expect(page).not.toContain("minimap-junction");
    expect(page).toContain('data-graph-width="36"');
    // pi-web keeps 5px clear of each node — the one-pixel hole that leaves
    // between a node pill and its edge is in the reference too — and drops an
    // edge shorter than that, which `max(0px, ...)` says here.
    expect(page).toContain("top:calc(17px + 0 * min(50px, (100% - 54px) / 1))");
    expect(page).toContain(
      "height:max(0px, calc(1 * min(50px, (100% - 54px) / 1) - 10px))",
    );
    expect(page).toContain('class="is-active"');
  });

  it("re-sends the rail out of band when a turn settles", async () => {
    const { app } = testApp({ reply: () => "done" });
    const form = new FormData();
    form.set("text", "go");
    await app.request("/sessions/s1/prompt", { method: "POST", body: form });
    const res = await app.request("/sessions/s1/events");
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
    let received = "";
    const decoder = new TextDecoder();
    while (!received.includes("event: settled")) {
      const chunk = await reader.read();
      if (chunk.done) break;
      received += decoder.decode(chunk.value);
    }
    await reader.cancel();
    expect(received).toContain('id="rail" class="minimap-layer"');
    expect(received).toContain('hx-swap-oob="true"');
  });

  it("shows extension statuses and widgets in the shelf, ANSI converted", async () => {
    const { app } = testApp({
      script: () => [
        { status: "git", statusText: "\u001B[32mmain\u001B[0m  clean" },
        { widget: "todo", lines: ["\u001B[1mOpen\u001B[0m", "one", "two"] },
        { text: "done" },
      ],
    });
    const form = new FormData();
    form.set("text", "go");
    await app.request("/sessions/s1/prompt", { method: "POST", body: form });
    const res = await app.request("/sessions/s1/events");
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
    let received = "";
    const decoder = new TextDecoder();
    while (!received.includes("todo")) {
      const chunk = await reader.read();
      if (chunk.done) break;
      received += decoder.decode(chunk.value);
    }
    await reader.cancel();
    expect(received).toContain("event: shelf");
    expect(received).toContain('<span style="color:#13703a">main</span>');
    expect(received).toContain('<span style="font-weight:600">Open</span>');
    // pi-web's shelf: the trigger row, the status line, and the panel of the
    // one widget short enough to open unasked (§4.11).
    expect(received).toContain(
      'class="extension-status-shelf has-widgets has-status"',
    );
    expect(received).toContain('class="extension-widget-triggers"');
    expect(received).toContain('class="extension-widget-trigger is-expanded"');
    expect(received).toContain('class="extension-widget-panel-heading"');
    expect(received).toContain('class="extension-status-text"');
    expect(received).not.toContain("\u001B[");
  });

  it("keeps the shelf under the composer on the page itself", async () => {
    // The strip is the last row of the chat column, so the composer sits 36px
    // higher whenever an extension has something to say. A page that dropped
    // it moved every row below the top bar (ui-gaps r2, composer).
    const { app } = testApp({
      script: () => [{ status: "prune", statusText: "on" }, { text: "done" }],
    });
    const form = new FormData();
    form.set("text", "go");
    await app.request("/sessions/s1/prompt", { method: "POST", body: form });
    const res = await app.request("/sessions/s1/events");
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
    let received = "";
    const decoder = new TextDecoder();
    // The first shelf event is the empty strip the stream opens with; wait
    // for the one the extension's status filled.
    while (!received.includes("extension-status-text")) {
      const chunk = await reader.read();
      if (chunk.done) break;
      received += decoder.decode(chunk.value);
    }
    // The page is asked for while the stream is still open: web-pi lets go of
    // a live session once its last reader does.
    const page = await (await app.request("/sessions/s1")).text();
    await reader.cancel();
    const surface = page.indexOf('class="composer-surface"');
    // The composer's own "more" popover carries a second copy for phones, so
    // the strip itself is the one the stream swaps, by id.
    const shelf = page.indexOf('id="shelf"');
    const footerEnd = page.indexOf("</footer>", surface);
    expect(surface).toBeGreaterThan(-1);
    expect(shelf).toBeGreaterThan(surface);
    expect(shelf).toBeLessThan(footerEnd);
    expect(page.slice(shelf, footerEnd)).toContain(
      'class="extension-status-shelf has-status"',
    );
    expect(page.slice(shelf, footerEnd)).toContain(
      'class="extension-status-text"',
    );
  });

  it("chips the files a turn wrote and offers them as mentions", async () => {
    const { app } = testApp({
      script: () => [
        {
          tool: "edit",
          arguments: { file_path: "/repo/one/src/answer.ts" },
          result: "edited",
        },
        { text: "changed it" },
      ],
    });
    const form = new FormData();
    form.set("text", "go");
    await app.request("/sessions/s1/prompt", { method: "POST", body: form });
    await new Promise((resolve) => setTimeout(resolve, 80));
    const page = await (await app.request("/sessions/s1")).text();
    expect(page).toContain('aria-label="Files changed"');
    // The chip opens the file panel rather than typing a mention.
    expect(page).toContain('data-file-path="/repo/one/src/answer.ts"');
    expect(page).toContain('title="/repo/one/src/answer.ts"');
  });

  it("keeps a huge tool result off the page and cuts it when opened", async () => {
    const output = "x".repeat(40_000);
    const { app } = testApp({
      script: () => [
        { tool: "grep", arguments: { pattern: "x" }, result: output },
        { text: "found them" },
      ],
    });
    const form = new FormData();
    form.set("text", "go");
    await app.request("/sessions/s1/prompt", { method: "POST", body: form });
    await new Promise((resolve) => setTimeout(resolve, 80));
    const page = await (await app.request("/sessions/s1")).text();
    expect(page).not.toContain("xxxxx");
    // The whole page stays smaller than the one result it left out. The
    // slack is the shell's own markup, which the pixel port roughly doubled.
    expect(page.length).toBeLessThan(output.length + 15_000);

    const url = deferredUrl(page);
    const opened = await (await app.request(url)).text();
    expect(opened).toContain("view full output");
    expect(opened.length).toBeLessThan(output.length);
    const full = await (await app.request(`${url}?full=1`)).text();
    expect(full).toContain(output);
    expect(full).not.toContain("view full output");
  });

  it("cuts a diff that is longer than the budget", async () => {
    const hunk = Array.from(
      { length: 300 },
      (_, index) => `-old ${String(index)}\n+new ${String(index)}`,
    ).join("\n");
    const patch = `--- a/x.ts\n+++ b/x.ts\n@@ -1,600 +1,600 @@\n${hunk}\n`;
    const { app } = testApp({
      script: () => [
        {
          tool: "edit",
          arguments: { file_path: "/repo/one/x.ts" },
          details: { patch },
          result: "edited",
        },
        { text: "done" },
      ],
    });
    const form = new FormData();
    form.set("text", "go");
    await app.request("/sessions/s1/prompt", { method: "POST", body: form });
    await new Promise((resolve) => setTimeout(resolve, 80));
    const url = deferredUrl(await (await app.request("/sessions/s1")).text());
    const opened = await (await app.request(url)).text();
    expect(opened).toContain("view full output");
    expect(opened).not.toContain("new 299");
    const full = await (await app.request(`${url}?full=1`)).text();
    expect(full).toContain("new 299");
  });
});

describe("transcript rendering", () => {
  it("renders pi-web's message skeleton: band, header, footer, actions", async () => {
    const { app } = testApp();
    const page = await (await app.request("/sessions/s1")).text();
    // The user prompt: a full-width band with the 820px column inside it.
    expect(page).toContain('class="user-message-band"');
    expect(page).toContain('class="user-message-band-content"');
    expect(page).toContain('class="message-row"');
    // The answer: star toggle, model label, then the hover-only copy button.
    expect(page).toContain('class="answer-star-toggle"');
    expect(page).toContain("grid-template-columns:auto minmax(0, 1fr)");
    expect(page).toContain('class="message-actions message-copy"');
    expect(page).toContain('class="history-action-host"');
    expect(page).toContain('class="history-actions"');
    expect(page).toContain('class="history-action"');
    // Prose carries pi-web's variant class, which sets its 15px scale.
    expect(page).toContain("markdown-body markdown-assistant-message");
    expect(page).toContain("markdown-body markdown-user-message");
    // Usage, then the timestamp pushed to the right at 10px.
    expect(page).toContain("39,990 in · 10 out");
    expect(page).toContain("font-size:10px; color:var(--text-dim)");
  });

  it("keeps an extension card's copy button and details toggle on one row", async () => {
    const { app, world } = testApp();
    const stored = world.store.get("s1");
    if (!stored) throw new Error("no session");
    stored.entries.push({
      type: "custom_message",
      id: "c1",
      parentId: "a1",
      timestamp: "2026-09-02T00:00:00.000Z",
      customType: "pi-processes:update",
      content: "process finished",
      display: true,
      details: { exitCode: 0 },
    } as never);

    const page = await (await app.request("/sessions/s1")).text();
    // pi-web's footer is one flex row with the copy button and, pushed right,
    // the details toggle; the row itself is the disclosure here.
    expect(page).toContain('class="transcript-details note-details"');
    expect(page).toContain(
      '<span class="note-details-closed">Show details</span>',
    );
    expect(page).toContain(
      '<span class="note-details-open">Hide details</span>',
    );
    // The word alone, with no icon, is what pi-web copies with here.
    expect(page).toContain(
      '<button type="button" class="message-copy" style="padding:3px 7px;' +
        ' border:none; background:none; cursor:pointer; font-size:11px"' +
        ' data-copy="true" title="Copy message">Copy</button>',
    );
  });

  it("keeps the turn's usage, time and anchor on the answer alone", async () => {
    // One assistant message that reasons and then answers: pi-web splits it
    // around the answer and the process half carries none of the footer.
    const reasoned = assistantEntry("a1", "u1", "the answer", 40_000);
    if (reasoned.type === "message" && reasoned.message.role === "assistant") {
      reasoned.message.content = [
        { type: "thinking", thinking: "hm" },
        { type: "text", text: "the answer" },
      ] as never;
    }
    const { app } = testApp({
      sessions: [
        {
          summary: {
            id: "s1",
            cwd: "/repo/one",
            name: "Stored one",
            createdAt: "2026-09-01T00:00:00.000Z",
            modifiedAt: "2026-09-02T00:00:00.000Z",
            fileSize: 10,
          },
          entries: [userEntry("u1", null, "ask"), reasoned],
        },
      ],
    });
    const page = await (await app.request("/sessions/s1")).text();
    expect(page).toContain("39,990 in · 10 out");
    expect(page.split("39,990 in · 10 out")).toHaveLength(2);
    // Both halves render, but only the answer answers to the rail.
    expect(page.split('data-role="assistant"')).toHaveLength(3);
    expect(page.split('id="entry-a1"')).toHaveLength(2);
  });

  it("renders a tool call as pi-web's tinted card", async () => {
    const { app } = testApp({
      script: (): ScriptedStep[] => [
        { tool: "read", arguments: { path: "/repo/one/a.ts" }, result: "ok" },
        { text: "done" },
      ],
    });
    const form = new FormData();
    form.set("text", "look");
    await app.request("/sessions/s1/prompt", { method: "POST", body: form });
    await new Promise((resolve) => setTimeout(resolve, 60));
    const page = await (await app.request("/sessions/s1")).text();
    expect(page).toContain("border:1px solid rgba(34,197,94,0.25)");
    expect(page).toContain("background:rgba(34,197,94,0.04)");
    // Name in mono green, preview in dim mono, chevron last.
    expect(page).toContain(
      "color:var(--success); font-family:var(--font-mono)",
    );
    expect(page).toContain('class="card-chevron"');
    // The process disclosure keeps its own chevron and count line.
    expect(page).toContain('class="process-chevron"');
  });

  it("tints a failed card's loading placeholder like the card", async () => {
    const { app } = testApp({
      script: (): ScriptedStep[] => [
        {
          tool: "read",
          arguments: { path: "/repo/one/a.ts" },
          result: "no such file",
          isError: true,
        },
        { text: "done" },
      ],
    });
    const form = new FormData();
    form.set("text", "look");
    await app.request("/sessions/s1/prompt", { method: "POST", body: form });
    await new Promise((resolve) => setTimeout(resolve, 60));
    const page = await (await app.request("/sessions/s1")).text();
    expect(page).toContain("Loading output…");
    // The rule under the header follows the card, never the green default.
    expect(page).toContain(
      "background:var(--bg-subtle); border-top:1px solid rgba(248,113,113,0.25)",
    );
  });

  it("renders a notice as pi-web's shelf card", async () => {
    const { app, world } = testApp();
    await world.runtime.open({ sessionId: "s1" });
    const body = new FormData();
    body.set("cwd", "/repo/one");
    await app.request("/settings/plugins/reload", { method: "POST", body });
    const res = await app.request("/sessions/s1/events");
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
    let received = "";
    const decoder = new TextDecoder();
    while (!received.includes("event: notice")) {
      const chunk = await reader.read();
      if (chunk.done) break;
      received += decoder.decode(chunk.value);
    }
    await reader.cancel();
    expect(received).toContain('class="notice-shelf-item"');
    expect(received).toContain("border-radius:14px");
    expect(received).toContain("min-height:60px");
    // The type dot, then the message in its own scrolling span.
    expect(received).toContain("background:var(--accent)");
    expect(received).toContain("Resources reloaded.");
  });

  it("groups a turn into process details and the answer", async () => {
    const { app } = testApp({
      script: (): ScriptedStep[] => [
        { thinking: "checking the file" },
        { tool: "read", arguments: { path: "/repo/one/a.ts" }, result: "ok" },
        { text: "all done" },
      ],
    });
    const form = new FormData();
    form.set("text", "look");
    await app.request("/sessions/s1/prompt", { method: "POST", body: form });
    await new Promise((resolve) => setTimeout(resolve, 60));

    const page = await (await app.request("/sessions/s1")).text();
    expect(page).toContain("Process details · 1 message · 1 tool call");
    expect(page).toContain("checking the file");
    expect(page).toContain('class="markdown-body markdown-assistant-message"');
    expect(page).toContain("/repo/one/a.ts");
    expect(page).toContain("all done");
  });

  it("renders a reported patch as a side-by-side diff", async () => {
    const { app } = testApp({
      script: (): ScriptedStep[] => [
        {
          tool: "edit",
          arguments: { file_path: "/repo/one/a.ts" },
          details: {
            patch:
              "--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-const a = 1;\n+const a = 2;\n",
          },
        },
        { text: "changed it" },
      ],
    });
    const form = new FormData();
    form.set("text", "edit it");
    await app.request("/sessions/s1/prompt", { method: "POST", body: form });
    await new Promise((resolve) => setTimeout(resolve, 60));

    // A settled card ships a placeholder; the diff arrives when it opens.
    const page = await (await app.request("/sessions/s1")).text();
    expect(page).not.toContain("const a = 1;");
    const body = await (await app.request(deferredUrl(page))).text();
    expect(body).toContain("const a = 1;");
    expect(body).toContain("const a = 2;");
    expect(body).toContain(
      "grid-template-columns:minmax(0, 1fr) minmax(0, 1fr)",
    );
    // Edit tools show the diff instead of repeating their arguments.
    expect(body).not.toContain("&quot;file_path&quot;");
  });

  it("names the running tool while a turn works", async () => {
    const { app } = testApp({
      delayMs: 40,
      script: (): ScriptedStep[] => [
        { tool: "bash", arguments: { command: "ls" }, progress: ["scanning"] },
        { text: "done" },
      ],
    });
    const form = new FormData();
    form.set("text", "run it");
    await app.request("/sessions/s1/prompt", { method: "POST", body: form });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await (await app.request("/sessions/s1")).text()).toContain(
      "Running bash... scanning",
    );
  });

  it("pages a long transcript and prepends the page before it", async () => {
    const { app } = longApp();
    const page = await (await app.request("/sessions/s1")).text();
    expect(page).toContain("Scroll up to load earlier messages");
    expect(page).toContain("question 59");
    // The rail carries a preview of every prompt, so only the transcript
    // itself is checked for the messages the page left out.
    expect(page).toContain(">question 59<");
    expect(page).not.toContain(">question 10<");

    const before = /before=([^&"]+)/.exec(page)?.[1] ?? "";
    expect(before).not.toBe("");
    const earlier = await (
      await app.request(`/sessions/s1/earlier?before=${before}`)
    ).text();
    expect(earlier).toContain("question 34");
    expect(earlier).toContain('hx-get="/sessions/s1/earlier?before=');

    const bad = await app.request("/sessions/s1/earlier?before=nope");
    expect(bad.status).toBe(400);
  });

  it("fetches a thinking block the page was too long to carry", async () => {
    const { app } = longApp();
    const page = await (await app.request("/sessions/s1")).text();
    const url = /\/sessions\/s1\/entries\/[^/]+\/thinking\/0/.exec(page)?.[0];
    expect(url).toBeDefined();
    const block = await (await app.request(url ?? "")).text();
    expect(block).toContain("zzz");
    // pi-web reads thinking through the same TextBlock as an answer, so its
    // markdown is the 15px assistant type, not the 14px base.
    expect(block).toContain('class="markdown-body markdown-assistant-message"');
    const missing = await app.request("/sessions/s1/entries/nope/thinking/0");
    expect(await missing.text()).toContain("unavailable");
  });
});

describe("phase 8 fixes", () => {
  it("leaves the delivery mode to the hidden field, not to the submitter", async () => {
    const { app } = testApp();
    const page = await (await app.request("/sessions/s1")).text();
    // htmx appends a submitter's own name and value after the form's fields,
    // so a named button would always lose to the hidden field. The primary
    // button carries the mode as data, and the browser copies it across.
    expect(page).toContain('data-behavior="steer"');
    expect(page).not.toMatch(/name="behavior"\s+value="followUp"/);
    expect(page.match(/name="behavior"/g)).toHaveLength(1);
  });

  it("queues a follow-up instead of steering when asked to", async () => {
    const { app, world } = testApp({ delayMs: 30 });
    const first = new FormData();
    first.set("text", "go");
    await app.request("/sessions/s1/prompt", { method: "POST", body: first });
    const second = new FormData();
    second.set("text", "and then this");
    second.set("behavior", "followUp");
    await app.request("/sessions/s1/prompt", { method: "POST", body: second });

    expect(world.runtime.get("s1")?.snapshot().status.queue).toEqual([
      { text: "and then this", behavior: "followUp" },
    ]);
    const page = await (await app.request("/sessions/s1")).text();
    expect(page).toContain("follow-up");
  });

  it("carries the text ArrowUp cycles through", async () => {
    const { app } = testApp();
    const page = await (await app.request("/sessions/s1")).text();
    expect(page).toContain("data-user-text");
  });

  it("recalls queued images for the composer to put back", async () => {
    const { app } = testApp({ delayMs: 30 });
    const first = new FormData();
    first.set("text", "go");
    await app.request("/sessions/s1/prompt", { method: "POST", body: first });
    const second = new FormData();
    second.set("text", "with a picture");
    second.set("behavior", "followUp");
    second.set(
      "images[]",
      new File([Buffer.from("89504e47", "hex")], "shot.png", {
        type: "image/png",
      }),
    );
    await app.request("/sessions/s1/prompt", { method: "POST", body: second });

    const recalled = await (
      await app.request("/sessions/s1/queue/recall", { method: "POST" })
    ).text();
    expect(recalled).toContain("with a picture");
    expect(recalled).toContain('data-mime="image/png"');
  });

  it("colours the context badge from the reader's own threshold", async () => {
    const { app, world } = testApp();
    // pi-web reads context usage off the running agent, so the badge belongs
    // to an attached session and a stored one shows none.
    const stored = await (await app.request("/sessions/s1")).text();
    expect(stored).not.toContain("data-context-readout");
    await world.runtime.open({ sessionId: "s1" });
    const plain = await (await app.request("/sessions/s1")).text();
    expect(plain).toContain("data-context-readout");
    expect(plain).toContain("color:var(--text-muted)");
    // 40 000 tokens of a 100 000 window is 40 %: below every percent rule,
    // above a threshold the reader set at 30 000.
    const warned = await (
      await app.request("/sessions/s1", {
        headers: { cookie: "web-pi-warn-tokens=30000" },
      })
    ).text();
    expect(warned).toContain("rgba(234,179,8,0.95)");
  });

  it("keeps the compact button's warning in step with the readout", async () => {
    const { app, world } = testApp();
    await world.runtime.open({ sessionId: "s1" });
    const warn = { cookie: "web-pi-warn-tokens=1000" };
    const page = await (
      await app.request("/sessions/s1", { headers: warn })
    ).text();
    expect(page).toMatch(/id="context-compact"[^>]*data-warning/);
    // The stream re-renders the button beside the readout, so a turn that
    // moves the context tints it without a reload.
    const form = new FormData();
    form.set("text", "go");
    await app.request("/sessions/s1/prompt", { method: "POST", body: form });
    const res = await app.request("/sessions/s1/events", { headers: warn });
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
    let received = "";
    const decoder = new TextDecoder();
    while (!received.includes("event: status")) {
      const chunk = await reader.read();
      if (chunk.done) break;
      received += decoder.decode(chunk.value);
    }
    await reader.cancel();
    expect(received).toMatch(/id="context-compact"[^>]*hx-swap-oob/);
    expect(received).toMatch(/id="context-compact"[^>]*data-warning/);
  });

  it("lists what a subagent run was given, and its progress while it runs", async () => {
    const { app } = testApp({
      delayMs: 40,
      script: (): ScriptedStep[] => [
        {
          tool: "subagent",
          arguments: {
            calls: [
              { agent: "explorer", prompt: "look around", model: "fake-1" },
            ],
          },
          progress: ["reading src/"],
          details: {
            kind: "pi-subagent",
            results: [
              {
                agent: "explorer",
                exitCode: 0,
                model: "fake-1",
                messages: [
                  {
                    role: "assistant",
                    content: [{ type: "text", text: "ok" }],
                  },
                ],
              },
            ],
          },
        },
        { text: "done" },
      ],
    });
    const form = new FormData();
    form.set("text", "explore");
    await app.request("/sessions/s1/prompt", { method: "POST", body: form });

    await new Promise((resolve) => setTimeout(resolve, 100));
    const running = await (await app.request("/sessions/s1")).text();
    expect(running).toContain("reading src/");

    await new Promise((resolve) => setTimeout(resolve, 150));
    const page = await (await app.request("/sessions/s1")).text();
    expect(page).toContain("<dl");
    expect(page).toContain("<dt>Agent</dt>");
    expect(page).toContain("explorer");
  });

  it("shows the post-compaction estimate on the card", async () => {
    const { app, world } = testApp();
    world.store.set("k1", {
      summary: {
        id: "k1",
        cwd: "/repo/one",
        createdAt: "2026-09-01T00:00:00.000Z",
        modifiedAt: "2026-09-01T00:00:00.000Z",
        fileSize: 2,
      },
      entries: [
        userEntry("u1", null, "question"),
        {
          type: "compaction",
          id: "c1",
          parentId: "u1",
          timestamp: "2026-09-01T00:00:00.000Z",
          summary: "what happened",
          tokensBefore: 40_000,
          firstKeptEntryId: "u1",
        } as never,
      ],
    });
    const page = await (await app.request("/sessions/k1")).text();
    expect(page).toContain("40k → ~");
  });

  it("shows the name, the session file, and the context window in stats", async () => {
    const { app, world } = testApp();
    const stored = await (await app.request("/sessions/s1/stats")).text();
    expect(stored).toContain("Session File");
    expect(stored).toContain("/agent/sessions/s1.jsonl");
    expect(stored).toContain("data-session-copy");
    // Only a running agent knows what is in context, as in pi-web.
    expect(stored).not.toContain("Context window");
    await world.runtime.open({ sessionId: "s1" });
    const live = await (await app.request("/sessions/s1/stats")).text();
    expect(live).toContain("Context window");
  });

  it("offers the sidebar resize handle and a manual refresh", async () => {
    const { app } = testApp();
    const page = await (await app.request("/sessions/s1")).text();
    expect(page).toContain("sidebar-resize");
    expect(page).toContain('id="sidebar-refresh"');
  });

  it("serves a shell capture as an attachment when asked", async () => {
    const { app } = testApp();
    const attached = await app.request(
      "/sessions/s1/bash-output?path=/tmp/pi-bash-x.log&download=1",
    );
    // The session did not produce that file, so the containment answer comes
    // first; the download variant only changes the disposition.
    expect(attached.status).toBe(403);
  });

  it("reloads the live sessions of a folder from the plugins panel", async () => {
    const { app, world } = testApp();
    await world.runtime.open({ sessionId: "s1" });
    const body = new FormData();
    body.set("cwd", "/repo/one");
    const reloaded = await app.request("/settings/plugins/reload", {
      method: "POST",
      body,
    });
    expect(reloaded.status).toBe(200);
    expect(await reloaded.text()).toContain("Reloaded 1 session");
  });

  it("remembers which skill a folder was looking at", async () => {
    const { app } = testApp();
    const detail = await app.request(
      "/settings/skills/detail?cwd=/repo/one&path=/agent/skills/changelog/SKILL.md",
    );
    const cookie = detail.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("web-pi-skill");
    const page = await (
      await app.request("/settings?section=skills&cwd=/repo/one", {
        headers: { cookie: cookie.split(";")[0] ?? "" },
      })
    ).text();
    // The remembered skill is the one whose detail pane is open.
    const detailPane = page.slice(page.indexOf('class="config-detail"'));
    expect(detailPane).toContain("changelog");
  });
});

/**
 * The chrome pi-web keeps on every route: the top bar's three tabs, the file
 * panel, the sidebar's explorer, and settings as a modal over the workspace
 * rather than a page of its own.
 */
describe("the shell chrome, on every route", () => {
  /** Markers appear in this order, wherever else they appear. */
  function inOrder(text: string, markers: string[]): void {
    let at = 0;
    for (const marker of markers) {
      const found = text.indexOf(marker, at);
      expect([marker, found > -1]).toStrictEqual([marker, true]);
      at = found;
    }
  }

  it("starts a session on the index when a folder is known", async () => {
    const { app } = testApp();
    const html = await (await app.request("/")).text();
    expect(html).toContain('class="chat-empty"');
    expect(html).toContain('class="composer-surface"');
    expect(html).not.toContain("Select a session to view the conversation");
  });

  it("draws the top bar in pi-web's order without a session", async () => {
    const { app } = testApp();
    const html = await (await app.request("/new")).text();
    const bar = html.slice(html.indexOf('id="top-bar"'));
    inOrder(bar, [
      'id="sidebar-toggle"',
      'id="top-bar-tabs"',
      "Full history",
      'data-top-panel="system"',
      'data-top-panel="tools"',
      'id="page-refresh"',
      'id="file-panel-toggle"',
    ]);
    // No history to export yet, so pi-web disables that one tab.
    expect(bar).toContain(
      "Full history is available after the session is saved",
    );
    expect(bar).not.toContain('id="stats-trigger"');
    // The toggle takes the free space when no stats cluster does.
    expect(bar).toContain(
      'id="file-panel-toggle" style="display:flex; align-items:center; justify-content:center; width:36px; height:36px; padding:0; background:none; border:none; color:var(--text-muted); cursor:pointer; flex-shrink:0; transition:color 0.12s, background 0.12s; border-left:1px solid var(--border); margin-left:auto"',
    );
    // The panel itself stays mounted, collapsed, as pi-web keeps it.
    expect(html).toContain('id="file-panel"');
    expect(html).toContain("right-panel-container right-panel-closed");
  });

  it("keeps the phone's overflow button in front of the panel tabs", async () => {
    const { app } = testApp();
    const html = await (await app.request("/new")).text();
    const bar = html.slice(html.indexOf('id="top-bar"'));
    inOrder(bar, [
      'id="mobile-toolbar-more"',
      'aria-controls="top-bar-tabs"',
      'id="top-bar-tabs"',
    ]);
  });

  it("shows the explorer for the folder, with no session open", async () => {
    const { app } = testApp();
    const html = await (await app.request("/new")).text();
    const explorer = html.slice(html.indexOf('id="explorer-section"'));
    expect(explorer).toContain("/files/explorer?cwd=%2Frepo%2Fone");
    expect(explorer).toContain('id="explorer-search-toggle"');
    // pi-web keeps the field behind the magnifier until it is asked for.
    expect(explorer).toContain('id="file-search-field"');
    expect(explorer).toMatch(/id="file-search-field"[^>]*hidden/);
  });

  it("opens settings over the workspace, not on a page of its own", async () => {
    const { app } = testApp();
    const html = await (
      await app.request("/settings", {
        headers: { "HX-Current-URL": "http://x/sessions/s1" },
      })
    ).text();
    expect(html).toContain('class="settings-dialog"');
    // The session stays behind the dialog: transcript, composer and rail.
    expect(html).toContain('class="chat-transcript"');
    expect(html).toContain('class="composer-surface"');
    expect(html).toContain('id="rail-column"');
    expect(html).toContain('data-session-id="s1"');
    // And its row keeps the selection through the lazy row swap.
    expect(html).toContain("/row?active=s1");
  });

  it("names one folder in the pill, the tree and the title", async () => {
    const { app } = testApp();
    // Nothing is remembered yet, so the folder is the project the sidebar
    // shows — never the folder the server happens to have started in, which
    // would leave the pill and the tree naming different places.
    const html = await (await app.request("/")).text();
    expect(html).toContain('data-cwd="/repo/one"');
    expect(html).toContain("/files/explorer?cwd=%2Frepo%2Fone");
    expect(html).toContain('id="project-select"');
    expect(html).toContain('title="/repo/one"');
    // A folder the reader picked still wins over the project's own.
    const picked = await (
      await app.request("/new", {
        headers: { cookie: "web-pi-cwd=/repo/two" },
      })
    ).text();
    expect(picked).toContain('data-cwd="/repo/two"');
  });

  it("opens settings over the session the reader last opened", async () => {
    const { app } = testApp();
    // A settings page reached by its own URL carries no referrer, so the
    // session behind it comes from the cookie instead.
    const html = await (
      await app.request("/settings?section=general", {
        headers: { cookie: "web-pi-session=s1" },
      })
    ).text();
    expect(html).toContain('class="settings-dialog"');
    expect(html).toContain('data-session-id="s1"');
    expect(html).toContain('id="rail-column"');
    expect(html).toContain('class="chat-transcript"');
    // Full history exports that session, rather than sitting disabled.
    expect(html).toContain('href="/sessions/s1/export"');
    // Leaving for the index closes it: settings opened from there is the
    // new-session view again, as it is in pi-web.
    const index = await app.request("/");
    expect(index.headers.get("set-cookie")).toContain("web-pi-session=;");
  });

  it("names the reasoning level beside the model, as pi-web does", async () => {
    const { app } = testApp();
    const html = await (await app.request("/new")).text();
    const chip = html.slice(html.indexOf('id="model-trigger"'));
    expect(chip).toContain('<span class="composer-model-detail">auto</span>');
  });

  it("reads a stored session's reasoning level off its own branch", async () => {
    const { app, world } = testApp();
    const stored = world.store.get("s1");
    if (!stored) throw new Error("no session");
    stored.entries.push({
      type: "thinking_level_change",
      id: "t1",
      parentId: "a1",
      timestamp: new Date().toISOString(),
      thinkingLevel: "high",
    });
    stored.leafId = "t1";
    const html = await (await app.request("/sessions/s1")).text();
    const chip = html.slice(html.indexOf('id="model-trigger"'));
    // The fake model names its levels the way a provider would.
    expect(chip).toContain(
      '<span class="composer-model-detail">thorough</span>',
    );
  });

  it("opens a transcript image in a dialog instead of a new tab", async () => {
    const { app, world } = testApp();
    world.store.set("s2", {
      summary: {
        id: "s2",
        cwd: "/repo/one",
        createdAt: "2026-09-01T00:00:00.000Z",
        modifiedAt: "2026-09-02T00:00:00.000Z",
        fileSize: 2,
      },
      entries: [userEntry("i1", null, "look at this", 1)],
    });
    const html = await (await app.request("/sessions/s2")).text();
    expect(html).toContain("data-image-preview=");
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain('style="display:block; cursor:zoom-in"');
  });
});
