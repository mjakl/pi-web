import { afterEach, expect, it } from "vitest";
import type {
  HTMLButtonElement,
  HTMLElement,
  HTMLFormElement,
} from "happy-dom";
import { createFakeWorld } from "@adapters/fake";
import { createWorkspace } from "@core/workspace";
import { createWebApp } from "@web/app";
import { htmxBrowser } from "#/web/htmx4-browser";

const browsers: Awaited<ReturnType<typeof htmxBrowser>>[] = [];
afterEach(async () => {
  for (const browser of browsers.splice(0)) await browser.close();
});

async function fixture() {
  const world = createFakeWorld({
    sessions: ["newer-stopped", "first", "middle", "last", "older-stopped"].map(
      (id, index) => ({
        summary: {
          id,
          cwd: "/fixture",
          name: id,
          createdAt: "2026-09-01T00:00:00.000Z",
          modifiedAt: `2026-09-0${String(6 - index)}T00:00:00.000Z`,
          fileSize: 0,
        },
        entries: [],
      }),
    ),
    script: () => [{ dialog: { method: "confirm", title: "Continue?" } }],
  });
  const workspace = createWorkspace(world);
  for (const id of ["first", "middle", "last"]) await workspace.activate(id);
  const app = createWebApp({
    workspace,
    defaultCwd: "/fixture",
    staticRoot: "static",
  });
  const browser = await htmxBrowser(
    await (await app.request("/sessions/first")).text(),
    (request) => app.request(request),
  );
  browsers.push(browser);
  await expect
    .poll(() =>
      browser.requests.some(
        (request) => new URL(request.url).pathname === "/events",
      ),
    )
    .toBe(true);
  const order = () =>
    [...browser.document.querySelectorAll("#session-list .session-row")].map(
      (row) => row.getAttribute("data-session-id"),
    );
  expect(order()).toEqual([
    "first",
    "middle",
    "last",
    "newer-stopped",
    "older-stopped",
  ]);
  return { ...browser, workspace, world, app, order };
}

