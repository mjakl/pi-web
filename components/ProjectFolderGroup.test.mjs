import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { createJiti } from "jiti";

const window = new Window({ url: "http://localhost" });
Object.assign(globalThis, {
  window, document: window.document, HTMLElement: window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
});
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { act } = React;
const { createRoot } = await jiti.import("react-dom/client");
const { ProjectFolderGroup } = await jiti.import("./ProjectFolderGroup.tsx");

test("groups discover external folders on expansion, select paths, and refresh on re-expansion", async (t) => {
  const originalFetch = globalThis.fetch;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  t.after(async () => { await act(() => root.unmount()); container.remove(); globalThis.fetch = originalFetch; });
  let paths = ["/repo/checkouts/one", "/elsewhere/two"];
  globalThis.fetch = async () => ({ ok: true, json: async () => ({
    projectRoot: "/repo/project.git", projectKey: "repo", isGit: true, isTopLevel: true, cwdAvailable: true,
    worktrees: paths.map(path => ({ path, branch: null })),
  }) });
  let selection;
  await act(() => root.render(React.createElement(ProjectFolderGroup, {
    project: { root: "/repo/project.git", key: "repo", cwd: paths[0] },
    selectedCwd: paths[0], selected: false, homeDir: "/home/user", activity: null,
    onSelect: (...args) => { selection = args; },
  })));
  assert.equal(container.querySelectorAll("button").length, 1);
  await act(() => container.querySelector("button").click());
  assert.equal(container.querySelectorAll(".project-folder-child").length, 2);
  assert.equal(container.querySelector('[aria-current="true"]').title, paths[0]);
  assert.equal(container.textContent.includes("Main folder"), false);
  await act(() => container.querySelectorAll(".project-folder-child")[1].click());
  assert.deepEqual(selection, ["/elsewhere/two", "/repo/project.git", "repo"]);
  await act(() => container.querySelector("button").click());
  paths = [paths[0], "/new/three"];
  await act(() => container.querySelector("button").click());
  assert.equal(container.textContent.includes("/elsewhere/two"), false);
  assert.equal(container.textContent.includes("/new/three"), true);
});

for (const folder of ["/repo/project.git", "/elsewhere/only-checkout"]) {
  test(`a single working folder is directly selectable on opening: ${folder}`, async (t) => {
    const originalFetch = globalThis.fetch;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    t.after(async () => { await act(() => root.unmount()); container.remove(); globalThis.fetch = originalFetch; });
    globalThis.fetch = async () => ({ ok: true, json: async () => ({
      projectRoot: "/repo/project.git", projectKey: "repo", isGit: true, isTopLevel: true, cwdAvailable: true,
      worktrees: [{ path: folder, branch: null }],
    }) });
    let selection;
    await act(() => root.render(React.createElement(ProjectFolderGroup, {
      project: { root: "/repo/project.git", key: "repo", cwd: folder },
      selectedCwd: "/different/project", selected: false, homeDir: "/home/user", activity: null,
      onSelect: (...args) => { selection = args; },
    })));
    const button = container.querySelector("button");
    assert.equal(button.hasAttribute("aria-expanded"), false);
    assert.equal(container.querySelectorAll("button").length, 1);
    assert.ok(container.textContent.includes(folder));
    await act(() => button.click());
    assert.deepEqual(selection, [folder, "/repo/project.git", "repo"]);
  });
}
