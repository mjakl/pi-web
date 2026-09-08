import assert from "node:assert/strict";
import test, { after } from "node:test";
import { Window } from "happy-dom";
import { createJiti } from "jiti";

process.env.NODE_ENV = "test";
const window = new Window({ url: "http://localhost" });
Object.assign(globalThis, {
  window,
  document: window.document,
  ResizeObserver: window.ResizeObserver,
  IS_REACT_ACT_ENVIRONMENT: true,
});
after(() => window.happyDOM.close());

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const {
  BranchNavigator,
  buildActivePath,
  compressChain,
  hasSessionBranches,
  selectTopLevelBranches,
} = await jiti.import("./BranchNavigator.tsx");

// Client fixtures contain only the navigation response contract, never bodies.
const node = (id, children = [], type = "message", branchPreview) => ({
  entry: { id, type },
  children,
  ...(branchPreview ? { branchPreview } : {}),
});

test("compressChain labels a chain by its first preview but selects the last entry", () => {
  const chain = node(
    "u1",
    [node("a1", [], "message", { role: "assistant", text: "Answer" })],
    "message",
    { role: "user", text: "Question" },
  );
  const { branchPreview, node: rep } = compressChain(chain);
  assert.deepEqual(branchPreview, { role: "user", text: "Question" });
  assert.equal(rep.entry.id, "a1");
});

test("compressChain skips non-message entries such as session_info", () => {
  const chain = node(
    "s1",
    [node("u1", [node("a1")], "message", { role: "user", text: "Question" })],
    "session_info",
  );
  const { branchPreview, node: rep, skipped } = compressChain(chain);
  assert.deepEqual(branchPreview, { role: "user", text: "Question" });
  assert.equal(rep.entry.id, "a1");
  assert.equal(skipped, 2);
});

test("compressChain counts server-contracted IDs without selecting the preview source", () => {
  const representative = {
    ...node("a1", [], "message", { role: "user", text: "Question" }),
    compressedEntryIds: ["u1"],
  };
  const chain = node("s1", [representative], "session_info");
  const { branchPreview, node: rep, skipped } = compressChain(chain);
  assert.deepEqual(branchPreview, { role: "user", text: "Question" });
  assert.equal(rep.entry.id, "a1");
  assert.equal(skipped, 2);
});

test("compressChain falls back to the chain end when no preview exists", () => {
  const chain = node("s1", [node("s2", [], "session_info")], "model_change");
  const { branchPreview, node: rep } = compressChain(chain);
  assert.equal(branchPreview, undefined);
  assert.equal(rep.entry.type, "session_info");
  assert.equal(rep.entry.id, "s2");
});

test("selectTopLevelBranches returns all roots for multi-root trees", () => {
  assert.deepEqual(
    selectTopLevelBranches([node("u1"), node("u1b")]).map((n) => n.entry.id),
    ["u1", "u1b"],
  );
});

test("selectTopLevelBranches returns children of the first branching node", () => {
  const root = node("u1", [node("a1", [node("u2"), node("u2b")])]);
  assert.deepEqual(
    selectTopLevelBranches([root]).map((n) => n.entry.id),
    ["u2", "u2b"],
  );
});

test("selectTopLevelBranches returns empty for empty or linear sessions", () => {
  assert.deepEqual(selectTopLevelBranches([]), []);
  assert.deepEqual(selectTopLevelBranches([node("u1", [node("a1")])]), []);
});

test("selectTopLevelBranches works on preview-only server projections", () => {
  const arm1 = {
    ...node("a2", [], "message", { role: "user", text: "Branch one" }),
    compressedEntryIds: ["s1", "u2"],
  };
  const arm2 = {
    ...node("a2b", [], "message", { role: "user", text: "Branch two" }),
    compressedEntryIds: ["u2b"],
  };
  const tree = [node("u1", [node("a1", [arm1, arm2])])];
  const topLevel = selectTopLevelBranches(tree);
  assert.deepEqual(
    topLevel.map((n) => n.entry.id),
    ["a2", "a2b"],
  );
  assert.deepEqual(compressChain(topLevel[0]).branchPreview, {
    role: "user",
    text: "Branch one",
  });
  assert.equal(compressChain(topLevel[0]).node.entry.id, "a2");
  assert.deepEqual([...buildActivePath(tree, "u2")], ["u1", "a1", "a2"]);
  assert.deepEqual([...buildActivePath(tree, "a2b")], ["u1", "a1", "a2b"]);
  assert.deepEqual([...buildActivePath(tree, null)], []);
  assert.deepEqual([...buildActivePath(tree, "missing")], []);
});

