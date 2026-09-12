import type { HTMLButtonElement, HTMLDetailsElement } from "happy-dom";
import { afterEach, expect, it } from "vitest";
import { htmxBrowser } from "#/web/htmx4-browser";
import { streamingFixture } from "#/web/fixtures/streaming";
import { disconnectable } from "#/web/fixtures/disconnect";

const browsers: Awaited<ReturnType<typeof htmxBrowser>>[] = [];
afterEach(async () => {
  await Promise.all(browsers.splice(0).map((browser) => browser.close()));
});
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Missing fixture element");
  return value;
}
async function open(
  f: Awaited<ReturnType<typeof streamingFixture>>,
  markup?: string,
  transport = (request: Request) => f.app.request(request),
) {
  const browser = await htmxBrowser(
    markup ?? (await (await f.app.request(`/sessions/${f.id}`)).text()),
    (request) =>
      new URL(request.url).pathname === "/events"
        ? new Response("")
        : transport(request),
  );
  browsers.push(browser);
  return browser;
}

it("renders each live update from one coherent runtime snapshot", async () => {
  const f = await streamingFixture();
  const { document } = await open(f);
  await expect.poll(() => f.subscribers).toBe(1);
  await expect.poll(() => f.snapshotReads).toBeGreaterThan(0);

  f.resetSnapshotReads();
  f.runningTools();
  f.emit("activity");

  await expect
    .poll(() => document.querySelector("#turn")?.textContent)
    .toContain("streaming text");
  expect(f.snapshotReads).toBe(1);
});

it("recovers a canonical answer settled between page render and initial subscription", async () => {
  const f = await streamingFixture();
  f.runningTools();
  const markup = await (await f.app.request(`/sessions/${f.id}`)).text();
  f.finish("missed canonical answer", false);
  const { document } = await open(f, markup);
  await expect
    .poll(() => document.querySelector("#messages")?.textContent)
    .toContain("missed canonical answer");
  await expect
    .poll(() => document.querySelector("#status [data-running]"))
    .toBeNull();
  expect(document.querySelectorAll("#entry-a1")).toHaveLength(1);
  expect(document.querySelector("#turn")?.textContent).toBe("");
});

it("keeps an opened completed tool and fetched full output while another message streams", async () => {
  const f = await streamingFixture();
  f.runningTools();
  const { document } = await open(f);
  await expect.poll(() => f.subscribers).toBe(1);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const card = required(
    document.querySelector<HTMLDetailsElement>('[data-tool="read"]'),
  );
  card.open = true;
  required(
    card.querySelector<HTMLButtonElement>('button[hx-get*="full=1"]'),
  ).click();
  await expect
    .poll(() => card.querySelector('button[hx-get*="full=1"]'))
    .toBeNull();
  const body = required(card.querySelector(".tool-result"));
  const output = required(body.querySelector("div > pre"));
  output.scrollTop = 120;
  const changing = required(
    document.querySelector<HTMLDetailsElement>("#tool-call-changing"),
  );
  changing.open = true;
  expect(body.textContent?.length).toBeGreaterThan(30_000);
  const partial = required(f.snapshot.partial);
  f.update(
    {
      partial: {
        ...partial,
        content: [{ type: "text", text: "updated streaming text" }],
      },
    },
    "activity",
  );
  await expect
    .poll(() => document.querySelector("#turn")?.textContent)
    .toContain("updated streaming text");
  expect(document.querySelector('[data-tool="read"]')).toBe(card);
  expect(card.open).toBe(true);
  expect(card.querySelector(".tool-result")).toBe(body);
  expect(output.scrollTop).toBe(120);
  const branch = [
    ...f.snapshot.branch,
    {
      type: "message" as const,
      id: "changing-result",
      parentId: "tool-result",
      timestamp: new Date().toISOString(),
      message: {
        role: "toolResult" as const,
        toolCallId: "call-changing",
        toolName: "read",
        content: [{ type: "text" as const, text: "truthful changed result" }],
        isError: true,
        timestamp: Date.now(),
      },
    },
  ];
  f.update({ branch, entries: branch }, "activity");
  await expect
    .poll(() => changing.textContent)
    .toContain("truthful changed result");
  expect(changing.open).toBe(true);
  expect(document.querySelector("#tool-call-changing")).toBe(changing);
  expect(card.querySelector(".tool-result")).toBe(body);
  f.update(
    {
      turnStart: branch.length,
      partial: undefined,
      status: { ...f.snapshot.status, running: false, tools: [] },
    },
    "turn_done",
  );
  await expect
    .poll(() => document.querySelector("#turn")?.textContent)
    .toBe("");
  expect(document.querySelectorAll("#tool-call-complete")).toHaveLength(1);
  expect(document.querySelectorAll("#tool-call-changing")).toHaveLength(1);
});

