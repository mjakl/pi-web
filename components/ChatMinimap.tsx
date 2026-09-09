"use client";

import { useAnimationFrameCallback } from "@/hooks/useAnimationFrameCallback";

import { StarIcon } from "./StarIcon";
import { MessagePreviewPopover } from "./MessagePreviewPopover";
import { getMessagePreview } from "@/lib/message-preview";
import { useI18n } from "@/hooks/useI18n";
import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  useId,
  memo,
  type RefObject,
} from "react";
import { isMessageGroupAnchor } from "@/lib/message-display";
import type {
  AgentMessage,
  SessionContext,
  SessionTreeNode,
} from "@/lib/types";
import {
  buildConversationRail,
  hasSessionBranches,
} from "@/lib/conversation-rail";

interface Props {
  onExpandedWidthChange?: (width: number) => void;
  tree?: SessionTreeNode[];
  activeLeafId?: string | null;
  onLeafChange?: (leafId: string, entryId?: string) => void | Promise<void>;
  branchDisabled?: boolean;
  messages: AgentMessage[];
  entryIds: string[];
  historyAnchors?: SessionContext["historyAnchors"];
  starredEntryIds?: string[];
  answerRefs?: RefObject<Map<string, HTMLDivElement>>;
  onLoadThrough: (entryId: string) => Promise<boolean>;
  scrollContainer: RefObject<HTMLDivElement | null>;
  messageRefs: RefObject<(HTMLDivElement | null)[]>;
}

const MINIMAP_WIDTH = 36;
const BRANCH_LANE_GAP = 36;
// Clear the square's full size, including its hover enlargement.
const GRAPH_NODE_CLEARANCE = 5;
const MAX_NODE_GAP = 50;
const MINIMAP_PADDING = 12;
const NAVIGATION_ACTIVE_LOCK_MS = 1600;
// Reserved at the foot of the rail so the dots clear the jump-to-latest
// control that floats over it.
const MINIMAP_FOOTER = 30;

interface NodeInfo {
  id: string;
  topRatio: number;
  /** Offset of the turn's prompt inside the scroll container, once measured. */
  scrollTop: number | null;
  index: number;
}

interface NodeLayout {
  nodes: NodeInfo[];
  gap: number;
  fillsHeight: boolean;
}

