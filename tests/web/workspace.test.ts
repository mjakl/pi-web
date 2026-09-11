import {
  assistantEntry,
  createFakeWorld,
  FAKE_MODEL,
  userEntry,
} from "@adapters/fake/index";
import { createWorkspace } from "@core/workspace";
import { createWebApp } from "@web/app";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// The picker, trust, read-only mode and the settings pages, against the fake
// world. Folders that have to exist are real temporary ones; nothing here
// reads or writes Pi's own agent directory.

let root: string;
let repo: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "web-pi-web-"));
  repo = join(root, "repo");
  await mkdir(join(repo, "src"), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function testApp(options: Parameters<typeof createFakeWorld>[0] = {}) {
  const world = createFakeWorld({
    delayMs: 2,
    sessions: [
      {
        summary: {
          id: "s1",
          cwd: repo,
          name: "Live one",
          createdAt: "2026-09-01T00:00:00.000Z",
          modifiedAt: "2026-09-02T00:00:00.000Z",
          fileSize: 10,
        },
        entries: [
          userEntry("u1", null, "a question"),
          assistantEntry("a1", "u1", "an answer", 100),
        ],
      },
    ],
    ...options,
  });
  const app = createWebApp({
    workspace: createWorkspace(world),
    staticRoot: "/nonexistent",
    defaultCwd: repo,
    home: root,
    about: { webPi: "9.9.9", pi: "8.8.8" },
    renderIntervalMs: 1,
  });
  return { app, world };
}

const form = (fields: Record<string, string>) => {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return { method: "POST", body };
};

describe("the folder picker", () => {
  it("opens as a modal dialog with the known projects and a browse pane", async () => {
    const { app } = testApp();
    const html = await (await app.request("/workspaces/picker")).text();
    expect(html).toContain('id="workspace-picker"');
    expect(html).toContain("data-modal");
    expect(html).toContain('id="browse-pane"');
    expect(html).toContain("/workspaces/folders?cwd=");
  });

  it("lists a project's worktrees and marks the folder in use", async () => {
    const { app } = testApp({
      worktrees: (cwd) => [
        { path: cwd, branch: "main" },
        { path: `${cwd}/wt`, branch: "feature" },
      ],
    });
    const html = await (
      await app.request(`/workspaces/folders?cwd=${encodeURIComponent(repo)}`)
    ).text();
    expect(html).toContain("feature");
    expect(html).toContain('aria-current="true"');
    expect(html).toContain("repo · main");
  });

  it("refuses to probe a folder outside every allowed root", async () => {
    const { app } = testApp();
    // Probing runs git in the folder the query names; pi-web gates it the
    // same way, through the allowed roots.
    const denied = await app.request("/workspaces/folders?cwd=/etc");
    expect(denied.status).toBe(403);
  });

  it("still answers for a project whose folder is gone", async () => {
    const { app } = testApp({ missingFolders: [repo], worktrees: () => [] });
    await rm(repo, { recursive: true, force: true });
    const html = await (
      await app.request(`/workspaces/folders?cwd=${encodeURIComponent(repo)}`)
    ).text();
    expect(html).toContain("No working folders available");
  });

  it("adds a listed worktree to the roots a file may be read from", async () => {
    const { app } = testApp({
      worktrees: (cwd) => [
        { path: cwd, branch: "main" },
        { path: join(root, "wt"), branch: "feature" },
      ],
    });
    await mkdir(join(root, "wt"), { recursive: true });
    await writeFile(join(root, "wt", "note.txt"), "hello\n");
    const before = await app.request(
      `/files/view?path=${encodeURIComponent(join(root, "wt", "note.txt"))}`,
    );
    expect(before.status).toBe(403);

    await app.request(`/workspaces/folders?cwd=${encodeURIComponent(repo)}`);
    const after = await app.request(
      `/files/view?path=${encodeURIComponent(join(root, "wt", "note.txt"))}`,
    );
    expect(after.status).toBe(200);
  });

  it("says so when a project has no folder left to offer", async () => {
    const { app } = testApp({
      worktrees: () => [],
      missingFolders: [repo],
    });
    const html = await (
      await app.request(`/workspaces/folders?cwd=${encodeURIComponent(repo)}`)
    ).text();
    expect(html).toContain("No working folders available");
  });

  it("browses directory names only, hidden ones included", async () => {
    await mkdir(join(repo, ".hidden"));
    const { app } = testApp();
    const html = await (
      await app.request(`/workspaces/browse?path=${encodeURIComponent(repo)}`)
    ).text();
    expect(html).toContain(".hidden");
    expect(html).toContain("src");
    expect(html).toContain("Use this folder");
  });

  it("shows the error inside the pane and falls back to the home listing", async () => {
    const { app } = testApp();
    const html = await (
      await app.request("/workspaces/browse?path=/definitely/not/here")
    ).text();
    expect(html).toContain("Directory does not exist");
    expect(html).toContain('role="alert"');
  });

  it("remembers the chosen folder and its project in cookies", async () => {
    const { app } = testApp();
    const res = await app.request("/workspaces/validate", {
      ...form({ cwd: repo }),
      headers: { "HX-Request": "true" },
    });
    expect(res.headers.get("HX-Redirect")).toBe("/new");
    const cookies = res.headers.getSetCookie().join(" ");
    expect(cookies).toContain(`web-pi-cwd=${encodeURIComponent(repo)}`);
    expect(cookies).toContain("web-pi-project=");
  });

  it("reports a folder it cannot use as a toast, not a broken page", async () => {
    const { app } = testApp();
    const res = await app.request("/workspaces/validate", {
      ...form({ cwd: "/definitely/not/here" }),
      headers: { "HX-Request": "true" },
    });
    expect(res.headers.get("HX-Trigger")).toContain("Folder not found");
    expect(res.headers.get("HX-Reswap")).toBe("none");
  });
});

describe("the new-session page", () => {
  it("offers completion, the slash menu and a model picker for a real folder", async () => {
    const { app } = testApp();
    const html = await (await app.request(`/new?cwd=${repo}`)).text();
    expect(html).toContain('data-complete="folder"');
    expect(html).toContain('name="model"');
    expect(html).toContain(FAKE_MODEL.name);
    expect(html).toContain('name="thinking"');
    // The folder is changed from the sidebar's workspace pill now.
    expect(html).toContain('class="anchor-sidebar-project"');
  });

  it("answers the folder's slash menu and file completion", async () => {
    const { app } = testApp();
    // Validation is what makes the folder reachable.
    await app.request("/workspaces/validate", form({ cwd: repo }));
    const menu = await (
      await app.request(
        `/workspaces/commands?cwd=${encodeURIComponent(repo)}&q=`,
      )
    ).text();
    expect(menu).toContain("changelog");
    const files = await app.request(
      `/workspaces/file-index?cwd=${encodeURIComponent(repo)}&q=`,
    );
    expect(await files.json()).toMatchObject({ truncated: false });
  });

  it("refuses to list a folder nobody validated", async () => {
    const { app } = testApp();
    const res = await app.request(
      `/workspaces/file-index?cwd=${encodeURIComponent(root)}&q=`,
    );
    expect(res.status).toBe(403);
  });

  it("starts the session on the picked model and reasoning level", async () => {
    const { app, world } = testApp();
    const body = new FormData();
    body.set("cwd", repo);
    body.set("text", "hello");
    body.set("model", `${FAKE_MODEL.provider}/${FAKE_MODEL.id}`);
    body.set("thinking", "high");
    const res = await app.request("/sessions", { method: "POST", body });
    expect(res.status).toBe(303);
    const started = [...world.store.values()].find((session) =>
      session.summary.id.startsWith("new-"),
    );
    expect(started?.summary.cwd).toBe(repo);
  });

  it("will not start a session in a folder that is gone", async () => {
    const { app } = testApp({ missingFolders: [repo] });
    const body = new FormData();
    body.set("cwd", repo);
    body.set("text", "hello");
    const res = await app.request("/sessions", {
      method: "POST",
      body,
      headers: { "HX-Request": "true" },
    });
    expect(res.headers.get("HX-Trigger")).toContain(
      "Working folder is unavailable",
    );
  });
});

describe("missing-folder read-only mode", () => {
  it("shows the notice and drops the composer, explorer and branch actions", async () => {
    const { app } = testApp({ missingFolders: [repo] });
    const html = await (await app.request("/sessions/s1")).text();
    expect(html).toContain(
      "Working folder is unavailable. This session is read-only.",
    );
    expect(html).not.toContain('id="composer"');
    expect(html).not.toContain('id="file-panel-toggle"');
    // Reading, stats and export stay.
    expect(html).toContain("Full history");
    expect(html).toContain("an answer");
  });

  it("refuses every mutating route with the same message", async () => {
    const { app } = testApp({ missingFolders: [repo] });
    for (const path of [
      "/sessions/s1/prompt",
      "/sessions/s1/compact",
      "/sessions/s1/activate",
      "/sessions/s1/clone",
    ]) {
      const res = await app.request(path, {
        ...form({ text: "x" }),
        headers: { "HX-Request": "true" },
      });
      expect(res.headers.get("HX-Trigger")).toContain(
        "Working folder is unavailable",
      );
    }
  });

  it("still lets a reader stop the session and read its statistics", async () => {
    const { app } = testApp({ missingFolders: [repo] });
    expect((await app.request("/sessions/s1/stats")).status).toBe(200);
    expect(
      (await app.request("/sessions/s1/abort", { method: "POST" })).status,
    ).toBe(204);
  });
});

describe("project trust", () => {
  it("badges an untrusted folder and offers the dialog", async () => {
    const { app } = testApp({ trustRequired: [repo] });
    const page = await (await app.request("/sessions/s1")).text();
    // pi-web puts the warning in the top bar, next to the tabs.
    expect(page).toContain("Project resources are not loaded");
    const dialog = await (
      await app.request(`/workspaces/trust?cwd=${encodeURIComponent(repo)}`)
    ).text();
    expect(dialog).toContain("Trust this project?");
    expect(dialog).toContain("Project resources can run local code.");
  });

  it("grants trust and asks the page to reload", async () => {
    const { app } = testApp({ trustRequired: [repo] });
    const res = await app.request("/workspaces/trust", {
      ...form({ cwd: repo }),
      headers: { "HX-Request": "true" },
    });
    expect(res.headers.get("HX-Refresh")).toBe("true");
    expect(await (await app.request("/sessions/s1")).text()).not.toContain(
      "Restricted mode",
    );
  });

  it("refuses a folder with nothing to trust", async () => {
    const { app } = testApp();
    const res = await app.request("/workspaces/trust", {
      ...form({ cwd: repo }),
      headers: { "HX-Request": "true" },
    });
    expect(res.headers.get("HX-Trigger")).toContain(
      "no resources that require trust",
    );
  });

  it("blocks the change while a session in that folder is working", async () => {
    const { app } = testApp({ trustRequired: [repo] });
    await app.request("/sessions/s1/prompt", form({ text: "run" }));
    const res = await app.request("/workspaces/trust", {
      ...form({ cwd: repo }),
      headers: { "HX-Request": "true" },
    });
    expect(res.headers.get("HX-Trigger")).toContain(
      "Wait for the active session to finish",
    );
  });

  it("stops the folder's sessions so they restart with project resources", async () => {
    const { app, world } = testApp({ trustRequired: [repo] });
    await app.request("/sessions/s1/activate", { method: "POST" });
    expect(world.runtime.get("s1")).toBeDefined();
    await app.request("/workspaces/trust", {
      ...form({ cwd: repo }),
      headers: { "HX-Request": "true" },
    });
    expect(world.runtime.get("s1")).toBeUndefined();
  });
});

describe("the settings page", () => {
  it("navigates on both desktop and a phone, and remembers the section", async () => {
    const { app } = testApp();
    const html = await (await app.request("/settings")).text();
    expect(html).toContain("Settings");
    // The mobile picker and the desktop tabs are the same list, one hidden.
    expect(html).toContain("settings-mobile-section-picker");
    expect(html).toContain("settings-section-tabs");
    expect(html).toContain('href="/settings?section=skills');
    const skills = await app.request("/settings?section=skills");
    expect(skills.headers.getSetCookie().join(" ")).toContain(
      "web-pi-settings=skills",
    );
    const remembered = await app.request("/settings", {
      headers: { cookie: "web-pi-settings=skills" },
    });
    expect(await remembered.text()).toContain("Add skill");
  });

  it("keeps the browser preferences on the general section", async () => {
    const { app } = testApp();
    const html = await (await app.request("/settings?section=general")).text();
    expect(html).toContain('data-theme-option="light"');
    expect(html).toContain('data-theme-option="auto"');
    expect(html).toContain('id="sound-toggle"');
    expect(html).toContain('id="dumb-zone-tokens"');
    // The About line names this build and the Pi SDK it resolved.
    expect(html).toContain("web-pi 9.9.9");
    expect(html).toContain("pi 8.8.8");
  });

  it("groups skills and shows one in detail", async () => {
    const { app } = testApp();
    const html = await (await app.request("/settings?section=skills")).text();
    expect(html).toContain("testing");
    expect(html).toContain("Manual");
    expect(html).toContain("Global · skills.sh");
    const detail = await (
      await app.request(
        `/settings/skills/detail?cwd=${encodeURIComponent(repo)}&path=${encodeURIComponent("/agent/skills/changelog/SKILL.md")}`,
      )
    ).text();
    expect(detail).toContain("Model-visible");
    expect(detail).toContain("skills.sh/acme/skills/changelog");
  });

  it("toggles a skill and answers with its new state", async () => {
    const { app } = testApp();
    const html = await (
      await app.request(
        "/settings/skills/toggle",
        form({
          cwd: repo,
          path: "/repo/one/.pi/skills/testing/SKILL.md",
          disable: "",
        }),
      )
    ).text();
    expect(html).toContain("Model-visible");
    expect(html).toContain('aria-checked="true"');
  });

  it("searches the registry and reports an install", async () => {
    const { app } = testApp();
    const results = await (
      await app.request(
        "/settings/skills/search",
        form({ cwd: repo, query: "changelog" }),
      )
    ).text();
    expect(results).toContain("acme/skills@changelog");
    expect(results).toContain("1.2K installs");
    const installed = await (
      await app.request(
        "/settings/skills/install",
        form({ cwd: repo, package: "acme/skills@changelog", scope: "global" }),
      )
    ).text();
    expect(installed).toContain("Installed acme/skills@changelog");
  });

  it("lists plugins with their status and flips one off and on", async () => {
    const { app } = testApp();
    const html = await (await app.request("/settings?section=plugins")).text();
    expect(html).toContain("npm:@acme/pi-plugin@1.2.0");
    expect(html).toContain("Global");
    expect(html).toContain("review");
    const disabled = await (
      await app.request(
        "/settings/plugins",
        form({
          cwd: repo,
          action: "disable",
          source: "npm:@acme/pi-plugin@1.2.0",
          scope: "user",
        }),
      )
    ).text();
    expect(disabled).toContain("Package disabled.");
    expect(disabled).toContain("Enable");
    const enabled = await (
      await app.request(
        "/settings/plugins",
        form({
          cwd: repo,
          action: "enable",
          source: "npm:@acme/pi-plugin@1.2.0",
          scope: "user",
        }),
      )
    ).text();
    expect(enabled).toContain("Disable");
  });

  it("refuses an action it does not know", async () => {
    const { app } = testApp();
    const res = await app.request(
      "/settings/plugins",
      form({ cwd: repo, action: "purge", scope: "user" }),
    );
    expect(res.headers.get("HX-Trigger")).toContain("Unsupported action");
  });

  it("says which resources are dormant while a project is untrusted", async () => {
    const { app } = testApp({ trustRequired: [repo] });
    const skills = await (
      await app.request(`/settings?section=skills&cwd=${repo}`)
    ).text();
    expect(skills).toContain("Project skills are not loaded");
    const plugins = await (
      await app.request(`/settings?section=plugins&cwd=${repo}`)
    ).text();
    expect(plugins).toContain("Project plugins are not loaded");
  });
});

describe("tool definitions and the system prompt", () => {
  it("says nothing has loaded while the session is stopped", async () => {
    const { app } = testApp();
    expect(await (await app.request("/sessions/s1/tools")).text()).toContain(
      "Tool definitions have not loaded yet",
    );
    expect(
      await (await app.request("/sessions/s1/system-prompt")).text(),
    ).toContain("System prompt has not loaded yet");
  });

  it("shows the active tools and the prompt of a live session", async () => {
    const { app } = testApp();
    await app.request("/sessions/s1/activate", { method: "POST" });
    const tools = await (await app.request("/sessions/s1/tools")).text();
    expect(tools).toContain("read");
    expect(tools).toContain("Absolute path of the file");
    // An inactive tool cannot be called this turn, so it is not offered.
    expect(tools).not.toContain("legacy");
    const prompt = await (
      await app.request("/sessions/s1/system-prompt")
    ).text();
    expect(prompt).toContain("You are Pi, a coding agent.");
  });
});

describe("the new-session model picker", () => {
  it("offers the model's own reasoning levels, plus auto", async () => {
    const { app } = testApp();
    const page = await (await app.request("/new")).text();
    expect(page).toContain('<option value="">auto</option>');
    // From the catalog's own list for this model, not a hard-coded one.
    expect(page).toContain("balanced");
    expect(page).not.toContain('value="xhigh"');
  });
});
