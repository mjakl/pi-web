"use client";

import { useEffect, useRef, useState, useCallback, useMemo, type RefObject } from "react";
import { isMessageGroupAnchor } from "@/lib/message-display";
import { formatTimestamp } from "@/lib/i18n/format";
import type { AgentMessage, SessionContext } from "@/lib/types";

interface Props {
  messages: AgentMessage[];
  entryIds: string[];
  historyAnchors?: SessionContext["historyAnchors"];
  onLoadThrough: (entryId: string) => Promise<boolean>;
  scrollContainer: RefObject<HTMLDivElement | null>;
  messageRefs: RefObject<(HTMLDivElement | null)[]>;
}

const MINIMAP_WIDTH = 36;
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

function layoutNodes(allNodes: NodeInfo[], minimapHeight: number): NodeLayout {
  if (allNodes.length === 0) {
    return { nodes: [], gap: MAX_NODE_GAP, fillsHeight: false };
  }

  const height = Math.max(1, minimapHeight);
  const usableHeight = Math.max(0, height - MINIMAP_PADDING * 2);
  if (allNodes.length === 1) {
    return {
      nodes: [{ ...allNodes[0], topRatio: MINIMAP_PADDING / height }],
      gap: MAX_NODE_GAP,
      fillsHeight: false,
    };
  }

  const naturalGap = usableHeight / (allNodes.length - 1);
  const gap = Math.min(MAX_NODE_GAP, naturalGap);
  return {
    nodes: allNodes.map((node, index) => ({
      ...node,
      topRatio: (MINIMAP_PADDING + index * gap) / height,
    })),
    gap,
    fillsHeight: naturalGap <= MAX_NODE_GAP,
  };
}

