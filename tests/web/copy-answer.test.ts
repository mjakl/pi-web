import {
  assistantEntry,
  createFakeWorld,
  userEntry,
} from "@adapters/fake/index";
import { createWorkspace } from "@core/workspace";
import { createWebApp } from "@web/app";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  copyAnswerEntry,
  RAW_ANSWER,
  RAW_BLOCKS,
} from "#/web/fixtures/copy-answer";
import { htmxBrowser } from "#/web/htmx4-browser";

const browsers: Awaited<ReturnType<typeof htmxBrowser>>[] = [];
afterEach(async () => {
  await Promise.all(browsers.splice(0).map((browser) => browser.close()));
});

function fixture(paged = false) {
  const entries = [userEntry("user", null, "question"), copyAnswerEntry()];
  if (paged) {
    for (let index = 0; index < 60; index += 1)
      entries.push(
        userEntry(
          `u${String(index)}`,
          entries.at(-1)?.id ?? null,
          `Follow-up ${String(index)}`,
        ),
      );
  }
  const leafId = entries.at(-1)?.id;
  entries.push(assistantEntry("other-branch", "user", "WRONG BRANCH", 100));
  const summary = {
    cwd: "/repo",
    createdAt: "2026-09-01",
    modifiedAt: "2026-09-01",
    fileSize: 100,
  };
  const world = createFakeWorld({
    sessions: [
      { summary: { ...summary, id: "s1" }, entries, leafId },
      { summary: { ...summary, id: "s2" }, entries: [] },
    ],
  });
  const workspace = createWorkspace(world);
  const app = createWebApp({
    workspace,
    defaultCwd: "/repo",
    staticRoot: "static",
  });
  return { app, workspace, world };
}

type Browser = Awaited<ReturnType<typeof htmxBrowser>>;
function area(browser: Browser) {
  const field = browser.document.querySelector("textarea");
  if (!field) throw new Error("Missing composer");
  return field;
}
function type(browser: Browser, value: string) {
  area(browser).value = value;
  area(browser).dispatchEvent(
    new browser.window.Event("input", { bubbles: true }),
  );
}
function copy(browser: Browser) {
  type(browser, "/copy");
  area(browser).dispatchEvent(
    new browser.window.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );
}
const notices = (browser: Browser) =>
  browser.document.querySelector("#toasts")?.textContent;

async function open(paged = false, hold = false) {
  const f = fixture(paged);
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const browser = await htmxBrowser(
    await (await f.app.request("/sessions/s1")).text(),
    async (request) => {
      const response = await f.app.request(request);
      if (
        hold &&
        new URL(request.url).pathname.endsWith("/last-assistant-text")
      )
        await held;
      return response;
    },
  );
  browsers.push(browser);
  const write = vi
    .spyOn(browser.window.navigator.clipboard, "writeText")
    .mockResolvedValue(undefined);
  return { ...f, browser, write, release: () => release?.() };
}

describe("authoritative /copy through real routes and the shipped client", () => {
  it.each([false, true])(
    "copies raw active-branch text even with pagination=%s and a modified DOM",
    async (paged) => {
      const { browser, write, app } = await open(paged);
      if (paged)
        expect(browser.document.querySelector("#entry-answer")).toBeNull();
      else {
        expect(
          browser.document.querySelectorAll(".markdown-body").length,
        ).toBeGreaterThan(1);
        expect(browser.document.querySelector("[data-copy]")).not.toBeNull();
        expect(browser.document.body.innerHTML).toContain("PRIVATE REASONING");
        expect(browser.document.body.innerHTML).toContain("TOOL-ONLY.txt");
      }
      for (const element of browser.document.querySelectorAll(
        '[data-role="assistant"]',
      ))
        element.textContent = "WRONG DOM text, Copy, model, tool, timestamp";
      copy(browser);
      await expect.poll(() => write.mock.calls).toEqual([[RAW_ANSWER]]);
      await expect.poll(() => area(browser).value).toBe("");
      expect(notices(browser)).toContain("Answer copied.");
      expect(
        browser.requests.filter((request) => request.method === "POST"),
      ).toEqual([]);
      const response = await app.request("/sessions/s1/last-assistant-text");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("Content-Type")).toContain("text/plain");
      expect(await response.text()).toBe(RAW_ANSWER);
    },
  );

  it("keeps the per-message source copy working alongside /copy", async () => {
    const { browser, write } = await open();
    const sources = [
      ...browser.document.querySelectorAll("[data-copy-source]"),
    ];
    // Settled turns have separate process/answer halves, each with its own source button.
    for (const expected of [RAW_BLOCKS.slice(0, 2).join("\n"), RAW_BLOCKS[2]]) {
      const source = sources.find(
        (element) => element.textContent === expected,
      );
      expect(source).toBeDefined();
      const button = source?.nextElementSibling;
      if (!button) throw new Error("Missing source copy button");
      button.dispatchEvent(
        new browser.window.MouseEvent("click", { bubbles: true }),
      );
      await expect.poll(() => write.mock.calls.at(-1)).toEqual([expected]);
    }
    copy(browser);
    await expect.poll(() => write.mock.calls.at(-1)).toEqual([RAW_ANSWER]);
  });

  it("reads live branch changes instead of an old catalog or visible branch", async () => {
    const { workspace, world, app } = fixture();
    const live = await world.runtime.open({ sessionId: "s1" });
    await live.navigateTree("other-branch");
    expect(await workspace.lastAssistantText("s1")).toBe("WRONG BRANCH");
    expect(
      await (await app.request("/sessions/s1/last-assistant-text")).text(),
    ).toBe("WRONG BRANCH");
    await live.navigateTree("answer");
    expect(await workspace.lastAssistantText("s1")).toBe(RAW_ANSWER);
    await live.stop();
  });

  it("does not copy or clear the new session after a held lookup returns", async () => {
    const { browser, write, release } = await open(false, true);
    copy(browser);
    await expect
      .poll(() =>
        browser.requests.some((request) =>
          request.url.endsWith("/last-assistant-text"),
        ),
      )
      .toBe(true);
    browser.document.querySelector('a[href="/sessions/s2"]')?.dispatchEvent(
      new browser.window.MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
      }),
    );
    await expect
      .poll(() => browser.document.querySelector("main")?.dataset["sessionId"])
      .toBe("s2");
    type(browser, "new session draft");
    release();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(write).not.toHaveBeenCalled();
    expect(area(browser).value).toBe("new session draft");
    expect(notices(browser)).not.toContain("Answer copied.");
  });

  it("coalesces repeated /copy and cancels the result when the draft changes", async () => {
    const { browser, write, release } = await open(false, true);
    copy(browser);
    copy(browser);
    await expect
      .poll(
        () =>
          browser.requests.filter((request) =>
            request.url.endsWith("/last-assistant-text"),
          ).length,
      )
      .toBe(1);
    type(browser, "later draft");
    release();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(write).not.toHaveBeenCalled();
    expect(area(browser).value).toBe("later draft");
  });
});