export const ChatMinimap = memo(function ChatMinimap({
  onExpandedWidthChange,
  tree,
  activeLeafId,
  onLeafChange,
  branchDisabled,
  messages,
  entryIds,
  historyAnchors,
  starredEntryIds,
  answerRefs,
  onLoadThrough,
  scrollContainer,
  messageRefs,
}: Props) {
  const { t } = useI18n();
  const stars = useMemo(() => new Set(starredEntryIds), [starredEntryIds]);
  const compactions = useMemo(
    () =>
      new Set([
        ...(historyAnchors ?? [])
          .filter((anchor) => anchor.compaction)
          .map((anchor) => anchor.id),
        ...messages.flatMap((message, index) =>
          message.role === "custom" && message.customType === "compaction"
            ? [entryIds[index] ?? `live:${index - entryIds.length}`]
            : [],
        ),
      ]),
    [historyAnchors, messages, entryIds],
  );
  const [visible, setVisible] = useState(false);
  const [allNodes, setAllNodes] = useState<NodeInfo[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [minimapHeight, setMinimapHeight] = useState(600);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [branchPreviewId, setBranchPreviewId] = useState<string | null>(null);
  const [railHovered, setRailHovered] = useState(false);
  const [railFocused, setRailFocused] = useState(false);
  const branchRefs = useRef(new Map<string, HTMLButtonElement>());
  const previewId = useId();
  const markerRefs = useRef(new Map<string, HTMLButtonElement>());
  const draggingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const allNodesRef = useRef<NodeInfo[]>([]);
  const nodeLayoutRef = useRef<NodeLayout>({
    nodes: [],
    gap: MAX_NODE_GAP,
    fillsHeight: false,
  });
  const activeNodeLockRef = useRef<{ index: number; until: number } | null>(
    null,
  );
  const pendingNavigationRef = useRef<string | null>(null);
  const navigationLoadingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadedAnchorIds = useMemo(
    () =>
      messages.flatMap((message, index) =>
        isMessageGroupAnchor(message) || stars.has(entryIds[index] ?? "")
          ? [entryIds[index] ?? `live:${index - entryIds.length}`]
          : [],
      ),
    [messages, entryIds, stars],
  );
  const anchorIds = useMemo(
    () => [
      ...new Set([
        ...(historyAnchors ?? []).map((anchor) => anchor.id),
        ...loadedAnchorIds,
      ]),
    ],
    [historyAnchors, loadedAnchorIds],
  );
  const previews = useMemo(() => {
    const result = new Map(
      (historyAnchors ?? []).map(({ id, preview }) => [id, preview]),
    );
    messages.forEach((message, index) => {
      if (message.role === "user") {
        result.set(
          entryIds[index] ?? `live:${index - entryIds.length}`,
          getMessagePreview(message.content),
        );
      }
    });
    return result;
  }, [historyAnchors, messages, entryIds]);
  const promptAnchorIds = useMemo(
    () =>
      messages.flatMap((message, index) =>
        isMessageGroupAnchor(message)
          ? [entryIds[index] ?? `live:${index - entryIds.length}`]
          : [],
      ),
    [messages, entryIds],
  );
  const anchorsRef = useRef({ anchorIds, promptAnchorIds });
  anchorsRef.current = { anchorIds, promptAnchorIds };

  const branched = useMemo(() => !!tree && hasSessionBranches(tree), [tree]);
  const expanded = branched && (railHovered || railFocused);
  useEffect(() => {
    if (!expanded && containerRef.current) containerRef.current.scrollLeft = 0;
  }, [expanded]);
  const graph = useMemo(
    () =>
      buildConversationRail(
        // Without forks, transcript anchors form one active path.
        branched && tree ? tree : [],
        activeLeafId ?? null,
        anchorIds,
        starredEntryIds,
      ),
    [branched, tree, activeLeafId, anchorIds, starredEntryIds],
  );
  const visibleGraph = expanded ? graph : graph.filter((node) => node.active);
  const graphRows = visibleGraph.reduce(
    (max, node) => Math.max(max, node.row),
    0,
  );
  const graphGap = Math.min(
    MAX_NODE_GAP,
    Math.max(
      0,
      (minimapHeight - MINIMAP_FOOTER - MINIMAP_PADDING * 2) /
        Math.max(1, graphRows),
    ),
  );
  const graphY = (row: number) => MINIMAP_PADDING + row * graphGap;
  const graphWidth = graph.reduce(
    (max, node) => Math.max(max, node.lane * BRANCH_LANE_GAP + MINIMAP_WIDTH),
    MINIMAP_WIDTH,
  );
  useEffect(() => {
    onExpandedWidthChange?.(graphWidth);
  }, [graphWidth, onExpandedWidthChange]);
  const graphById = new Map(graph.map((node) => [node.id, node]));
  const branchLabel = (id: string) => {
    if (stars.has(id)) return t("chat.switchStarredPath");
    const preview = graphById.get(id)?.preview;
    return preview
      ? t("chat.switchConversationPath", { preview })
      : t("chat.switchPath");
  };
  const nodeLayout = useMemo(() => {
    const rows = new Map(graph.map((node) => [node.id, node.row]));
    return {
      nodes: allNodes.map((node) => ({
        ...node,
        topRatio:
          (MINIMAP_PADDING + (rows.get(node.id) ?? 0) * graphGap) /
          minimapHeight,
      })),
      gap: graphGap,
      fillsHeight: graphGap < MAX_NODE_GAP,
    };
  }, [allNodes, minimapHeight, graph, graphGap]);
  const { nodes: positionedNodes, gap: nodeGap } = nodeLayout;
  nodeLayoutRef.current = nodeLayout;

  const lockActiveNode = useCallback((index: number) => {
    activeNodeLockRef.current = {
      index,
      until: Date.now() + NAVIGATION_ACTIVE_LOCK_MS,
    };
    setActiveIndex(index);
  }, []);

  const syncActiveNode = useCallback(
    (scrollEl: HTMLDivElement, nextNodes: NodeInfo[]) => {
      const activeLock = activeNodeLockRef.current;
      if (activeLock && Date.now() < activeLock.until) {
        setActiveIndex(activeLock.index);
        return;
      }
      activeNodeLockRef.current = null;

      const measuredNodes = nextNodes.filter((node) => node.scrollTop !== null);
      const [firstMeasuredNode] = measuredNodes;
      if (!firstMeasuredNode) {
        setActiveIndex(null);
        return;
      }
      const focusTop = scrollEl.scrollTop + scrollEl.clientHeight * 0.3;
      const nextActiveNode = measuredNodes.reduce(
        (bestNode, node) =>
          Math.abs((node.scrollTop ?? 0) - focusTop) <
          Math.abs((bestNode.scrollTop ?? 0) - focusTop)
            ? node
            : bestNode,
        firstMeasuredNode,
      );
      setActiveIndex(nextActiveNode.index);
    },
    [],
  );

  const updateScroll = useCallback(() => {
    const scrollEl = scrollContainer.current;
    if (!scrollEl) return;
    const scrollable = scrollEl.scrollHeight - scrollEl.clientHeight;
    setVisible(scrollable > 20 || anchorsRef.current.anchorIds.length > 1);
    syncActiveNode(scrollEl, allNodesRef.current);
  }, [scrollContainer, syncActiveNode]);

  const scheduleScroll = useAnimationFrameCallback(updateScroll);

  const measureThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const measureNodes = useCallback(() => {
    if (measureThrottleRef.current) return;
    measureThrottleRef.current = setTimeout(() => {
      measureThrottleRef.current = null;
      const scrollEl = scrollContainer.current;
      const minimapEl = containerRef.current;
      if (!scrollEl || !minimapEl) return;

      const refs = messageRefs.current;
      const containerRect = scrollEl.getBoundingClientRect();
      const nextNodes: NodeInfo[] = [];
      const refIndices = new Map(
        anchorsRef.current.promptAnchorIds.map((id, index) => [id, index]),
      );
      for (const id of anchorsRef.current.anchorIds) {
        const refIndex = refIndices.get(id);
        const element =
          answerRefs?.current.get(id) ??
          (refIndex === undefined ? null : refs?.[refIndex]);
        const elementRect = element?.getBoundingClientRect();
        nextNodes.push({
          id,
          topRatio: 0,
          index: nextNodes.length,
          scrollTop: elementRect
            ? elementRect.top - containerRect.top + scrollEl.scrollTop
            : null,
        });
      }

      setMinimapHeight(Math.max(1, minimapEl.clientHeight));
      // A growing response usually leaves every anchor at the same offset.
      // Keep the rail stable instead of rendering a fresh identical node list.
      const previous = allNodesRef.current;
      if (
        previous.length !== nextNodes.length ||
        nextNodes.some(
          (node, index) =>
            node.id !== previous[index]?.id ||
            node.scrollTop !== previous[index]?.scrollTop,
        )
      ) {
        allNodesRef.current = nextNodes;
        setAllNodes(nextNodes);
      }
      setVisible(
        scrollEl.scrollHeight - scrollEl.clientHeight > 20 ||
          nextNodes.length > 1,
      );
      syncActiveNode(scrollEl, nextNodes);

      // A jump requested before the target had been measured retries here.
      const pendingId = pendingNavigationRef.current;
      if (pendingId === null) return;
      const pendingNode = nextNodes.find((node) => node.id === pendingId);
      if (!pendingNode || pendingNode.scrollTop === null) return;
      pendingNavigationRef.current = null;
      lockActiveNode(pendingNode.index);
      scrollEl.scrollTo({
        top: Math.max(0, pendingNode.scrollTop - scrollEl.clientHeight * 0.3),
        behavior: "smooth",
      });
    }, 150);
  }, [
    answerRefs,
    lockActiveNode,
    messageRefs,
    scrollContainer,
    syncActiveNode,
  ]);

  useEffect(() => {
    const el = scrollContainer.current;
    if (!el) return;
    el.addEventListener("scroll", scheduleScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", scheduleScroll);
    };
  }, [scrollContainer, scheduleScroll]);

  useEffect(() => {
    const el = scrollContainer.current;
    if (!el) return;
    const syncLayout = () => {
      measureNodes();
      scheduleScroll();
    };
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(syncLayout);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    measureNodes();
    updateScroll();
    return () => {
      ro.disconnect();
      if (measureThrottleRef.current) {
        clearTimeout(measureThrottleRef.current);
        measureThrottleRef.current = null;
      }
    };
  }, [measureNodes, scrollContainer, scheduleScroll, updateScroll]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      measureNodes();
      scheduleScroll();
    }, 50);
    return () => {
      clearTimeout(timeout);
    };
  }, [anchorIds, loadedAnchorIds, measureNodes, scheduleScroll]);

  const loadPendingNavigation = useCallback(async () => {
    if (navigationLoadingRef.current) return;
    navigationLoadingRef.current = true;
    try {
      while (mountedRef.current && pendingNavigationRef.current !== null) {
        const id = pendingNavigationRef.current;
        const loaded = await onLoadThrough(id);
        if (!mountedRef.current) return;
        if (pendingNavigationRef.current !== id) continue;
        if (!loaded) pendingNavigationRef.current = null;
        measureNodes();
        break;
      }
    } finally {
      navigationLoadingRef.current = false;
    }
  }, [measureNodes, onLoadThrough]);

  const scrollToNode = useCallback(
    (node: NodeInfo, behavior: ScrollBehavior) => {
      const scrollEl = scrollContainer.current;
      if (!scrollEl) return;
      lockActiveNode(node.index);
      pendingNavigationRef.current = null;
      if (node.scrollTop === null) {
        pendingNavigationRef.current = node.id;
        void loadPendingNavigation();
        return;
      }
      scrollEl.scrollTo({
        top: Math.max(0, node.scrollTop - scrollEl.clientHeight * 0.3),
        behavior,
      });
    },
    [loadPendingNavigation, lockActiveNode, scrollContainer],
  );

  const findNearestNode = useCallback((ratio: number): NodeInfo | null => {
    const { nodes, gap, fillsHeight } = nodeLayoutRef.current;
    const height = containerRef.current?.clientHeight ?? 0;
    const [firstNode] = nodes;
    if (!firstNode || height <= 0) return null;

    const pointerY = Math.max(0, Math.min(height, ratio * height));
    const nearestNode = nodes.reduce(
      (nearest, node) =>
        Math.abs(node.topRatio * height - pointerY) <
        Math.abs(nearest.topRatio * height - pointerY)
          ? node
          : nearest,
      firstNode,
    );

    if (!fillsHeight && nearestNode) {
      const nodeY = nearestNode.topRatio * height;
      const hitRadius = Math.max(10, gap / 2);
      if (Math.abs(pointerY - nodeY) > hitRadius) return null;
    }
    return nearestNode ?? null;
  }, []);

  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!visible && !branched) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (
        branched &&
        event.clientX - bounds.left + event.currentTarget.scrollLeft >
          MINIMAP_WIDTH
      )
        return;

      draggingRef.current = true;
      const rect = event.currentTarget.getBoundingClientRect();
      const jumpToPointer = (clientY: number, behavior: ScrollBehavior) => {
        const ratio = Math.max(
          0,
          Math.min(1, (clientY - rect.top) / rect.height),
        );
        const node = findNearestNode(ratio);
        if (node) scrollToNode(node, behavior);
      };

      jumpToPointer(event.clientY, "smooth");
      const onMove = (moveEvent: MouseEvent) => {
        if (!draggingRef.current) return;
        jumpToPointer(moveEvent.clientY, "auto");
      };
      const onUp = () => {
        draggingRef.current = false;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [findNearestNode, scrollToNode, visible, branched],
  );

  if (!visible && !branched) return null;

  const previewIndex = hoveredIndex;
  const previewNode =
    previewIndex === null ? undefined : positionedNodes[previewIndex];
  const previewText =
    previewNode &&
    !compactions.has(previewNode.id) &&
    !stars.has(previewNode.id)
      ? previews.get(previewNode.id)
      : undefined;
  const previewAnchor = previewNode
    ? markerRefs.current.get(previewNode.id)
    : undefined;

  const branchPreviewAnchor =
    branchPreviewId && graphById.has(branchPreviewId)
      ? branchRefs.current.get(branchPreviewId)
      : undefined;

  return (
    <div
      ref={containerRef}
      className={`chat-minimap${branched ? " has-branches" : ""}${expanded ? " is-expanded" : ""}`}
      role="navigation"
      aria-label={t("chat.conversationMap")}
      tabIndex={branched ? 0 : undefined}
      onMouseEnter={() => {
        setRailHovered(true);
      }}
      onFocusCapture={() => {
        setRailFocused(true);
      }}
      onKeyDownCapture={() => {
        setRailFocused(true);
      }}
      onMouseDownCapture={(event) => {
        if (branched) {
          // Pointer navigation must not pin the hover expansion through focus.
          event.preventDefault();
          setRailFocused(false);
        }
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setRailFocused(false);
          setBranchPreviewId(null);
        }
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={(event) => {
        if (
          event.target instanceof window.Element &&
          event.target.closest(".minimap-branch")
        )
          return;
        const rect = event.currentTarget.getBoundingClientRect();
        const node =
          branched &&
          event.clientX - rect.left + event.currentTarget.scrollLeft >
            MINIMAP_WIDTH
            ? null
            : findNearestNode((event.clientY - rect.top) / rect.height);
        // Store the index, not the raw ratio: React bails out when it is
        // unchanged, so a pointer sweep only re-renders when the dot changes.
        setHoveredIndex(node?.index ?? null);
        if (node) setBranchPreviewId(null);
      }}
      onMouseLeave={() => {
        setRailHovered(false);
        setHoveredIndex(null);
        if (!railFocused) setBranchPreviewId(null);
      }}
      style={{
        width: expanded ? graphWidth : MINIMAP_WIDTH,
        maxWidth: expanded ? "100%" : undefined,
        flexShrink: 0,
        position: "relative",
        cursor: "pointer",
        userSelect: "none",
        borderLeft: "1px solid var(--border)",
        background: "var(--bg-panel)",
        overflow: expanded ? "auto" : "visible",
      }}
    >
      {graph.length > 0 && (
        <>
          <svg
            aria-hidden="true"
            width={expanded ? graphWidth : MINIMAP_WIDTH}
            height={minimapHeight}
            style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
          >
            {visibleGraph.map((node) => {
              const parent = node.parentId
                ? graphById.get(node.parentId)
                : undefined;
              if (!parent) return null;
              const x = MINIMAP_WIDTH / 2 + node.lane * BRANCH_LANE_GAP;
              const px = MINIMAP_WIDTH / 2 + parent.lane * BRANCH_LANE_GAP;
              const y = graphY(node.row) - GRAPH_NODE_CLEARANCE;
              const py = graphY(parent.row) + GRAPH_NODE_CLEARANCE;
              if (y <= py) return null;
              return (
                <path
                  key={node.id}
                  d={`M ${px} ${py} C ${px} ${y}, ${x} ${py}, ${x} ${y}`}
                  fill="none"
                  stroke="var(--text-dim)"
                  strokeWidth={node.active ? 2 : 1}
                  opacity={node.active ? 0.8 : 0.55}
                />
              );
            })}
          </svg>
          {visibleGraph
            .filter((node) => !node.anchor)
            .map((node) =>
              node.active ? (
                <span
                  key={node.id}
                  className="minimap-junction"
                  data-rail-entry-id={node.id}
                  style={{
                    left: MINIMAP_WIDTH / 2 + node.lane * BRANCH_LANE_GAP,
                    top: graphY(node.row),
                  }}
                />
              ) : (
                <button
                  key={node.id}
                  type="button"
                  className={`minimap-branch${stars.has(node.id) ? " minimap-star" : ""}`}
                  data-rail-entry-id={node.id}
                  aria-label={branchLabel(node.id)}
                  aria-describedby={
                    branchPreviewId === node.id ? previewId : undefined
                  }
                  disabled={branchDisabled}
                  ref={(element) => {
                    if (element) branchRefs.current.set(node.id, element);
                    else branchRefs.current.delete(node.id);
                  }}
                  style={{
                    left: MINIMAP_WIDTH / 2 + node.lane * BRANCH_LANE_GAP,
                    top: graphY(node.row),
                    height: Math.max(1, Math.min(32, graphGap)),
                  }}
                  onMouseDown={(event) => {
                    event.stopPropagation();
                  }}
                  onClick={() => {
                    void onLeafChange?.(node.targetLeafId, node.scrollEntryId);
                  }}
                  onMouseEnter={() => {
                    setHoveredIndex(null);
                    setBranchPreviewId(node.id);
                  }}
                  onMouseLeave={() => {
                    setBranchPreviewId(null);
                  }}
                  onFocus={() => {
                    setHoveredIndex(null);
                    setBranchPreviewId(node.id);
                  }}
                  onBlur={() => {
                    setBranchPreviewId(null);
                  }}
                >
                  {stars.has(node.id) ? <StarIcon filled /> : <span />}
                </button>
              ),
            )}
          {expanded && branchPreviewId && branchPreviewAnchor && (
            <MessagePreviewPopover
              id={previewId}
              text={branchLabel(branchPreviewId)}
              anchor={branchPreviewAnchor}
            />
          )}
        </>
      )}
      {positionedNodes.map((node) => {
        const isNearest = hoveredIndex === node.index;
        const isActive = activeIndex === node.index;

        return (
          <div
            key={node.id}
            data-minimap-node-index={node.index}
            data-minimap-entry-id={node.id}
            data-minimap-node-active={isActive ? "" : undefined}
            style={{
              position: "absolute",
              top: `${node.topRatio * 100}%`,
              transform: "translateY(-50%)",
              left: 0,
              width: MINIMAP_WIDTH,
              height: Math.max(1, nodeGap),
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
              zIndex: 2,
            }}
          >
            {compactions.has(node.id) ? (
              <div
                role="separator"
                aria-label={t("chat.compaction.divider")}
                style={{
                  width: 18,
                  height: 2,
                  borderRadius: 1,
                  background: "var(--text-muted)",
                  opacity: isActive || isNearest ? 1 : 0.6,
                  boxShadow: "0 0 0 2px var(--bg-panel)",
                }}
              />
            ) : stars.has(node.id) ? (
              <button
                type="button"
                tabIndex={-1}
                className="minimap-star"
                title={t("chat.jumpStarredAnswer")}
                aria-label={t("chat.jumpStarredAnswer")}
                onMouseDown={(event) => {
                  event.stopPropagation();
                }}
                onClick={() => {
                  scrollToNode(node, "smooth");
                }}
                style={{ height: Math.max(1, Math.min(32, nodeGap)) }}
              >
                <StarIcon filled />
              </button>
            ) : (
              <button
                type="button"
                tabIndex={-1}
                className="minimap-message"
                aria-label={t("chat.jumpHumanMessage")}
                aria-describedby={
                  previewNode?.id === node.id && previewText
                    ? previewId
                    : undefined
                }
                ref={(element) => {
                  if (element) markerRefs.current.set(node.id, element);
                  else markerRefs.current.delete(node.id);
                }}
                style={{ height: Math.max(1, Math.min(32, nodeGap)) }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    background: isActive
                      ? "rgba(128,128,128,0.95)"
                      : "rgba(128,128,128,0.58)",
                    border: `1.5px solid ${isActive ? "rgba(128,128,128,0.95)" : "rgba(128,128,128,0.58)"}`,
                    boxShadow: isActive ? "0 0 0 2px var(--bg-panel)" : "none",
                    transition: "transform 0.1s, background 0.1s",
                    transform: isNearest ? "scale(1.25)" : "scale(1)",
                  }}
                />
              </button>
            )}
          </div>
        );
      })}
      {previewText && previewAnchor && previewNode && (
        <MessagePreviewPopover
          key={previewNode.id}
          id={previewId}
          text={previewText}
          anchor={previewAnchor}
        />
      )}
    </div>
  );
});
