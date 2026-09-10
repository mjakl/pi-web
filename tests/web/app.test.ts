import {
  assistantEntry,
  createFakeWorld,
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
    // `hx-on--keydown` would bind the htmx event htmx:keydown, not the DOM one.
    expect(html).toContain("hx-on-keydown");
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
    expect(prompt.status).toBe(200);

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
    expect(received).toMatch(/event: settled\ndata: <article/);
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

  it("reports a failed action in the shared notice", async () => {
    const { app } = testApp();
    const form = new FormData();
    form.set("entryId", "u1");
    const res = await app.request("/sessions/s1/star", {
      method: "POST",
      body: form,
    });
    expect(res.headers.get("hx-retarget")).toBe("#notice");
    expect(await res.text()).toContain("assistant answer");
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
    expect(received).toContain("data: s1");
  });
});
