import type { SessionTreeNode } from "./types";

export interface ConversationRailNode {
  id: string;
  parentId: string | null;
  /** Complete path to select when navigating to this marker. */
  targetLeafId: string;
  /** Exact rendered prompt or saved answer; structural nodes select the path only. */
  scrollEntryId?: string;
  active: boolean;
  anchor: boolean;
  preview?: string;
  lane: number;
  row: number;
}

/** The rail stays narrow for linear conversations. Walk iteratively because
 * session history can contain thousands of entries. */
export function hasSessionBranches(nodes: SessionTreeNode[]): boolean {
  const parents = new Set<string | null>();
  const pending = nodes.map((node) => ({
    node,
    parentId: null as string | null,
  }));
  for (let item = pending.pop(); item; item = pending.pop()) {
    const { node } = item;
    const parentId =
      node.parentId !== undefined ? node.parentId : item.parentId;
    if (parents.has(parentId)) return true;
    parents.add(parentId);
    pending.push(
      ...node.children.map((child) => ({
        node: child,
        parentId: node.entry.id,
      })),
    );
  }
  return false;
}

/** Expand transcript anchors and session-wide stars within contracted paths.
 * IDs, not message text or turn counts, locate each fork. Rows measure visible
 * steps from the root; siblings share a row without moving their fork. */
export function buildConversationRail(
  tree: SessionTreeNode[],
  activeLeafId: string | null,
  anchorIds: string[],
  starredEntryIds: string[] = [],
): ConversationRailNode[] {
  const parents = new Map<string, string | null>();
  const representatives = new Map<string, SessionTreeNode>();
  const pending = tree.toReversed().map((node) => ({
    node,
    parentId: null as string | null,
  }));
  for (let item = pending.pop(); item; item = pending.pop()) {
    const { node } = item;
    let parentId = node.parentId !== undefined ? node.parentId : item.parentId;
    for (const id of [...(node.compressedEntryIds ?? []), node.entry.id]) {
      parents.set(id, parentId);
      parentId = id;
    }
    representatives.set(node.entry.id, node);
    for (const child of node.children.toReversed()) {
      pending.push({ node: child, parentId: node.entry.id });
    }
  }
  const active = new Set<string>();
  let current =
    activeLeafId && parents.has(activeLeafId)
      ? activeLeafId
      : (anchorIds.findLast((id) => parents.has(id)) ?? null);
  while (current !== null && !active.has(current)) {
    active.add(current);
    current = parents.get(current) ?? null;
  }
  const anchors = new Set(anchorIds);
  const stars = new Set(starredEntryIds);
  const kept = new Set([
    ...representatives.keys(),
    ...[...anchorIds, ...starredEntryIds].filter((id) => parents.has(id)),
  ]);
  if (activeLeafId && parents.has(activeLeafId)) kept.add(activeLeafId);
  const nodes = new Map<string, ConversationRailNode>();
  for (const id of kept) {
    let parentId = parents.get(id) ?? null;
    while (parentId !== null && !kept.has(parentId))
      parentId = parents.get(parentId) ?? null;
    nodes.set(id, {
      id,
      parentId,
      targetLeafId: id,
      scrollEntryId:
        stars.has(id) ||
        (representatives.get(id)?.entry.type === "message" &&
          representatives.get(id)?.branchPreview?.role === "user")
          ? id
          : undefined,
      active: active.has(id),
      anchor: anchors.has(id),
      preview: representatives.get(id)?.branchPreview?.text,
      lane: 0,
      row: 0,
    });
  }
  // The persisted tree can lag a live turn. Extend the current path with those
  // anchors without inventing a relationship to any inactive branch.
  let tail =
    activeLeafId && nodes.has(activeLeafId)
      ? activeLeafId
      : (anchorIds.findLast((id) => nodes.get(id)?.active) ?? null);
  for (const id of anchorIds) {
    if (nodes.has(id)) continue;
    nodes.set(id, {
      id,
      parentId: tail,
      targetLeafId: id,
      active: true,
      anchor: true,
      lane: 0,
      row: 0,
    });
    tail = id;
  }
  const children = new Map<string | null, ConversationRailNode[]>();
  for (const node of nodes.values()) {
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }
  for (const siblings of children.values())
    siblings.sort((a, b) => Number(b.active) - Number(a.active));
  let nextLane = 0;
  const tasks = (children.get(null) ?? [])
    .map((node) => ({ node, lane: nextLane++, row: 0 }))
    .reverse();
  const result: ConversationRailNode[] = [];
  for (let task = tasks.pop(); task; task = tasks.pop()) {
    const { node, lane, row } = task;
    node.lane = lane;
    node.row = row;
    result.push(node);
    const descendants = children.get(node.id) ?? [];
    const next = descendants.map((child, index) => ({
      node: child,
      lane: index === 0 ? lane : nextLane++,
      row: row + 1,
    }));
    tasks.push(...next.reverse());
  }
  const leaves = new Map<number, string>();
  for (const node of result.toReversed()) {
    node.targetLeafId = leaves.get(node.lane) ?? node.id;
    leaves.set(node.lane, node.targetLeafId);
  }
  return result;
}
