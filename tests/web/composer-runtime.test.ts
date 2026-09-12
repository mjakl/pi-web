import { createFakeWorld } from "@adapters/fake/index";
import { createPiModelCatalog } from "@adapters/pi/model-catalog";
import { createWorkspace } from "@core/workspace";
import { createWebApp } from "@web/app";
import {
  ProjectTrustStore,
  SessionManager,
  SettingsManager,
  type BashOperations,
} from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { HTMLButtonElement, HTMLSelectElement } from "happy-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createHarness,
  MODEL_ID,
  MODEL_2,
  PROVIDER,
  next,
  type Harness,
} from "#/adapters/pi-harness";
import { htmxBrowser, page } from "#/web/htmx4-browser";

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Missing fixture value");
  return value;
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let h: Harness | undefined;
const browsers: Awaited<ReturnType<typeof htmxBrowser>>[] = [];
afterEach(async () => {
  await Promise.all(browsers.splice(0).map((browser) => browser.close()));
  await h?.dispose();
  h = undefined;
  vi.restoreAllMocks();
});

async function fixture(bashOperations?: BashOperations) {
  h = await createHarness({
    settings: { defaultThinkingLevel: "low" },
    ...(bashOperations ? { bashOperations } : {}),
  });
  const harness = h;
  // The menu reads disk metadata; the harness registers the same models with
  // an offline provider. Neither path can contact a real model endpoint.
  await writeFile(
    join(h.agentDir, "models.json"),
    JSON.stringify({
      providers: {
        [PROVIDER]: {
          api: "openai-completions",
          baseUrl: "http://scripted.invalid",
          apiKey: "fixture",
          models: [
            { id: MODEL_ID, name: "Global model", reasoning: false },
            { id: MODEL_2, name: "Scoped model", reasoning: true },
          ],
        },
      },
    }),
  );
  await mkdir(join(h.cwd, ".pi"));
  await writeFile(
    join(h.cwd, ".pi", "settings.json"),
    JSON.stringify({ enabledModels: [`${PROVIDER}/${MODEL_2}:high`] }),
  );
  new ProjectTrustStore(h.agentDir).set(h.cwd, true);
  const world = createFakeWorld();
  world.runtime = h.runtime;
  world.sessions = h.catalog;
  world.models = createPiModelCatalog({ agentDir: h.agentDir });
  const workspace = createWorkspace(world);
  const app = createWebApp({
    workspace,
    defaultCwd: h.cwd,
    staticRoot: "static",
    renderIntervalMs: 1,
  });
  return { app, h: harness };
}

type App = Awaited<ReturnType<typeof fixture>>["app"];
async function composer(app: App, id?: string) {
  const html = await (
    await app.request(id ? `/sessions/${id}` : "/new")
  ).text();
  const form = required(/<form id="composer"[\s\S]*?<\/form>/.exec(html)?.[0]);
  const browser = await htmxBrowser(
    page(
      `<div id="session-region" hx-history-elt hx-sync="this:replace"><main ${id ? `data-session-id="${id}"` : ""}>${form}</main><div id="toasts"></div></div>`,
    ),
    (request) => app.request(request),
  );
  browsers.push(browser);
  return browser;
}

function shell() {
  const finish = Promise.withResolvers<{ exitCode: number | null }>();
  let aborted = false;
  const exec = vi.fn<BashOperations["exec"]>((_command, _cwd, options) => {
    options.onData(Buffer.from("shell output\n"));
    options.signal?.addEventListener(
      "abort",
      () => {
        aborted = true;
        finish.resolve({ exitCode: null });
      },
      { once: true },
    );
    return finish.promise;
  });
  return {
    operations: { exec },
    finish,
    get aborted() {
      return aborted;
    },
  };
}

const post = (app: App, cwd: string, text: string, id?: string) =>
  app.request(id ? `/sessions/${id}/prompt` : "/sessions", {
    method: "POST",
    headers: { "HX-Request": "true" },
    body: new URLSearchParams({ cwd, text }),
  });