it.each([0, 1, 3, 30])(
  "reconciles %i missed turns without replaying delivered history or pulling a paginated reader down",
  async (missed) => {
    const f = await streamingFixture();
    for (let i = 0; i < 40; i += 1)
      f.finish(`older answer ${String(i)}`, false);
    const transport = disconnectable((request) => f.app.request(request));
    const { document, window } = await open(f, undefined, transport.request);
    await expect.poll(() => transport.connections.length).toBe(1);
    const sentinel = required(document.querySelector(".load-earlier"));
    const url = required(sentinel.getAttribute("hx-get"));
    await window.eval(
      `htmx.ajax('GET', ${JSON.stringify(url)}, {target:'.load-earlier', swap:'outerHTML'})`,
    );
    const oldest = required(document.querySelector("#entry-u1"));
    const log = required(document.querySelector("#log"));
    Object.defineProperties(log, {
      scrollHeight: { configurable: true, value: 10_000 },
      clientHeight: { configurable: true, value: 500 },
    });
    log.scrollTop = 9500;
    log.dispatchEvent(new window.Event("scroll"));
    log.scrollTop = 500;
    log.dispatchEvent(new window.Event("scroll"));
    let done = 0;
    document.body.addEventListener("done", () => {
      done += 1;
    });
    f.finish("already delivered");
    await expect
      .poll(() => document.querySelector("#entry-a41")?.textContent)
      .toContain("already delivered");
    required(transport.connections[0]).disconnect();
    for (let i = 0; i < missed; i += 1)
      f.finish(`missed answer ${String(i)}`, false);
    // Also cover reconnection to an active newer turn, not only an empty idle tail.
    if (missed > 1) f.runningTools();
    await expect.poll(() => transport.connections.length).toBe(2);
    await expect
      .poll(() => document.querySelector(`#entry-a${String(41 + missed)}`))
      .not.toBeNull();
    expect(
      required(transport.connections[1]).request.headers.get("Last-Event-ID"),
    ).toBe("settled=a41");
    expect(document.querySelectorAll("#entry-a41")).toHaveLength(1);
    for (let i = 0; i < missed; i += 1)
      expect(
        document.querySelectorAll(`#entry-a${String(42 + i)}`),
      ).toHaveLength(1);
    expect(document.querySelector("#entry-u1")).toBe(oldest);
    expect(document.querySelector(".load-earlier")).toBeNull();
    expect(log.scrollTop).toBe(500);
    await expect
      .poll(() => document.querySelector("#status [data-running]") !== null)
      .toBe(missed > 1);
    expect(done).toBe(0);
  },
);

it("reconciles each live-end boundary from the current snapshot, including a newer active turn", async () => {
  const f = await streamingFixture();
  const { document } = await open(f);
  await expect.poll(() => f.subscribers).toBe(1);
  f.finish("first finished");
  f.finish("second finished");
  f.runningTools();
  f.emit("activity");
  await expect
    .poll(() => document.querySelector("#entry-a2")?.textContent)
    .toContain("second finished");
  expect(document.querySelectorAll("#entry-a1")).toHaveLength(1);
  expect(document.querySelectorAll("#entry-a2")).toHaveLength(1);
  expect(document.querySelector("#turn")?.textContent).toContain(
    "streaming text",
  );
  await expect
    .poll(() => document.querySelector("#status [data-running]"))
    .not.toBeNull();
});

it("recovers settlement during the native initial 500ms subscription retry gap", async () => {
  const f = await streamingFixture();
  f.runningTools();
  let attempts = 0;
  const { document } = await open(f, undefined, (request) => {
    if (new URL(request.url).pathname.endsWith("/events") && ++attempts === 1) {
      f.finish("finished during retry", false);
      return Promise.resolve(new Response("busy", { status: 503 }));
    }
    return f.app.request(request);
  });
  await expect
    .poll(() => document.querySelector("#entry-a1")?.textContent)
    .toContain("finished during retry");
  expect(attempts).toBe(2);
  expect(document.querySelectorAll("#entry-a1")).toHaveLength(1);
});

