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
    expect(html).toContain("40k / 100k (40%)");
    expect(html).toContain("not running");
  });

  it("ships the shell: theme before paint, drawer, and hashed assets", async () => {
    const { app } = testApp();
    const html = await (await app.request("/sessions/s1")).text();
    expect(html).toContain("web-pi:theme");
    expect(html).toContain('<script type="module" src="/static/client.js?v=');
    expect(html).toContain('<link rel="stylesheet" href="/static/app.css?v=');
    expect(html).toContain("md:drawer-open");
    expect(html).toContain('id="nav-drawer"');
    expect(html).toContain('id="theme-select"');
    expect(html).toContain('data-session-id="s1"');
    expect(html).toContain('id="composer-text"');
    expect(html).toContain('id="toasts"');
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
    expect(starred).toContain("★ 1");

    const cleared = await (
      await app.request("/sessions/s1/stars/clear", { method: "POST" })
    ).text();
    expect(cleared).not.toContain("★ 1");
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
    expect(other).toContain("Branches (2)");

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
    expect(stats).toContain("User messages");
    expect(stats).toContain("Total tokens");

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
    // A stopped session lists prompts and skills but no extension commands.
    expect(all).not.toContain("/review");

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

    const scoped = await app.request(
      "/sessions/s1/file-index?cwd=%2Frepo%2Fone%2Fsrc&q=main",
    );
    expect(scoped.status).toBe(200);
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

  it("folds subagent runs out of the list and loads them on demand", async () => {
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
    expect(list).toContain("1 subagent run");
    expect(list).not.toContain('href="/sessions/subagent.abc"');

    const runs = await (
      await app.request("/sidebar/subagents?project=%2Frepo%2Fone&parent=s1")
    ).text();
    expect(runs).toContain('href="/sessions/subagent.abc"');
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
    expect(page).toContain("rail-links");
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
    expect(received).toContain('id="rail" class="rail"');
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
    // Three lines is small enough to open unasked.
    expect(received).toContain("widget-panel");
    expect(received).not.toContain("\u001B[");
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
    expect(page).toContain('data-mention="src/answer.ts"');
    expect(page).toContain('title="/repo/one/src/answer.ts"');
  });
});

describe("transcript rendering", () => {
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

    const page = await (await app.request("/sessions/s1")).text();
    expect(page).toContain("const a = 1;");
    expect(page).toContain("const a = 2;");
    expect(page).toContain("grid-cols-2");
    // Edit tools show the diff instead of repeating their arguments.
    expect(page).not.toContain("&quot;file_path&quot;");
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
    const missing = await app.request("/sessions/s1/entries/nope/thinking/0");
    expect(await missing.text()).toContain("unavailable");
  });
});