describe("production startup from the rendered composer", () => {
  it("keeps untrusted project settings out of both the menu and startup", async () => {
    const { app, h } = await fixture();
    new ProjectTrustStore(h.agentDir).set(h.cwd, false);
    const browser = await composer(app);
    expect(
      browser.document.querySelector("#model-trigger")?.textContent,
    ).toMatch(/^Global model/);
    expect(
      browser.document.querySelector(".composer-model-detail")?.textContent,
    ).not.toBe("high");
    const response = await post(app, h.cwd, "/name untrusted");
    expect(response.headers.get("X-Web-Pi-Submission")).toBe("accepted");
    expect(required(h.runtime.live()[0]).snapshot().status).toMatchObject({
      model: { id: MODEL_ID },
      thinkingLevel: "off",
    });
    expect(h.calls).toHaveLength(0);
  });

  it("rejects a stale model choice outside the enabled scope instead of silently falling back", async () => {
    const control = shell();
    const { app, h } = await fixture(control.operations);
    const response = await app.request("/sessions", {
      method: "POST",
      headers: { "HX-Request": "true" },
      body: new URLSearchParams({
        cwd: h.cwd,
        text: "!!private command",
        model: `${PROVIDER}/${MODEL_ID}`,
      }),
    });
    expect(response.headers.get("X-Web-Pi-Submission")).toBeNull();
    expect(response.headers.get("HX-Trigger")).toContain(
      "not available in the enabled scope",
    );
    expect(h.runtime.live()).toHaveLength(0);
    expect(control.operations.exec).not.toHaveBeenCalled();
    expect(h.calls).toHaveLength(0);
  });

  it.each(["untouched", "model", "thinking", "both"])(
    "honours scope independently of preference writes: %s",
    async (choice) => {
      const { app, h } = await fixture();
      const original = await readFile(
        join(h.agentDir, "settings.json"),
        "utf8",
      );
      const modelWrite = vi.spyOn(
        SettingsManager.prototype,
        "setDefaultModelAndProvider",
      );
      const thinkingWrite = vi.spyOn(
        SettingsManager.prototype,
        "setDefaultThinkingLevel",
      );
      const browser = await composer(app);
      expect(
        browser.document.querySelector(".composer-model-detail")?.textContent,
      ).toBe("high");
      if (choice === "model" || choice === "both") {
        required(
          browser.document.querySelector<HTMLButtonElement>(
            '[data-model-name="Scoped model"]',
          ),
        ).click();
        await expect
          .poll(() =>
            browser.document
              .querySelector("input[name=model]")
              ?.getAttribute("value"),
          )
          .toBe(`${PROVIDER}/${MODEL_2}`);
      }
      if (choice === "thinking" || choice === "both") {
        const select = required(
          browser.document.querySelector<HTMLSelectElement>(
            ".composer-thinking-field select",
          ),
        );
        select.value = "medium";
        select.dispatchEvent(
          new browser.window.Event("change", { bubbles: true }),
        );
      }
      const area = required(browser.document.querySelector("textarea"));
      area.value = "/name offline startup";
      area.dispatchEvent(new browser.window.Event("input", { bubbles: true }));
      required(
        browser.document.querySelector<HTMLButtonElement>(
          ".composer-action-primary",
        ),
      ).click();
      await expect
        .poll(
          () =>
            browser.document
              .querySelector("main")
              ?.getAttribute("data-session-id") ?? "",
        )
        .not.toBe("");
      const live = required(h.runtime.live()[0]);
      expect(live.snapshot().status.model).toMatchObject({
        provider: PROVIDER,
        id: MODEL_2,
      });
      expect(live.snapshot().status.thinkingLevel).toBe(
        choice === "thinking" || choice === "both" ? "medium" : "high",
      );
      expect(modelWrite).toHaveBeenCalledTimes(
        choice === "model" || choice === "both" ? 1 : 0,
      );
      expect(thinkingWrite).toHaveBeenCalledTimes(
        choice === "thinking" || choice === "both" ? 1 : 0,
      );
      const settings: unknown = JSON.parse(
        await readFile(join(h.agentDir, "settings.json"), "utf8"),
      );
      expect(settings).toMatchObject({
        defaultModel:
          choice === "model" || choice === "both" ? MODEL_2 : MODEL_ID,
        defaultThinkingLevel:
          choice === "thinking" || choice === "both" ? "medium" : "low",
      });
      if (choice === "untouched")
        expect(await readFile(join(h.agentDir, "settings.json"), "utf8")).toBe(
          original,
        );
      expect(h.calls).toHaveLength(0);
    },
  );
});