test("navigation-only rows render previews, image labels and entry-type fallbacks", async () => {
  const React = await jiti.import("react");
  const { createRoot } = await jiti.import("react-dom/client");
  const tree = [
    {
      ...node("answer", [], "message", {
        role: "user",
        text: "Branch question",
      }),
      compressedEntryIds: ["question"],
    },
    {
      ...node("image", [], "message", { role: "user", text: "[image]" }),
      label: "Saved image",
    },
    { ...node("summary", [], "branch_summary"), label: "Saved summary" },
  ];
  assert.deepEqual([...buildActivePath(tree, "question")], ["answer"]);
  assert.deepEqual([...buildActivePath(tree, "image")], ["image"]);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let selected;
  let toggled = false;
  const props = {
    tree,
    activeLeafId: "question",
    onLeafChange: (id) => {
      selected = id;
    },
    onToggle: () => {
      toggled = true;
    },
    open: true,
    hasSession: true,
    containerRef: { current: container },
  };
  container.getBoundingClientRect = () => ({ bottom: 42, left: 8, width: 320 });
  try {
    await React.act(() =>
      root.render(React.createElement(BranchNavigator, props)),
    );
    const html = container.innerHTML;
    assert.match(html, /Branch question/);
    assert.match(html, /\[image\]/);
    assert.match(html, /branch_summary/);
    assert.doesNotMatch(html, /Saved image|Saved summary/);
    const panel = container.querySelector(".menu-panel");
    assert.equal(panel.style.position, "fixed");
    assert.equal(panel.style.top, "42px");
    assert.equal(panel.style.left, "8px");
    assert.equal(panel.style.width, "320px");
    const label = [...panel.querySelectorAll("span")].find(
      (element) => element.textContent === "Branch question",
    );
    await React.act(() => label.click());
    assert.equal(selected, "answer");
    await React.act(() => container.querySelector("button").click());
    assert.equal(toggled, true);
    assert.ok(
      container.querySelector(".menu-panel"),
      "only the parent changes open state",
    );
    await React.act(() =>
      root.render(
        React.createElement(BranchNavigator, {
          ...props,
          hideInlineButton: true,
        }),
      ),
    );
    assert.equal(container.querySelector("button").style.display, "none");
    assert.ok(container.querySelector(".menu-panel"));
    await React.act(() =>
      root.render(
        React.createElement(BranchNavigator, { ...props, open: false }),
      ),
    );
    assert.equal(container.querySelector(".menu-panel"), null);
  } finally {
    await React.act(() => root.unmount());
    container.remove();
  }
});

test("multi-root metadata chains use their user previews and assistant representatives", () => {
  const r1 = node(
    "m1",
    [
      {
        ...node("a1", [], "message", { role: "user", text: "First question" }),
        compressedEntryIds: ["u1"],
      },
    ],
    "model_change",
  );
  const r2 = node(
    "s2",
    [
      {
        ...node("a2", [], "message", { role: "user", text: "Second question" }),
        compressedEntryIds: ["u2"],
      },
    ],
    "session_info",
  );
  const topLevel = selectTopLevelBranches([r1, r2]);
  assert.deepEqual(
    topLevel.map((n) => compressChain(n).branchPreview.text),
    ["First question", "Second question"],
  );
  assert.deepEqual(
    topLevel.map((n) => compressChain(n).node.entry.id),
    ["a1", "a2"],
  );
  assert.deepEqual([...buildActivePath([r1, r2], "u2")], ["s2", "a2"]);
});

// #509: iterative consumption must survive chains deeper than V8's stack limit.
function linearTree(n) {
  let current = node(`e${n - 1}`);
  for (let i = n - 2; i >= 0; i--) current = node(`e${i}`, [current]);
  return current;
}

test("buildActivePath finds the leaf on a 6000-deep linear chain without a stack overflow", () => {
  const path = buildActivePath([linearTree(6000)], "e5999");
  assert.equal(path.size, 6000);
  assert.ok(path.has("e0"));
  assert.ok(path.has("e5999"));
});

test("hasSessionBranches distinguishes empty, deep linear, branching and multi-root trees", () => {
  assert.equal(hasSessionBranches([]), false);
  assert.equal(hasSessionBranches([linearTree(5000)]), false);
  const root = linearTree(3);
  root.children[0].children[0].children = [node("b1"), node("b2")];
  assert.equal(hasSessionBranches([root]), true);
  assert.equal(hasSessionBranches([node("r1"), node("r2")]), true);
});