export function ChatMinimap({
  messages,
  entryIds,
  historyAnchors,
  onLoadThrough,
  scrollContainer,
  messageRefs,
}: Props) {
  const [visible, setVisible] = useState(false);
  const [allNodes, setAllNodes] = useState<NodeInfo[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [minimapHeight, setMinimapHeight] = useState(600);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const draggingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const allNodesRef = useRef<NodeInfo[]>([]);
  const nodeLayoutRef = useRef<NodeLayout>({
    nodes: [],
    gap: MAX_NODE_GAP,
    fillsHeight: false,
  });
  const activeNodeLockRef = useRef<{ index: number; until: number } | null>(null);
  const pendingNavigationRef = useRef<string | null>(null);
  const navigationLoadingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const loadedAnchorIds = useMemo(() => messages.flatMap((message, index) => (
    isMessageGroupAnchor(message) ? [entryIds[index] ?? `live:${index - entryIds.length}`] : []
  )), [messages, entryIds]);
  const anchorIds = useMemo(() => [...new Set([...(historyAnchors ?? []).map((anchor) => anchor.id), ...loadedAnchorIds])], [historyAnchors, loadedAnchorIds]);
  const timestamps = useMemo(() => {
    const result = new Map((historyAnchors ?? []).map(({ id, timestamp }) => [id, timestamp]));
    messages.forEach((message, index) => {
      if (isMessageGroupAnchor(message) && message.timestamp !== undefined) {
        result.set(entryIds[index] ?? `live:${index - entryIds.length}`, message.timestamp);
      }
    });
    return result;
  }, [historyAnchors, messages, entryIds]);
  const anchorsRef = useRef({ anchorIds, loadedAnchorIds });
  anchorsRef.current = { anchorIds, loadedAnchorIds };

  const nodeLayout = useMemo(
    () => layoutNodes(allNodes, minimapHeight),
    [allNodes, minimapHeight],
  );
  const { nodes: positionedNodes, gap: nodeGap } = nodeLayout;
  nodeLayoutRef.current = nodeLayout;

  const lockActiveNode = useCallback((index: number) => {
    activeNodeLockRef.current = {
      index,
      until: Date.now() + NAVIGATION_ACTIVE_LOCK_MS,
    };
    setActiveIndex(index);
  }, []);

  const syncActiveNode = useCallback((scrollEl: HTMLDivElement, nextNodes: NodeInfo[]) => {
    const activeLock = activeNodeLockRef.current;
    if (activeLock && Date.now() < activeLock.until) {
      setActiveIndex(activeLock.index);
      return;
    }
    activeNodeLockRef.current = null;

    const measuredNodes = nextNodes.filter((node) => node.scrollTop !== null);
    if (measuredNodes.length === 0) {
      setActiveIndex(null);
      return;
    }
    const focusTop = scrollEl.scrollTop + scrollEl.clientHeight * 0.3;
    const nextActiveNode = measuredNodes.reduce((bestNode, node) => (
      Math.abs((node.scrollTop ?? 0) - focusTop) < Math.abs((bestNode.scrollTop ?? 0) - focusTop)
        ? node
        : bestNode
    ), measuredNodes[0]);
    setActiveIndex(nextActiveNode.index);
  }, []);

  const updateScroll = useCallback(() => {
    const scrollEl = scrollContainer.current;
    if (!scrollEl) return;
    const scrollable = scrollEl.scrollHeight - scrollEl.clientHeight;
    setVisible(scrollable > 20 || anchorsRef.current.anchorIds.length > 1);
    syncActiveNode(scrollEl, allNodesRef.current);
  }, [scrollContainer, syncActiveNode]);

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
      const refIndices = new Map(anchorsRef.current.loadedAnchorIds.map((id, index) => [id, index]));
      for (const id of anchorsRef.current.anchorIds) {
        const refIndex = refIndices.get(id);
        const element = refIndex === undefined ? null : refs?.[refIndex];
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

      setMinimapHeight(Math.max(1, minimapEl.clientHeight - MINIMAP_FOOTER));
      allNodesRef.current = nextNodes;
      setAllNodes(nextNodes);
      setVisible(scrollEl.scrollHeight - scrollEl.clientHeight > 20 || nextNodes.length > 1);
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
  }, [lockActiveNode, messageRefs, scrollContainer, syncActiveNode]);

  useEffect(() => {
    const el = scrollContainer.current;
    if (!el) return;
    el.addEventListener("scroll", updateScroll, { passive: true });
    return () => el.removeEventListener("scroll", updateScroll);
  }, [scrollContainer, updateScroll]);

  useEffect(() => {
    const el = scrollContainer.current;
    if (!el) return;
    const syncLayout = () => {
      measureNodes();
      updateScroll();
    };
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(syncLayout);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    syncLayout();
    return () => {
      ro.disconnect();
      if (measureThrottleRef.current) {
        clearTimeout(measureThrottleRef.current);
        measureThrottleRef.current = null;
      }
    };
  }, [measureNodes, scrollContainer, updateScroll]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      measureNodes();
      updateScroll();
    }, 50);
    return () => clearTimeout(timeout);
  }, [anchorIds, loadedAnchorIds, measureNodes, updateScroll]);

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

  const scrollToNode = useCallback((node: NodeInfo, behavior: ScrollBehavior) => {
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
  }, [loadPendingNavigation, lockActiveNode, scrollContainer]);

  const findNearestNode = useCallback((ratio: number): NodeInfo | null => {
    const { nodes, gap, fillsHeight } = nodeLayoutRef.current;
    const height = containerRef.current?.clientHeight ?? 0;
    if (nodes.length === 0 || height <= 0) return null;

    const pointerY = Math.max(0, Math.min(height, ratio * height));
    const firstNodeY = nodes[0].topRatio * height;
    const rawIndex = gap > 0 ? Math.round((pointerY - firstNodeY) / gap) : 0;
    const nodeIndex = Math.max(0, Math.min(nodes.length - 1, rawIndex));
    const nearestNode = nodes[nodeIndex];

    if (!fillsHeight) {
      const nodeY = nearestNode.topRatio * height;
      const hitRadius = Math.max(10, gap / 2);
      if (Math.abs(pointerY - nodeY) > hitRadius) return null;
    }
    return nearestNode;
  }, []);

  const handleMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!visible) return;

    draggingRef.current = true;
    const rect = event.currentTarget.getBoundingClientRect();
    const jumpToPointer = (clientY: number, behavior: ScrollBehavior) => {
      const ratio = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
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
  }, [findNearestNode, scrollToNode, visible]);

  if (!visible) return null;

  const lastNodeTop = positionedNodes.length > 0
    ? positionedNodes[positionedNodes.length - 1].topRatio * minimapHeight
    : MINIMAP_PADDING;
  const railHeight = Math.max(1, lastNodeTop - MINIMAP_PADDING);
  const hoveredTimestamp = hoveredIndex === null ? undefined : timestamps.get(positionedNodes[hoveredIndex]?.id);

  return (
    <div
      ref={containerRef}
      className="chat-minimap"
      title={hoveredTimestamp !== undefined && Number.isFinite(hoveredTimestamp) ? formatTimestamp(hoveredTimestamp) : undefined}
      onMouseDown={handleMouseDown}
      onMouseMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const node = findNearestNode((event.clientY - rect.top) / rect.height);
        // Store the index, not the raw ratio: React bails out when it is
        // unchanged, so a pointer sweep only re-renders when the dot changes.
        setHoveredIndex(node?.index ?? null);
      }}
      onMouseLeave={() => setHoveredIndex(null)}
      style={{
        width: MINIMAP_WIDTH,
        flexShrink: 0,
        position: "relative",
        cursor: "pointer",
        userSelect: "none",
        borderLeft: "1px solid var(--border)",
        background: "var(--bg-panel)",
        overflow: "visible",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: MINIMAP_PADDING,
          height: railHeight,
          width: 1,
          background: "var(--border)",
          transform: "translateX(-50%)",
          zIndex: 0,
        }}
      />

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
              right: 0,
              height: Math.max(1, nodeGap),
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
              zIndex: 2,
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: isActive ? "rgba(128,128,128,0.42)" : "rgba(128,128,128,0.16)",
                border: `1.5px solid ${isActive ? "rgba(128,128,128,0.95)" : "rgba(128,128,128,0.58)"}`,
                boxShadow: isActive ? "0 0 0 2px var(--bg-panel)" : "none",
                transition: "transform 0.1s, background 0.1s",
                transform: isNearest ? "scale(1.25)" : "scale(1)",
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