describe("production shell admission and persistence", () => {
  it("owns pending shell completion through session disposal", async () => {
    const control = shell();
    const { h } = await fixture(control.operations);
    const live = await h.open();
    await live.runBash("pending at disposal", true);
    await live.stop();
    expect(control.aborted).toBe(true);
    expect(h.runtime.get(live.id)).toBeUndefined();
    const stored = SessionManager.open(
      required(live.snapshot().summary.filePath),
    );
    expect(stored.getEntries().at(-1)).toMatchObject({
      type: "message",
      message: {
        role: "bashExecution",
        cancelled: true,
        excludeFromContext: true,
      },
    });
  });

  it("rejects shell admission while a prompt is still in preflight", async () => {
    const control = shell();
    const { h } = await fixture(control.operations);
    const live = await h.open();
    const done = next(live, "turn_done");
    const prompt = live.prompt("offline prompt");
    await expect(live.runBash("must not execute", false)).rejects.toThrow(
      "busy",
    );
    expect(control.operations.exec).not.toHaveBeenCalled();
    await prompt;
    await done;
  });

  it("observes a persistence failure before publishing settlement", async () => {
    const control = shell();
    const { h } = await fixture(control.operations);
    const live = await h.open();
    await live.runBash("output cannot be saved", false);
    await rm(dirname(required(live.snapshot().summary.filePath)), {
      recursive: true,
    });
    const done = next(live, "turn_done");
    control.finish.resolve({ exitCode: 0 });
    await done;
    expect(live.snapshot().status.bashRunning).toBe(false);
    expect(live.snapshot().status.notices).toContainEqual({
      level: "error",
      message: expect.stringContaining("Could not save shell result") as string,
    });
  });

  it.each([false, true])(
    "saves shell-only history before turn_done and reopens it (excluded: %s)",
    async (excluded) => {
      const control = shell();
      control.finish.resolve({ exitCode: 0 });
      const { h } = await fixture(control.operations);
      const live = await h.open();
      const file = required(live.snapshot().summary.filePath);
      let savedAtSettlement = false;
      live.subscribe((event) => {
        if (event.type === "turn_done") savedAtSettlement = existsSync(file);
      });
      for (const command of ["first command", "second command"]) {
        const done = next(live, "turn_done");
        await live.runBash(command, excluded);
        await done;
      }
      expect(savedAtSettlement).toBe(true);
      const entries = SessionManager.open(file).getEntries();
      const commands = entries.flatMap((entry) =>
        entry.type === "message" ? [entry.message] : [],
      );
      expect(commands).toEqual(
        ["first command", "second command"].map(
          (command) =>
            expect.objectContaining({
              role: "bashExecution",
              command,
              output: "shell output\n",
              excludeFromContext: excluded,
            }) as unknown,
        ),
      );
      await live.stop();
      // A stored conversation restores its own model/level, not today's scope.
      await writeFile(
        join(h.cwd, ".pi", "settings.json"),
        JSON.stringify({ enabledModels: [`${PROVIDER}/${MODEL_ID}:off`] }),
      );
      const reopened = await h.open({ sessionId: live.id });
      expect(reopened.snapshot().branch).toEqual(entries);
      expect(reopened.snapshot().status.model?.id).toBe(MODEL_2);
      expect(reopened.snapshot().status.thinkingLevel).toBe("high");
      expect(h.calls).toHaveLength(0);
    },
  );

  it("returns the new session while bash is pending and its Stop reaches that shell", async () => {
    const control = shell();
    const { app, h } = await fixture(control.operations);
    const request = post(app, h.cwd, "!!long command");
    try {
      await expect
        .poll(() => control.operations.exec.mock.calls.length)
        .toBe(1);
      const response = await Promise.race([
        request,
        pause(100).then(() => null),
      ]);
      expect(
        response,
        "response must not wait for shell completion",
      ).not.toBeNull();
      const live = required(h.runtime.live()[0]);
      expect(
        JSON.parse(required(response).headers.get("HX-Location") ?? "{}"),
      ).toMatchObject({
        path: `/sessions/${live.id}`,
        target: "#session-region",
      });
      expect(required(response).headers.get("HX-Trigger")).toContain(live.id);
      expect(required(response).headers.get("X-Web-Pi-Submission")).toBe(
        "accepted",
      );
      expect(live.snapshot().status.bashRunning).toBe(true);
      const browser = await composer(app, live.id);
      const button = required(
        browser.document.querySelector<HTMLButtonElement>(
          ".composer-action-primary",
        ),
      );
      expect(button.dataset["action"]).toBe("stop");
      const draft = required(browser.document.querySelector("textarea"));
      draft.value = "a later request";
      draft.dispatchEvent(new browser.window.Event("input", { bubbles: true }));
      expect(button.dataset["action"]).toBe("stop");
      const done = next(live, "turn_done");
      button.click();
      await done;
      expect(control.aborted).toBe(true);
      expect(
        browser.requests.some(
          (sent) => new URL(sent.url).pathname === `/sessions/${live.id}/abort`,
        ),
      ).toBe(true);
      const entries = SessionManager.open(
        required(live.snapshot().summary.filePath),
      ).getEntries();
      expect(entries.at(-1)).toMatchObject({
        type: "message",
        message: {
          role: "bashExecution",
          cancelled: true,
          excludeFromContext: true,
        },
      });
      expect(h.calls).toHaveLength(0);
    } finally {
      control.finish.resolve({ exitCode: 0 });
      await request;
    }
  });

  it("rejects a second shell before admission and reports a later executor failure", async () => {
    const control = shell();
    const { app, h } = await fixture(control.operations);
    const request = post(app, h.cwd, "!pending command");
    try {
      await expect
        .poll(() => control.operations.exec.mock.calls.length)
        .toBe(1);
      const response = await Promise.race([
        request,
        pause(100).then(() => null),
      ]);
      expect(response).not.toBeNull();
      const live = required(h.runtime.live()[0]);
      const browser = await composer(app, live.id);
      const draft = required(browser.document.querySelector("textarea"));
      draft.value = "!!second command";
      draft.dispatchEvent(new browser.window.Event("input", { bubbles: true }));
      draft.dispatchEvent(
        new browser.window.KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
        }),
      );
      await expect
        .poll(() => browser.document.querySelector("#toasts")?.textContent)
        .toContain("busy");
      expect(draft.value).toBe("!!second command");
      expect(control.operations.exec).toHaveBeenCalledTimes(1);
      const done = next(live, "turn_done");
      control.finish.reject(new Error("executor disconnected"));
      await done;
      expect(live.snapshot().status.bashRunning).toBe(false);
      expect(live.snapshot().status.notices).toContainEqual({
        level: "error",
        message: expect.stringContaining("executor disconnected") as string,
      });
      const stream = await app.request(`/sessions/${live.id}/events`);
      const reader = required(stream.body).getReader();
      let received = "";
      while (!received.includes("executor disconnected")) {
        const chunk = await reader.read();
        if (chunk.done) break;
        received += new TextDecoder().decode(chunk.value);
      }
      await reader.cancel();
      expect(received).toContain('hx-target="#toasts"');
      expect(received).toContain("executor disconnected");
      expect(h.calls).toHaveLength(0);
    } finally {
      control.finish.resolve({ exitCode: 0 });
      await request;
    }
  });
});
