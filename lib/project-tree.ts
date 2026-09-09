import { isRecord } from "./types";
import type { BranchPreview, SessionTreeNode } from "@/lib/types";

// Bound JSON response nesting; parentId preserves the graph beyond this depth.
export const MAX_PROJECTED_TREE_DEPTH = 200;
const MAX_BRANCH_PREVIEW_LENGTH = 40;

type ProjectableEntry = {
  id: string;
  type: string;
  message?: unknown;
};

type ProjectableTreeNode<T> = {
  entry: ProjectableEntry;
  children: T[];
  label?: string;
};

function isHumanMessage(entry: ProjectableEntry): boolean {
  return (
    entry.type === "message" &&
    isRecord(entry.message) &&
    entry.message["role"] === "user"
  );
}

function appendPreviewText(current: string, value: unknown): string {
  if (typeof value !== "string" || current.length > MAX_BRANCH_PREVIEW_LENGTH)
    return current;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return current;
  const separator = current ? " " : "";
  const prefix = current + separator;
  if (prefix.length >= MAX_BRANCH_PREVIEW_LENGTH + 1) {
    return prefix.slice(0, MAX_BRANCH_PREVIEW_LENGTH + 1);
  }
  const remaining = MAX_BRANCH_PREVIEW_LENGTH + 1 - prefix.length;
  return prefix + normalized.slice(0, remaining);
}

function previewForEntry(entry: ProjectableEntry): BranchPreview | undefined {
  if (
    entry.type !== "message" ||
    !isRecord(entry.message) ||
    typeof entry.message["role"] !== "string"
  ) {
    return undefined;
  }

  const content = entry.message["content"];
  let text = "";
  let hasImage = false;
  if (typeof content === "string") {
    text = appendPreviewText(text, content);
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (!isRecord(block)) continue;
      if (block["type"] === "image") hasImage = true;
      if (block["type"] === "text")
        text = appendPreviewText(text, block["text"]);
      if (text.length > MAX_BRANCH_PREVIEW_LENGTH) break;
    }
  }

  if (text.length > MAX_BRANCH_PREVIEW_LENGTH) {
    text = text.slice(0, MAX_BRANCH_PREVIEW_LENGTH) + "…";
  } else if (!text) {
    text = hasImage
      ? "[image]"
      : entry.message["role"] === "assistant"
        ? "[assistant]"
        : "message";
  }

  const role =
    entry.message["role"] === "user" || entry.message["role"] === "assistant"
      ? entry.message["role"]
      : undefined;
  return { ...(role ? { role } : {}), text };
}

/**
 * Project the session tree into the shallow navigation tree sent to the client.
 * Keeps human messages, roots, branch points, and leaves while contracting other
 * single-child chains
 * without recursive traversal. Contracted entry IDs are attached to the next
 * visible node so the UI can still recognize an active leaf inside the chain.
 */
export function projectTreeForResponse<T extends ProjectableTreeNode<T>>(
  nodes: T[],
): SessionTreeNode[] {
  const keep = new Set<T>();
  const roots = new Set(nodes);
  const seen = new Set<T>();
  const stack = [...nodes];

  for (let node = stack.pop(); node; node = stack.pop()) {
    if (seen.has(node)) continue;
    seen.add(node);

    if (
      roots.has(node) ||
      node.children.length !== 1 ||
      isHumanMessage(node.entry)
    ) {
      keep.add(node);
    }

    for (const child of node.children) {
      stack.push(child);
    }
  }

  const cloneNode = (
    node: T,
    compressedEntryIds?: string[],
    branchPreview?: BranchPreview,
    parentId: string | null = null,
  ): SessionTreeNode => {
    const preview = isHumanMessage(node.entry)
      ? previewForEntry(node.entry)
      : branchPreview;
    return {
      parentId,
      entry: { id: node.entry.id, type: node.entry.type },
      children: [],
      ...(node.label !== undefined ? { label: node.label } : {}),
      ...(compressedEntryIds?.length ? { compressedEntryIds } : {}),
      ...(preview ? { branchPreview: preview } : {}),
    };
  };
  const tasks = nodes.map((source) => ({
    source,
    projected: cloneNode(source, undefined, previewForEntry(source.entry)),
    depth: 1,
  }));
  const projectedRoots = tasks.map(({ projected }) => projected);

  const appendFlattenedKeptDescendants = (
    source: T,
    projectedParent: SessionTreeNode,
  ) => {
    const pending = [
      {
        node: source,
        compressedEntryIds: [] as string[],
        branchPreview: undefined as BranchPreview | undefined,
        parentId: projectedParent.entry.id,
      },
    ];
    const flattenedSeen = new Set<T>();

    for (let item = pending.pop(); item; item = pending.pop()) {
      const { node, compressedEntryIds, branchPreview, parentId } = item;
      if (flattenedSeen.has(node)) continue;
      flattenedSeen.add(node);
      const nextPreview = branchPreview ?? previewForEntry(node.entry);

      if (keep.has(node)) {
        projectedParent.children.push(
          cloneNode(node, compressedEntryIds, nextPreview, parentId),
        );
      }

      for (const child of node.children.toReversed()) {
        pending.push({
          node: child,
          compressedEntryIds: keep.has(node)
            ? []
            : [...compressedEntryIds, node.entry.id],
          branchPreview: keep.has(node) ? undefined : nextPreview,
          parentId: keep.has(node) ? node.entry.id : parentId,
        });
      }
    }
  };

  for (let task = tasks.pop(); task; task = tasks.pop()) {
    const { source, projected, depth } = task;

    for (const sourceChild of source.children) {
      let child = sourceChild;

      if (depth >= MAX_PROJECTED_TREE_DEPTH) {
        appendFlattenedKeptDescendants(child, projected);
        continue;
      }

      const compressedEntryIds: string[] = [];
      let branchPreview = previewForEntry(child.entry);
      let [onlyChild] = child.children;
      while (!keep.has(child) && child.children.length === 1 && onlyChild) {
        compressedEntryIds.push(child.entry.id);
        child = onlyChild;
        [onlyChild] = child.children;
        branchPreview ??= previewForEntry(child.entry);
      }

      if (!keep.has(child)) {
        continue;
      }

      const projectedChild = cloneNode(
        child,
        compressedEntryIds,
        branchPreview,
        projected.entry.id,
      );
      projected.children.push(projectedChild);
      tasks.push({
        source: child,
        projected: projectedChild,
        depth: depth + 1,
      });
    }
  }

  return projectedRoots;
}
