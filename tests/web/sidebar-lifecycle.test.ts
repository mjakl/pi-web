import { afterEach, expect, it } from "vitest";
import type { HTMLButtonElement } from "happy-dom";
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