it.each(["session", "draft", "worktree"])(
  "preserves sidebar context through refresh, stream updates and New Session from a %s",
  async (mode) => {
    const world = createFakeWorld({
      sessions: [
        { id: "alpha", cwd: "/alpha", day: "01" },
        { id: "sibling", cwd: "/alpha.wt", day: "02" },
        { id: "beta", cwd: "/beta", day: "03" },
      ].map(({ id, cwd, day }) => ({
        summary: {
          id,
          cwd,
          name: id,
          fileSize: 0,
          createdAt: "2026-09-01T00:00:00.000Z",
          modifiedAt: `2026-09-${day}T00:00:00.000Z`,
        },
        entries: [],
      })),
      reply: () => "Answer",
    });
    world.projects.resolve = (cwd) =>
      Promise.resolve({
        root: cwd === "/alpha.wt" ? "/alpha" : cwd,
        branch: null,
        isWorktree: cwd === "/alpha.wt",
        isTopLevel: cwd !== "/alpha.wt",
      });
    const workspace = createWorkspace(world);
    const app = createWebApp({
      workspace,
      defaultCwd: "/beta",
      staticRoot: "static",
    });
    const b = await htmxBrowser(
      await (await app.request("/sessions/alpha")).text(),
      (request) => {
        // The harness does not forward cookies. Model another tab's saved
        // preferences explicitly, so displayed-owner headers must win.
        request.headers.set(
          "Cookie",
          "web-pi-project=%2Fbeta; web-pi-cwd=%2Fbeta",
        );
        return app.request(request);
      },
    );
    browsers.push(b);
    if (mode === "draft") {
      b.document.querySelector<HTMLElement>("a[data-session-link]")?.click();
      await expect.poll(() => b.window.location.pathname).toBe("/new");
    }
    if (mode === "worktree") {
      await b.window.eval(
        `htmx.ajax('GET','/sidebar?project=%2Falpha&cwd=%2Falpha.wt',{source:'#project-select',target:'#project-nav',swap:'outerHTML'})`,
      );
    }
    const cwd = mode === "worktree" ? "/alpha.wt" : "/alpha";
    const main = b.document.querySelector("main");
    const nav = b.document.querySelector("#project-nav");
    b.window.eval(
      `document.querySelector('#composer-text').value='keep draft';document.querySelector('#composer-text').dispatchEvent(new Event('input',{bubbles:true}))`,
    );
    b.document.querySelector<HTMLButtonElement>("#sidebar-refresh")?.click();
    await expect
      .poll(() => b.document.querySelector("#project-nav") !== nav)
      .toBe(true);
    expect(b.document.querySelector("#row-alpha")).not.toBeNull();
    expect(b.document.querySelector("#row-sibling")).not.toBeNull();
    expect(b.document.querySelector("#row-beta")).toBeNull();
    const stream = b.document
      .querySelector("#sidebar-events")
      ?.getAttribute("hx-sse:connect");
    expect(stream).toContain("project=%2Falpha");
    expect(stream).toContain(`cwd=${encodeURIComponent(cwd)}`);
    await expect
      .poll(
        () =>
          b.requests.filter((r) => new URL(r.url).pathname === "/events")
            .length,
      )
      .toBeGreaterThan(1);
    const picker = b.document.querySelector("#project-select");
    await workspace.activate("beta");
    await expect
      .poll(() => b.document.querySelector("#project-select") !== picker)
      .toBe(true);
    expect(
      b.document.querySelector("#project-select")?.getAttribute("data-cwd"),
    ).toBe(cwd);
    expect(b.document.querySelector("main")).toBe(main);
    expect(
      b.window.eval(`document.querySelector('#composer-text').value`),
    ).toBe("keep draft");
    b.document.querySelector<HTMLElement>("a[data-session-link]")?.click();
    await expect
      .poll(() => b.document.querySelector("main")?.getAttribute("data-cwd"))
      .toBe(cwd);
    await expect.poll(() => b.window.location.pathname).toBe("/new");
    await expect
      .poll(() =>
        b.document
          .querySelector("#composer")
          ?.hasAttribute("data-htmx-powered"),
      )
      .toBe(true);
    b.window.eval(
      `document.querySelector('#composer-text').value='start here';document.querySelector('#composer-text').dispatchEvent(new Event('input',{bubbles:true}))`,
    );
    b.document.querySelector<HTMLFormElement>("#composer")?.requestSubmit();
    await expect
      .poll(
        () =>
          b.document.querySelector("main")?.getAttribute("data-session-id") ??
          "",
      )
      .not.toBe("");
    const id = b.document
      .querySelector("main")
      ?.getAttribute("data-session-id");
    if (!id) throw new Error("New session did not open");
    expect((await workspace.row(id))?.summary.cwd).toBe(cwd);
  },
);

it.each(["row action", "runtime stop"])(
  "moves a stopped session below live sessions after %s",
  async (source) => {
    const b = await fixture();
    if (source === "row action") {
      const stop = b.document.querySelector<HTMLButtonElement>(
        '#row-middle button[hx-post="/sessions/middle/stop"]',
      );
      if (!stop) throw new Error("missing stop action");
      stop.click();
    } else {
      await b.workspace.stop("middle");
    }
    await expect
      .poll(() =>
        b.document
          .querySelector("#row-middle .session-indicator")
          ?.getAttribute("data-status"),
      )
      .toBe("Session stopped");
    await expect
      .poll(b.order)
      .toEqual(["first", "last", "newer-stopped", "middle", "older-stopped"]);
    expect(b.world.runtime.get("middle")).toBeUndefined();
    expect(
      b.document.querySelector("main")?.getAttribute("data-session-id"),
    ).toBe("first");
  },
);

it("keeps an aborted turn's session live rather than moving it into the stopped group", async () => {
  const b = await fixture();
  await b.app.request("/sessions/middle/prompt", {
    method: "POST",
    body: new URLSearchParams({ text: "wait for confirmation" }),
  });
  await b.app.request("/sessions/middle/abort", { method: "POST" });
  await expect
    .poll(() =>
      b.document
        .querySelector("#row-middle .session-indicator")
        ?.getAttribute("data-status"),
    )
    .toBe("Session active");
  expect(b.world.runtime.get("middle")).toBeDefined();
  expect(b.order().indexOf("middle")).toBeLessThan(
    b.order().indexOf("newer-stopped"),
  );
});
