import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { buildConversationRail, hasSessionBranches } = await jiti.import(
  "./conversation-rail.ts",
);
const { projectTreeForResponse, MAX_PROJECTED_TREE_DEPTH } =
  await jiti.import("./project-tree.ts");
const node = (id, children = [], role = "assistant") => ({
  entry: { id, type: "message", message: { role, content: "Same preview" } },
  children,
});

test("the rail detects branching without recursive traversal of long sessions", () => {
  assert.equal(hasSessionBranches([]), false);
  let root = node("leaf");
  for (let i = 0; i < 6000; i++) root = node(`entry-${i}`, [root]);
  assert.equal(hasSessionBranches([root]), false);
  assert.equal(hasSessionBranches([root, node("other-root")]), true);
  assert.equal(hasSessionBranches([node("fork", [root, node("other")])]), true);
});

test("forks retain exact positions between turn anchors, including tool entries and stars", () => {
  const tree = projectTreeForResponse([
    node(
      "u1",
      [
        node("tool", [
          node("star", [node("u2", [node("end")], "user")]),
          node("other-u", [node("other-end")], "user"),
        ]),
      ],
      "user",
    ),
  ]);
  const graph = buildConversationRail(tree, "end", ["u1", "star", "u2"]);
  const byId = new Map(graph.map((n) => [n.id, n]));
  assert.equal(byId.get("tool").parentId, "u1");
  assert.equal(byId.get("star").parentId, "tool");
  assert.equal(byId.get("u2").parentId, "star");
  assert.equal(byId.get("other-end").parentId, "tool");
  assert.equal(byId.get("other-end").active, false);
  assert.equal(byId.get("other-end").preview, "Same preview");
  assert.equal(byId.get("other-end").lane, 1);
  assert.equal(byId.get("star").row, byId.get("other-end").row);
  for (const id of ["u1", "star", "u2"]) {
    assert.equal(byId.get(id).anchor, true);
    assert.equal(byId.get(id).active, true);
    assert.equal(byId.get(id).lane, 0);
  }
});

test("selecting an interior entry does not mark its continuation active; live anchors extend only that path", () => {
  const tree = projectTreeForResponse([
    node("root", [node("u", [node("end")]), node("other")]),
  ]);
  const graph = buildConversationRail(tree, "u", ["root", "u", "live:0"]);
  const byId = new Map(graph.map((n) => [n.id, n]));
  assert.equal(byId.get("end").active, false);
  assert.equal(byId.get("end").parentId, "u");
  assert.equal(byId.get("live:0").parentId, "u");
  assert.equal(byId.get("live:0").active, true);
  assert.equal(byId.get("live:0").lane, 0);
  assert.notEqual(byId.get("end").lane, 0);
});

test("root alternatives and nested forks remain separate connected paths", () => {
  const tree = projectTreeForResponse([
    node("first-root", [node("a"), node("b", [node("b1"), node("b2")])]),
    node("active-root", [node("current")]),
  ]);
  const graph = buildConversationRail(tree, "current", ["active-root"]);
  const byId = new Map(graph.map((n) => [n.id, n]));
  assert.equal(byId.get("active-root").lane, 0);
  assert.equal(byId.get("first-root").parentId, null);
  assert.equal(byId.get("b1").parentId, "b");
  assert.equal(byId.get("b2").parentId, "b");
  assert.notEqual(byId.get("b1").lane, byId.get("b2").lane);
});

test("depth-limited responses preserve real parentage rather than drawing flattened siblings as forks", () => {
  let source = node("end");
  for (let i = MAX_PROJECTED_TREE_DEPTH + 3; i >= 0; i--) {
    source = node(`fork-${i}`, [source, node(`side-${i}`)]);
  }
  const graph = buildConversationRail(projectTreeForResponse([source]), "end", [
    "fork-0",
  ]);
  const byId = new Map(graph.map((n) => [n.id, n]));
  assert.equal(
    byId.get("end").parentId,
    `fork-${MAX_PROJECTED_TREE_DEPTH + 3}`,
  );
  assert.equal(
    byId.get(`side-${MAX_PROJECTED_TREE_DEPTH + 2}`).parentId,
    `fork-${MAX_PROJECTED_TREE_DEPTH + 2}`,
  );
  assert.equal(byId.get("end").lane, 0);
  assert.equal(byId.get("end").active, true);
});
