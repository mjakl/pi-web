import type { SessionTreeNode } from "./types";

export interface ConversationRailNode {
  id: string;
  parentId: string | null;
  active: boolean;
  anchor: boolean;
  preview?: string;
  lane: number;
  row: number;
}

/** Expand only the current transcript's anchors within the server's contracted
 * paths. IDs, not message text or turn counts, locate each fork. */
export function buildConversationRail(
  tree: SessionTreeNode[],
  activeLeafId: string | null,
  anchorIds: string[],
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
  const kept = new Set([
    ...representatives.keys(),
    ...anchorIds.filter((id) => parents.has(id)),
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
  return result;
}