it.each(["disconnect", "body replacement"])(
  "prevents a delayed old response from overwriting new activity after %s",
  async (action) => {
    const f = await streamingFixture();
    const transport = disconnectable((request) => f.app.request(request));
    const { document, window } = await open(f, undefined, transport.request);
    await expect.poll(() => f.subscribers).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const original = f.workspace.viewSession;
    const blocked = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    let delay = true;
    f.workspace.viewSession = async (...args) => {
      const view = await original(...args);
      if (delay) {
        delay = false;
        blocked.resolve(undefined);
        await release.promise;
      }
      return view;
    };
    f.finish("delayed old answer");
    await blocked.promise;
    if (action === "disconnect")
      required(transport.connections[0]).disconnect();
    else
      await window.eval(
        "htmx.swap({target:document.body,sourceElement:document.body,text:'',swap:'innerHTML'})",
      );
    f.finish("new canonical answer", false);
    f.runningTools();
    if (action === "body replacement") {
      const markup = await (await f.app.request(`/sessions/${f.id}`)).text();
      const body = required(/<body[^>]*>([\s\S]*)<\/body>/.exec(markup)?.[1]);
      await window.eval(
        `htmx.swap({target:document.body,sourceElement:document.body,text:${JSON.stringify(body)},swap:'innerHTML'})`,
      );
    }
    await expect.poll(() => transport.connections.length).toBe(2);
    await expect
      .poll(() => document.querySelector("#entry-a2")?.textContent)
      .toContain("new canonical answer");
    release.resolve(undefined);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(document.querySelectorAll("#entry-a1")).toHaveLength(1);
    expect(document.querySelectorAll("#entry-a2")).toHaveLength(1);
    expect(document.querySelector("#turn")?.textContent).toContain(
      "streaming text",
    );
    expect(document.querySelector("#status [data-running]")).not.toBeNull();
    expect(f.subscribers).toBe(1);
  },
);

it("recovers a stored session whose new runtime finishes before the subscription wait finds it", async () => {
  const f = await streamingFixture();
  f.finish("stored answer", false);
  f.world.store.set(f.id, {
    summary: f.snapshot.summary,
    entries: [...f.snapshot.entries],
  });
  const get = f.world.runtime.get.bind(f.world.runtime);
  let attached = false;
  f.world.runtime.get = (id) => (attached ? get(id) : undefined);
  const { document } = await open(f);
  expect(f.subscribers).toBe(0);
  f.finish("finished before runtime subscription", false);
  attached = true;
  await expect
    .poll(() => document.querySelector("#entry-a2")?.textContent)
    .toContain("finished before runtime subscription");
  expect(document.querySelectorAll("#entry-a1")).toHaveLength(1);
  expect(document.querySelectorAll("#entry-a2")).toHaveLength(1);
  expect(f.subscribers).toBe(1);
});

it("reconciles persisted entries at runtime removal before closing the stream", async () => {
  const f = await streamingFixture();
  f.finish("already rendered", false);
  const { document } = await open(f);
  await expect.poll(() => f.subscribers).toBe(1);
  f.finish("persisted just before stop", false);
  f.world.store.set(f.id, {
    summary: f.snapshot.summary,
    entries: [...f.snapshot.entries],
  });
  f.world.runtime.get = () => undefined;
  f.emit("stopped");
  await expect
    .poll(() => document.querySelector("#entry-a2")?.textContent)
    .toContain("persisted just before stop");
  await expect.poll(() => f.subscribers).toBe(0);
  expect(document.querySelectorAll("#entry-a1")).toHaveLength(1);
  expect(document.querySelectorAll("#entry-a2")).toHaveLength(1);
});

it("dispatches completion only after canonical messages, live tail and status have settled", async () => {
  const f = await streamingFixture();
  const { document } = await open(f);
  await expect.poll(() => f.subscribers).toBe(1);
  const completed: unknown[] = [];
  document.body.addEventListener("done", () => {
    completed.push({
      answer: document.querySelectorAll("#entry-a1").length,
      tail: document.querySelector("#turn")?.textContent,
      running: document.querySelector("#status [data-running]") !== null,
    });
  });
  f.finish("completed answer");
  f.emit("completed");
  await expect
    .poll(() => completed)
    .toEqual([{ answer: 1, tail: "", running: false }]);
});
