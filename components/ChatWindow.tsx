"use client";

import { useAnimationFrameCallback } from "@/hooks/useAnimationFrameCallback";
import { registerAbortHandler } from "@/hooks/useKeyboardShortcuts";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  AgentMessage,
  AssistantContentBlock,
  AssistantMessage,
  BlockingExtensionUiRequest,
  ExtensionUiRequest,
  SessionInfo,
  SessionTreeNode,
  ToolEntry,
  ToolResultMessage,
} from "@/lib/types";
import { normalizeCustomPanelLines } from "@/lib/ansi";
import { asBracketedPaste, toTerminalKeyData } from "@/lib/terminal-input";
import {
  countToolCallBlocks,
  getAssistantErrorMessage,
  getDisplayableAssistantBlocks,
  isMessageGroupAnchor,
  shouldExpandProcessDetails,
  splitFinalAssistantBlocks,
} from "@/lib/message-display";
import {
  extractTurnWrittenFiles,
  type WrittenFile,
} from "@/lib/turn-written-files";
import { MessageView } from "./MessageView";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import { useSessionInputFocus } from "@/hooks/useSessionInputFocus";
import type { CompactionControl } from "./CompactButton";
import { ChatJumpToLatest } from "./ChatJumpToLatest";
import { ChatMinimap } from "./ChatMinimap";
import { ExtensionStatusBar } from "./ExtensionStatusBar";
import { AnsiText } from "./AnsiText";
import { useI18n } from "@/hooks/useI18n";
import { useAgentSession, type AgentPhase } from "@/hooks/useAgentSession";
import type { NoticeItem } from "@/lib/notice-queue";
import { useDragDrop } from "@/hooks/useDragDrop";
import { useMessageRefs } from "@/hooks/useMessageRefs";
import type { ContextUsage, SessionStatsInfo } from "@/lib/pi-types";
import {
  captureScrollDistance,
  didPrependHistory,
  getLiveFollowAttached,
  isScrollAtTail,
  restoreScrollTop,
} from "@/lib/chat-lazy-load";

/** What the shell displays on ChatWindow's behalf. Values only: this is held in
 *  AppShell state and compared, so everything here must be cheap to compare. */
export interface ChatDisplayState {
  branchTree: SessionTreeNode[];
  branchActiveLeafId: string | null;
  systemPrompt: string | null;
  systemTools: ToolEntry[] | null;
  sessionStats: SessionStatsInfo | null;
  contextUsage: ContextUsage | null;
  compactionControl: CompactionControl | null;
}

/** What the shell invokes on ChatWindow's behalf. Callables only: this is held
 *  in a ref and never compared, so a change of function identity cannot
 *  re-render the shell. Keep the two channels apart for that reason. */
export interface ChatActions {
  loadSystemInfo: () => Promise<void>;
  refreshTranscript: (() => Promise<boolean>) | null;
  changeBranchLeaf: (leafId: string | null) => void;
}

export const EMPTY_CHAT_DISPLAY: ChatDisplayState = {
  branchTree: [],
  branchActiveLeafId: null,
  systemPrompt: null,
  systemTools: null,
  sessionStats: null,
  contextUsage: null,
  compactionControl: null,
};

interface Props {
  session: SessionInfo | null;
  sessionActive?: boolean;
  sessionRunning?: boolean;
  newSessionCwd: string | null;
  newSessionDraftKey: string | null;
  onAgentEnd?: () => void;
  onAttentionNeeded?: (request: BlockingExtensionUiRequest) => void;
  onSessionCreated?: (session: SessionInfo, sourceDraftKey: string) => void;
  onSessionForked?: (newSessionId: string) => void;
  modelsRefreshKey?: number;
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  onSessionMetadataChange?: (session: SessionInfo) => void;
  onSessionStatsPanelOpen?: () => void;
  onOpenFile?: (filePath: string) => void;
  onChatDisplayChange?: (display: ChatDisplayState) => void;
  onChatActionsChange?: (actions: ChatActions | null) => void;
  /** Completion sound state is owned by AppShell so tasks finishing in a
   *  non-active workspace can still ring. */
  soundEnabled?: boolean;
  playDoneSound?: () => void;
  unlockAudio?: () => void;
}

function phaseLabel(
  phase: AgentPhase,
  t: (key: string, params?: Record<string, string | number>) => string,
): string | null {
  if (phase?.kind === "running_tools") {
    const latest = phase.tools[phase.tools.length - 1];
    if (latest?.progress) {
      return `${t("chat.runningNamedTool", { name: latest.name })} ${latest.progress}`;
    }
    const names = phase.tools.map((t) => t.name);
    const [firstName] = names;
    if (firstName === undefined) return t("chat.runningTool");
    if (names.length === 1)
      return t("chat.runningNamedTool", { name: firstName });
    if (names.length <= 3)
      return t("chat.runningTools", { names: names.join(", ") });
    return t("chat.runningToolsMore", {
      names: names.slice(0, 2).join(", "),
      count: names.length - 2,
    });
  }
  if (phase?.kind === "running_command") return t("chat.runningCommand");
  return null;
}

function hasFinalAssistantAnswer(message: AgentMessage): boolean {
  if (message.role !== "assistant") return false;
  return splitFinalAssistantBlocks(message).answerBlocks.some(
    (block) =>
      block.type === "image" ||
      (block.type === "text" && block.text.trim().length > 0),
  );
}

function findFinalAssistantIndex(messages: AgentMessage[]): number {
  const answerIndex = messages.findLastIndex(hasFinalAssistantAnswer);
  return answerIndex === -1
    ? messages.findLastIndex((message) => message.role === "assistant")
    : answerIndex;
}

function getUserInputText(message: AgentMessage): string | null {
  if (message.role !== "user") return null;
  if (typeof message.content === "string") {
    const text = message.content.trim();
    return text.length > 0 ? text : null;
  }
  const text = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
  return text.length > 0 ? text : null;
}

function countToolCalls(messages: AgentMessage[]): number {
  let count = 0;
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    count += countToolCallBlocks(getDisplayableAssistantBlocks(msg));
  }
  return count;
}

function hasDisplayableProcessMessage(message: AgentMessage): boolean {
  if (message.role === "assistant") {
    return getDisplayableAssistantBlocks(message).length > 0;
  }
  return message.role === "custom";
}

function withAssistantBlocks(
  message: AssistantMessage,
  content: AssistantContentBlock[],
  options: { omitUsage?: boolean } = {},
): AssistantMessage {
  const next = { ...message, content };
  if (options.omitUsage) next.usage = undefined;
  return next;
}

function ProcessDetailsGroup({
  messageCount,
  toolCallCount,
  defaultExpanded = false,
  children,
  t,
}: {
  messageCount: number;
  toolCallCount: number;
  defaultExpanded?: boolean;
  children: ReactNode;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const parts = [
    t("chat.processDetails"),
    `${messageCount} ${t(messageCount === 1 ? "chat.message" : "chat.messages")}`,
  ];
  if (toolCallCount > 0)
    parts.push(
      `${toolCallCount} ${t(toolCallCount === 1 ? "chat.toolCall" : "chat.toolCalls")}`,
    );

  return (
    <div style={{ marginBottom: 14 }}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => {
          setExpanded((v) => !v);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "auto",
          minHeight: 24,
          padding: "2px 0",
          border: "none",
          background: "transparent",
          color: "var(--text-muted)",
          cursor: "pointer",
          fontSize: 12,
          textAlign: "left",
        }}
        title={expanded ? t("chat.collapseProcess") : t("chat.expandProcess")}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            flexShrink: 0,
            transform: expanded ? "rotate(90deg)" : "none",
            transition: "transform 0.15s",
          }}
        >
          <polyline points="4 2.5 7.5 6 4 9.5" />
        </svg>
        <span
          style={{
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {parts.join(" · ")}
        </span>
      </button>
      {expanded && <div style={{ marginTop: 8 }}>{children}</div>}
    </div>
  );
}

export function ChatWindow({
  session,
  sessionActive,
  sessionRunning,
  newSessionCwd,
  newSessionDraftKey,
  onAgentEnd,
  onAttentionNeeded,
  onSessionCreated,
  onSessionForked,
  modelsRefreshKey,
  chatInputRef: providedChatInputRef,
  onSessionMetadataChange,
  onSessionStatsPanelOpen,
  onOpenFile,
  onChatDisplayChange,
  onChatActionsChange,
  soundEnabled = true,
  playDoneSound = () => {},
  unlockAudio,
}: Props) {
  const { t } = useI18n();
  const localChatInputRef = useRef<ChatInputHandle | null>(null);
  const chatInputRef = providedChatInputRef ?? localChatInputRef;

  // Wrap onAgentEnd to play the completion sound.
  const playDoneSoundRef = useRef(playDoneSound);
  playDoneSoundRef.current = playDoneSound;
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;
  const soundedExtensionDialogIdRef = useRef<string | null>(null);
  const wrappedOnAgentEnd = useCallback(() => {
    if (soundEnabledRef.current) playDoneSoundRef.current();
    onAgentEnd?.();
  }, [onAgentEnd]);

  const {
    historyAnchors,
    starredEntryIds,
    handleStar,
    starPending,
    loading,
    error,
    messages,
    entryIds,
    historyCursor,
    hasEarlierMessages,
    streamState,
    agentRunning,
    bashRunning,
    pendingBash,
    modelNames,
    modelList,
    modelError,
    modelScopeWarnings,
    modelThinkingLevels,
    modelThinkingLevelMaps,
    thinkingLevel,
    retryInfo,
    contextUsage,
    messageActionEntryId,
    branchStatus,
    retryBranchContext,
    isCompacting,
    compactError,
    compactResult,
    displayModel: displayModelValue,
    modelSwitching,
    sessionStats,
    slashCommands,
    slashCommandsLoading,
    queuedMessages,
    notices,
    reportActionError,
    extensionDialog,
    extensionCustomUi,
    extensionStatuses,
    extensionWidgets,
    respondToExtensionUi,
    sendExtensionCustomInput,
    setNoticePaused,
    isAutoModelSelection,
    agentPhase,
    isNew,
    sessionIdRef,
    handleSend,
    handleAbort,
    handleFork,
    handleBranchMessage,
    handleRewind,
    handleModelChange,
    handleCompact,
    handleSteer,
    handleFollowUp,
    handlePromptWithStreamingBehavior,
    handleAbortCompaction,
    handleRecallQueue,
    handleBuiltinSlashCommand,
    handleThinkingLevelChange,
    loadSlashCommands,
    loadEarlierMessages,
    activeLeafId,
    tree,
    systemPrompt,
    systemTools,
    loadSystemInfo,
    refreshTranscript,
    handleLeafChange,
  } = useAgentSession({
    session,
    sessionActive,
    sessionRunning,
    newSessionCwd,
    newSessionDraftKey,
    onAgentEnd: wrappedOnAgentEnd,
    onAttentionNeeded,
    onSessionCreated,
    onSessionForked,
    modelsRefreshKey,
    chatInputRef,
    onSessionMetadataChange,
    onSessionStatsPanelOpen,
  });
  const sessionBusy = agentRunning || bashRunning;
  const readOnly = session?.cwdAvailable === false;
  useSessionInputFocus(
    session?.id ?? newSessionDraftKey,
    !loading && !error && !readOnly,
    chatInputRef,
  );
  const historyActions = useMemo(
    () =>
      readOnly
        ? undefined
        : {
            onFork: (id: string) => {
              void handleFork(id);
            },
            onBranch: (id: string) => {
              void handleBranchMessage(id);
            },
            branchDisabledReason:
              sessionBusy || isCompacting ? t("chat.branchBusy") : undefined,
            pending: messageActionEntryId !== null,
          },
    [
      readOnly,
      handleFork,
      handleBranchMessage,
      sessionBusy,
      isCompacting,
      messageActionEntryId,
      t,
    ],
  );
  const toolEntryIds = useMemo(
    () =>
      new Map(
        messages.flatMap((message, index) =>
          message.role === "toolResult" && entryIds[index]
            ? [[message.toolCallId, entryIds[index]] as [string, string]]
            : [],
        ),
      ),
    [messages, entryIds],
  );
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const initialScrollDoneRef = useRef(false);
  const liveFollowAttachedRef = useRef(true);
  const previousScrollTopRef = useRef(0);
  const previousLeafRef = useRef(activeLeafId);
  const [atTail, setAtTail] = useState(true);

  const syncScrollPosition = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const { scrollTop, clientHeight, scrollHeight } = container;
    liveFollowAttachedRef.current = getLiveFollowAttached(
      liveFollowAttachedRef.current,
      previousScrollTopRef.current,
      scrollTop,
      clientHeight,
      scrollHeight,
    );
    previousScrollTopRef.current = scrollTop;
    setAtTail(isScrollAtTail(scrollTop, clientHeight, scrollHeight));
  }, []);

  const scrollToLatest = useCallback((behavior: ScrollBehavior = "auto") => {
    const container = scrollContainerRef.current;
    if (!container) return;
    liveFollowAttachedRef.current = true;
    container.scrollTo({ top: container.scrollHeight, behavior });
    previousScrollTopRef.current = container.scrollTop;
    setAtTail(
      isScrollAtTail(
        container.scrollTop,
        container.clientHeight,
        container.scrollHeight,
      ),
    );
  }, []);

  const jumpToLatest = useCallback(() => {
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    scrollToLatest(reducedMotion ? "auto" : "smooth");
  }, [scrollToLatest]);

  const compactionControl = useMemo(
    () =>
      session
        ? {
            disabled:
              loading ||
              Boolean(error) ||
              readOnly ||
              (sessionBusy && !isCompacting),
            compacting: isCompacting,
            onClick: isCompacting ? handleAbortCompaction : handleCompact,
          }
        : null,
    [
      session,
      loading,
      error,
      readOnly,
      sessionBusy,
      isCompacting,
      handleAbortCompaction,
      handleCompact,
    ],
  );

  useEffect(() => {
    if (
      !extensionDialog ||
      soundedExtensionDialogIdRef.current === extensionDialog.id
    )
      return;
    soundedExtensionDialogIdRef.current = extensionDialog.id;
    playDoneSoundRef.current();
  }, [extensionDialog]);

  // Register the abort handler for the global Esc shortcut
  useEffect(() => {
    registerAbortHandler(
      sessionBusy
        ? () => {
            void handleAbort();
          }
        : null,
    );
  }, [sessionBusy, handleAbort]);

  // --- Lazy-load historical messages ---
  // Everything loaded is rendered. Paging is the server's `tail`/cursor: when
  // the user scrolls to the top, fetch the previous page and prepend it while
  // keeping the scroll position stable.
  const sentinelRef = useRef<HTMLDivElement>(null);
  const nextPrependIdRef = useRef(0);
  const pendingPrependRef = useRef<{
    id: number;
    distance: number;
    firstEntryId: string | undefined;
  } | null>(null);
  const [completedPrependId, setCompletedPrependId] = useState(0);
  const loadingOlderRef = useRef(false);
  // IntersectionObserver on the sentinel div at the top of the message list.
  // When it becomes visible, load the next page of older messages.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const container = scrollContainerRef.current;
    if (!sentinel || !container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        // No older history loaded yet: fetch the previous page from the server
        // and prepend it. Skip while a page is already loading or nothing older exists.
        if (loadingOlderRef.current) return;
        if (!hasEarlierMessages) return;
        if (!historyCursor) return;
        loadingOlderRef.current = true;
        const id = ++nextPrependIdRef.current;
        pendingPrependRef.current = {
          id,
          distance: captureScrollDistance(
            container.scrollHeight,
            container.scrollTop,
          ),
          firstEntryId: entryIds[0],
        };
        void loadEarlierMessages()
          .then((loaded) => {
            if (pendingPrependRef.current?.id !== id) return;
            if (loaded) setCompletedPrependId(id);
            else pendingPrependRef.current = null;
          })
          .finally(() => {
            loadingOlderRef.current = false;
          });
      },
      { root: container, threshold: 0 },
    );
    observer.observe(sentinel);
    return () => {
      observer.disconnect();
    };
  }, [entryIds, historyCursor, hasEarlierMessages, loadEarlierMessages]);
  // Push session stats up to AppShell for the top bar.
  // Compare scalar fields to avoid loops from new object identity each render.
  const statsKey = sessionStats
    ? [
        sessionStats.sessionId,
        sessionStats.sessionFile ?? "",
        sessionStats.sessionName ?? "",
        sessionStats.userMessages,
        sessionStats.assistantMessages,
        sessionStats.toolCalls,
        sessionStats.toolResults,
        sessionStats.totalMessages,
        sessionStats.tokens.input,
        sessionStats.tokens.output,
        sessionStats.tokens.cacheRead,
        sessionStats.tokens.cacheWrite,
        sessionStats.tokens.total,
        sessionStats.cost ?? 0,
        sessionStats.totalActiveMs ?? 0,
      ].join("|")
    : null;
  const ctxKey = contextUsage
    ? `${contextUsage.percent ?? "null"}|${contextUsage.contextWindow}|${contextUsage.tokens ?? "null"}|${contextUsage.estimated ? "estimated" : "reported"}`
    : null;

  // One publish for everything the shell only displays. The effect is keyed on
  // the same scalar keys the pushes used to be, and reads the latest values
  // from a ref, so a re-render that moves no key publishes nothing.
  const chatDisplayRef = useRef<ChatDisplayState>(EMPTY_CHAT_DISPLAY);
  chatDisplayRef.current = {
    branchTree: tree,
    branchActiveLeafId: activeLeafId,
    systemPrompt,
    systemTools,
    sessionStats,
    contextUsage,
    compactionControl,
  };
  useEffect(() => {
    onChatDisplayChange?.(chatDisplayRef.current);
  }, [
    onChatDisplayChange,
    statsKey,
    ctxKey,
    systemPrompt,
    systemTools,
    tree,
    activeLeafId,
    compactionControl,
  ]);
  useEffect(
    () => () => onChatDisplayChange?.(EMPTY_CHAT_DISPLAY),
    [onChatDisplayChange],
  );

  // The callables the shell invokes. Registered without a cleanup on purpose:
  // a cleanup here would run clear-then-register on any identity change,
  // driving loadSystemInfo real -> null -> real, which bumps AppShell's load id
  // and cancels a System panel load that is still in flight. The clear belongs
  // to unmount alone, below.
  useEffect(() => {
    onChatActionsChange?.({
      loadSystemInfo,
      refreshTranscript: session ? refreshTranscript : null,
      changeBranchLeaf: (...args) => {
        void handleLeafChange(...args);
      },
    });
  }, [
    onChatActionsChange,
    loadSystemInfo,
    refreshTranscript,
    session,
    handleLeafChange,
  ]);
  useEffect(() => () => onChatActionsChange?.(null), [onChatActionsChange]);

  const onDrop = useCallback(
    (files: File[]) => {
      chatInputRef?.current?.addImages(files);
    },
    [chatInputRef],
  );

  const {
    isDragOver,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  } = useDragDrop(onDrop);

  const anchorCount = messages.reduce(
    (count, m) => count + (isMessageGroupAnchor(m) ? 1 : 0),
    0,
  );
  const activeTools = useMemo(
    () =>
      agentPhase?.kind === "running_tools"
        ? new Map(agentPhase.tools.map((tool) => [tool.id, tool]))
        : undefined,
    [agentPhase],
  );

  // Stable Map identity: `messages` doesn't change during streaming updates
  // (the streaming message lives in streamState), so memoized MessageViews
  // skip re-rendering on every message_update event. An inline `new Map()`
  // here used to defeat MessageView's memo() on each streamed chunk.
  const toolResultsMap = useMemo(() => {
    const map = new Map<string, ToolResultMessage>();
    for (const msg of messages) {
      if (msg.role === "toolResult") {
        map.set(msg.toolCallId, msg);
      }
    }
    return map;
  }, [messages]);
  const inputHistory = useMemo(() => {
    const seen = new Set<string>();
    const history: string[] = [];
    messages.findLast((message) => {
      const text = getUserInputText(message);
      if (text && !seen.has(text)) {
        seen.add(text);
        history.push(text);
      }
      return history.length >= 50;
    });
    return history.reverse();
  }, [messages]);
  const messageRefs = useMessageRefs(anchorCount);
  const answerRefs = useRef(new Map<string, HTMLDivElement>());
  const stars = useMemo(() => new Set(starredEntryIds), [starredEntryIds]);
  const isEmptyNew =
    isNew && messages.length === 0 && !streamState.isStreaming && !sessionBusy;
  const hasStreamingContent = Boolean(
    streamState.streamingMessage?.content.length,
  );
  const messageCwd = session?.cwd ?? newSessionCwd ?? undefined;

  // Per-turn derived data, computed once per transcript instead of per render.
  // The split final messages and the written-file list are fresh objects, so
  // rebuilding them on every streamed token defeated MessageView's memo() for
  // each completed turn's final answer. `messages` is stable while streaming
  // (the live message lives in streamState), so this memo holds across tokens.
  const turnGroups = useMemo(() => {
    const groups = new Map<
      number,
      {
        endIdx: number;
        finalAssistantIdx: number;
        visibleProcessMessages: { index: number; message: AgentMessage }[];
        finalProcessMessage: AssistantMessage | null;
        finalAnswerMessage: AssistantMessage | null;
        processCount: number;
        toolCallCount: number;
        defaultExpanded: boolean;
        writtenFiles: WrittenFile[];
      }
    >();
    const anchorIndices = messages.flatMap((message, index) =>
      isMessageGroupAnchor(message) ? [index] : [],
    );
    for (const [anchorPosition, userIdx] of anchorIndices.entries()) {
      const endIdx = anchorIndices[anchorPosition + 1] ?? messages.length;
      const turnMessages = messages.slice(userIdx + 1, endIdx);
      const finalOffset = findFinalAssistantIndex(turnMessages);
      const finalAssistant = turnMessages[finalOffset];
      const finalAssistantIdx =
        finalOffset === -1 ? -1 : userIdx + 1 + finalOffset;
      if (finalAssistant?.role !== "assistant") {
        groups.set(userIdx, {
          endIdx,
          finalAssistantIdx,
          visibleProcessMessages: [],
          finalProcessMessage: null,
          finalAnswerMessage: null,
          processCount: 0,
          toolCallCount: 0,
          defaultExpanded: false,
          writtenFiles: [],
        });
        continue;
      }
      const visibleProcessMessages = turnMessages
        .slice(0, finalOffset)
        .flatMap((message, offset) =>
          hasDisplayableProcessMessage(message)
            ? [{ index: userIdx + 1 + offset, message }]
            : [],
        );
      const finalSplit = splitFinalAssistantBlocks(finalAssistant);
      const finalProcessMessage =
        finalSplit.processBlocks.length > 0
          ? withAssistantBlocks(finalAssistant, finalSplit.processBlocks, {
              omitUsage: true,
            })
          : null;
      const finalAnswerMessage =
        finalSplit.answerBlocks.length > 0 ||
        getAssistantErrorMessage(finalAssistant)
          ? withAssistantBlocks(finalAssistant, finalSplit.answerBlocks)
          : null;
      const processMessages = visibleProcessMessages.map(
        ({ message }) => message,
      );
      const toolCallCount =
        countToolCalls(processMessages) +
        countToolCallBlocks(finalSplit.processBlocks);
      if (finalProcessMessage) processMessages.push(finalProcessMessage);
      // Each tool call is stored as its own assistant entry, so the final
      // answer alone carries no record of what the turn wrote. Gather the
      // turn's assistant blocks and derive the file list from the write/edit
      // calls among them.
      const turnContent: AssistantContentBlock[] = [];
      for (const [offset, m] of turnMessages.entries()) {
        if (offset > finalOffset) break;
        if (m.role === "assistant") {
          for (const b of m.content ?? []) turnContent.push(b);
        }
      }
      groups.set(userIdx, {
        endIdx,
        finalAssistantIdx,
        visibleProcessMessages,
        finalProcessMessage,
        finalAnswerMessage,
        processCount:
          visibleProcessMessages.length + (finalProcessMessage ? 1 : 0),
        toolCallCount,
        defaultExpanded: shouldExpandProcessDetails(processMessages, {
          hasFinalAnswer: Boolean(finalAnswerMessage),
        }),
        writtenFiles: extractTurnWrittenFiles(
          turnContent,
          toolResultsMap,
          messageCwd,
        ),
      });
    }
    return groups;
  }, [messages, toolResultsMap, messageCwd]);

  const scheduleScrollLayout = useAnimationFrameCallback(() => {
    if (liveFollowAttachedRef.current) scrollToLatest();
    else syncScrollPosition();
  });

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    if (previousLeafRef.current !== activeLeafId) {
      previousLeafRef.current = activeLeafId;
      pendingPrependRef.current = null;
      initialScrollDoneRef.current = true;
      scrollToLatest();
      return;
    }

    const pendingPrepend = pendingPrependRef.current;
    if (
      pendingPrepend?.id === completedPrependId &&
      didPrependHistory(pendingPrepend.firstEntryId, entryIds[0])
    ) {
      container.scrollTop = restoreScrollTop(
        container.scrollHeight,
        pendingPrepend.distance,
      );
      pendingPrependRef.current = null;
      previousScrollTopRef.current = container.scrollTop;
      syncScrollPosition();
      return;
    }

    if (!initialScrollDoneRef.current) {
      initialScrollDoneRef.current = true;
      scrollToLatest();
    } else {
      scheduleScrollLayout();
    }
  }, [
    activeLeafId,
    agentPhase,
    completedPrependId,
    entryIds,
    messages,
    pendingBash,
    scheduleScrollLayout,
    scrollToLatest,
    streamState.streamingMessage,
    syncScrollPosition,
  ]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(scheduleScrollLayout);
    observer.observe(container);
    if (container.firstElementChild)
      observer.observe(container.firstElementChild);
    return () => {
      observer.disconnect();
    };
  }, [error, loading, scheduleScrollLayout]);

  const availableThinkingLevels = displayModelValue
    ? (modelThinkingLevels[
        `${displayModelValue.provider}:${displayModelValue.modelId}`
      ] ?? null)
    : null;

  const currentThinkingLevelMap = displayModelValue
    ? (modelThinkingLevelMaps[
        `${displayModelValue.provider}:${displayModelValue.modelId}`
      ] ?? null)
    : null;

  const chatInputElement = readOnly ? (
    <div role="status" className="project-folder-message">
      {t("chat.missingWorkingFolder")}
    </div>
  ) : (
    <ChatInput
      ref={chatInputRef}
      onError={reportActionError}
      onSend={(...args) => {
        void handleSend(...args);
      }}
      onAbort={(...args) => {
        void handleAbort(...args);
      }}
      onSteer={
        agentRunning
          ? (...args) => {
              void handleSteer(...args);
            }
          : undefined
      }
      onFollowUp={
        agentRunning
          ? (...args) => {
              void handleFollowUp(...args);
            }
          : undefined
      }
      onPromptWithStreamingBehavior={
        agentRunning
          ? (...args) => {
              void handlePromptWithStreamingBehavior(...args);
            }
          : undefined
      }
      isStreaming={sessionBusy}
      submissionDisabled={branchStatus !== null}
      model={displayModelValue}
      isAutoModelSelection={isAutoModelSelection}
      modelNames={modelNames}
      modelList={modelList}
      modelError={modelError}
      modelScopeWarnings={modelScopeWarnings}
      onModelChange={(...args) => {
        void handleModelChange(...args);
      }}
      modelSwitching={modelSwitching}
      isCompacting={isCompacting}
      compactError={compactError}
      compactResult={compactResult}
      thinkingLevel={thinkingLevel}
      onThinkingLevelChange={
        session || isNew
          ? (...args) => {
              void handleThinkingLevelChange(...args);
            }
          : undefined
      }
      availableThinkingLevels={availableThinkingLevels}
      thinkingLevelMap={currentThinkingLevelMap}
      extensionStatuses={extensionStatuses}
      retryInfo={retryInfo}
      queuedMessages={queuedMessages}
      inputHistory={inputHistory}
      onRecallQueue={(...args) => {
        void handleRecallQueue(...args);
      }}
      slashCommands={slashCommands}
      slashCommandsLoading={slashCommandsLoading}
      onLoadSlashCommands={loadSlashCommands}
      onBuiltinCommand={handleBuiltinSlashCommand}
      onAudioUnlock={unlockAudio}
      draftKey={session?.id ?? newSessionDraftKey ?? undefined}
      cwd={session?.cwd ?? newSessionCwd}
    />
  );

  if (loading) {
    return <div className="chat-status">{t("chat.loadingSession")}</div>;
  }

  if (error) {
    return <div className="chat-status is-error">{error}</div>;
  }

  return (
    <section
      className={`chat-window${isEmptyNew ? " is-empty" : ""}`}
      aria-label={t("chat.messages")}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className="chat-drop-zone">
          <div className="chat-drop-zone-ripples">
            {[0, 0.8, 1.6].map((delay) => (
              <div
                key={delay}
                className="chat-drop-zone-ripple"
                style={{
                  transformOrigin: "center",
                  animationDelay: `${delay}s`,
                }}
              />
            ))}
          </div>
          <svg
            width="280"
            height="280"
            viewBox="0 0 140 140"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="chat-drop-zone-icon"
          >
            <rect
              x="28"
              y="44"
              width="84"
              height="60"
              rx="8"
              fill="rgba(37,99,235,0.08)"
              stroke="rgba(37,99,235,0.50)"
              strokeWidth="1.8"
            />
            <path
              d="M36 100 L54 72 L68 88 L80 74 L104 100Z"
              fill="rgba(37,99,235,0.16)"
              stroke="rgba(37,99,235,0.40)"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <circle
              cx="96"
              cy="58"
              r="8"
              fill="rgba(37,99,235,0.22)"
              stroke="rgba(37,99,235,0.55)"
              strokeWidth="1.6"
            />
            <g
              stroke="rgba(37,99,235,0.45)"
              strokeWidth="1.4"
              strokeLinecap="round"
            >
              <line x1="96" y1="46" x2="96" y2="43" />
              <line x1="96" y1="70" x2="96" y2="73" />
              <line x1="84" y1="58" x2="81" y2="58" />
              <line x1="108" y1="58" x2="111" y2="58" />
              <line x1="87.5" y1="49.5" x2="85.4" y2="47.4" />
              <line x1="104.5" y1="66.5" x2="106.6" y2="68.6" />
              <line x1="104.5" y1="49.5" x2="106.6" y2="47.4" />
              <line x1="87.5" y1="66.5" x2="85.4" y2="68.6" />
            </g>
          </svg>
        </div>
      )}

      {extensionDialog && (
        <ExtensionDialog
          request={extensionDialog}
          onRespond={(...args) => {
            void respondToExtensionUi(...args);
          }}
        />
      )}

      {extensionCustomUi && (
        <ExtensionCustomPanel
          request={extensionCustomUi}
          onInput={(...args) => {
            void sendExtensionCustomInput(...args);
          }}
        />
      )}

      <div className="chat-notices">
        <NoticeShelf
          notices={notices}
          floating
          onPauseChange={setNoticePaused}
        />
      </div>

      <div className="chat-body">
        <div
          ref={scrollContainerRef}
          className="chat-scroll"
          onScroll={syncScrollPosition}
        >
          <div className="chat-scroll-content">
            <div className="chat-transcript">
              {isEmptyNew && (
                <header className="chat-empty">
                  <h1>
                    <span aria-hidden="true">π</span>
                    <span>Pi Web</span>
                  </h1>
                </header>
              )}
              {(() => {
                // A compaction summary can replace the last user message while
                // its turn is still streaming, so it also counts as a live tail.
                const lastAnchorIdx =
                  messages.findLastIndex(isMessageGroupAnchor);

                // Only group anchors get a minimap ref — one dot per turn.
                const anchorRefIndexByMessage = new Map<number, number>();
                const timestampIndices = new Set<number>();
                let lastAssistantIdx: number | undefined;
                let refIdx = 0;
                messages.forEach((msg, idx) => {
                  if (isMessageGroupAnchor(msg))
                    anchorRefIndexByMessage.set(idx, refIdx++);
                  if (msg.role === "assistant") lastAssistantIdx = idx;
                  else if (
                    msg.role === "user" &&
                    lastAssistantIdx !== undefined
                  ) {
                    timestampIndices.add(lastAssistantIdx);
                    lastAssistantIdx = undefined;
                  }
                });
                if (lastAssistantIdx !== undefined)
                  timestampIndices.add(lastAssistantIdx);

                const renderKeyForIndex = (idx: number) =>
                  entryIds[idx] ?? `live:${idx}`;
                const attachVisibleRef =
                  (refIndex: number | undefined) =>
                  (el: HTMLDivElement | null) => {
                    if (refIndex !== undefined)
                      messageRefs.current[refIndex] = el;
                  };

                const renderMessage = (
                  idx: number,
                  msg: AgentMessage,
                  options: {
                    attachRef?: boolean;
                    keyPrefix?: string;
                    showTimestamp?: boolean;
                    writtenFiles?: WrittenFile[];
                    finalAnswer?: boolean;
                  } = {},
                ): ReactNode => {
                  const previousMessage = messages[idx - 1];
                  const isVisible =
                    isMessageGroupAnchor(msg) || msg.role === "assistant";
                  const currentRefIdx = anchorRefIndexByMessage.get(idx);
                  const keyPrefix = options.keyPrefix ?? "message";
                  const messageKey = renderKeyForIndex(idx);
                  let showTimestamp = false;
                  if (msg.role === "assistant") {
                    showTimestamp = timestampIndices.has(idx);
                    // Hide on the currently-streaming tail (the streaming bubble owns the live timestamp)
                    if (
                      showTimestamp &&
                      streamState.isStreaming &&
                      idx === messages.length - 1
                    ) {
                      showTimestamp = false;
                    }
                  }
                  if (options.showTimestamp !== undefined)
                    showTimestamp = options.showTimestamp;
                  const view = (
                    <MessageView
                      key={`${keyPrefix}-view-${messageKey}`}
                      message={msg}
                      onError={reportActionError}
                      toolResults={toolResultsMap}
                      activeTools={activeTools}
                      modelNames={modelNames}
                      cwd={messageCwd}
                      onOpenFile={onOpenFile}
                      entryId={entryIds[idx]}
                      starred={stars.has(entryIds[idx] ?? "")}
                      starPending={starPending}
                      onStar={
                        (options.finalAnswer ||
                          (options.attachRef !== false &&
                            stars.has(entryIds[idx] ?? ""))) &&
                        !readOnly &&
                        !session?.transient
                          ? handleStar
                          : undefined
                      }
                      historyActions={historyActions}
                      toolEntryIds={toolEntryIds}
                      onRewind={
                        readOnly ||
                        sessionBusy ||
                        isCompacting ||
                        isNew ||
                        messageActionEntryId
                          ? undefined
                          : (...args) => {
                              void handleRewind(...args);
                            }
                      }
                      showTimestamp={showTimestamp}
                      prevTimestamp={previousMessage?.timestamp}
                      sessionId={
                        session?.id ?? sessionIdRef.current ?? undefined
                      }
                      writtenFiles={options.writtenFiles}
                    />
                  );
                  if (!isVisible || options.attachRef === false) return view;
                  return (
                    <div
                      key={`${keyPrefix}-${messageKey}`}
                      ref={(element) => {
                        attachVisibleRef(currentRefIdx)(element);
                        const id = entryIds[idx];
                        if (
                          (options.finalAnswer || stars.has(id ?? "")) &&
                          id
                        ) {
                          if (element) answerRefs.current.set(id, element);
                          else answerRefs.current.delete(id);
                        }
                      }}
                    >
                      {view}
                    </div>
                  );
                };

                const rendered: ReactNode[] = [];
                const firstAnchorIndex =
                  messages.findIndex(isMessageGroupAnchor);
                const prefixEnd =
                  firstAnchorIndex === -1 ? messages.length : firstAnchorIndex;
                const prefixFinalIndex = findFinalAssistantIndex(
                  messages.slice(0, prefixEnd),
                );
                let renderedThrough = 0;
                for (const [idx, msg] of messages.entries()) {
                  if (idx < renderedThrough) continue;
                  const turn = isMessageGroupAnchor(msg)
                    ? turnGroups.get(idx)
                    : undefined;
                  if (!turn) {
                    rendered.push(
                      renderMessage(idx, msg, {
                        finalAnswer:
                          idx === prefixFinalIndex &&
                          hasFinalAssistantAnswer(msg) &&
                          (prefixEnd < messages.length ||
                            (!sessionBusy && !streamState.isStreaming)),
                      }),
                    );
                    continue;
                  }

                  const userIdx = idx;
                  const {
                    endIdx,
                    finalAssistantIdx,
                    visibleProcessMessages,
                    finalProcessMessage,
                    finalAnswerMessage,
                    processCount,
                  } = turn;
                  const isLiveTail =
                    (sessionBusy || streamState.isStreaming) &&
                    endIdx === messages.length &&
                    userIdx === lastAnchorIdx;
                  if (finalAssistantIdx === -1 || isLiveTail) {
                    for (const [offset, message] of messages
                      .slice(userIdx, endIdx)
                      .entries()) {
                      rendered.push(renderMessage(userIdx + offset, message));
                    }
                    renderedThrough = endIdx;
                    continue;
                  }

                  rendered.push(renderMessage(userIdx, msg));

                  if (processCount > 0) {
                    const processGroup = (
                      <ProcessDetailsGroup
                        messageCount={processCount}
                        defaultExpanded={turn.defaultExpanded}
                        t={t}
                        toolCallCount={turn.toolCallCount}
                      >
                        {visibleProcessMessages.map(({ index, message }) =>
                          renderMessage(index, message, {
                            attachRef: false,
                            keyPrefix: "process",
                          }),
                        )}
                        {finalProcessMessage &&
                          renderMessage(
                            finalAssistantIdx,
                            finalProcessMessage,
                            {
                              attachRef: false,
                              keyPrefix: "process-final",
                              showTimestamp: false,
                            },
                          )}
                      </ProcessDetailsGroup>
                    );
                    rendered.push(
                      <Fragment
                        key={`process-group-${renderKeyForIndex(userIdx)}-${renderKeyForIndex(finalAssistantIdx)}`}
                      >
                        {processGroup}
                      </Fragment>,
                    );
                  }

                  if (finalAnswerMessage) {
                    rendered.push(
                      renderMessage(finalAssistantIdx, finalAnswerMessage, {
                        writtenFiles: turn.writtenFiles,
                        finalAnswer: finalAnswerMessage.content.some(
                          (block) =>
                            block.type === "text" || block.type === "image",
                        ),
                      }),
                    );
                  }
                  for (const [offset, message] of messages
                    .slice(finalAssistantIdx + 1, endIdx)
                    .entries()) {
                    rendered.push(
                      renderMessage(finalAssistantIdx + 1 + offset, message),
                    );
                  }
                  renderedThrough = endIdx;
                }
                return (
                  <>
                    {hasEarlierMessages && (
                      <div ref={sentinelRef} className="chat-load-earlier">
                        {t("chat.loadEarlier")}
                      </div>
                    )}
                    {rendered}
                  </>
                );
              })()}
              {streamState.isStreaming &&
                hasStreamingContent &&
                streamState.streamingMessage && (
                  <MessageView
                    message={streamState.streamingMessage}
                    onError={reportActionError}
                    activeTools={activeTools}
                    isStreaming
                    modelNames={modelNames}
                    cwd={messageCwd}
                    onOpenFile={onOpenFile}
                  />
                )}

              {agentRunning &&
                !hasStreamingContent &&
                agentPhase &&
                agentPhase.kind !== "waiting_model" && (
                  <div className="chat-activity">
                    <span className="chat-activity-label">
                      {phaseLabel(agentPhase, t)}
                    </span>
                  </div>
                )}

              {bashRunning && !pendingBash && (
                <div className="chat-activity">
                  <span className="chat-activity-label">
                    {t("chat.runningCommand")}
                  </span>
                </div>
              )}

              {pendingBash && (
                <MessageView
                  message={{
                    role: "bashExecution",
                    command: pendingBash.command,
                    output: "",
                    excludeFromContext: pendingBash.excludeFromContext,
                  }}
                  sessionId={session?.id ?? sessionIdRef.current ?? undefined}
                />
              )}
            </div>
          </div>
        </div>
        <ChatJumpToLatest visible={!atTail} onClick={jumpToLatest} />
        <ChatMinimap
          key={`${session?.id ?? "draft"}:${activeLeafId ?? ""}`}
          messages={messages}
          entryIds={entryIds}
          tree={tree}
          activeLeafId={activeLeafId}
          onLeafChange={handleLeafChange}
          branchDisabled={
            loading ||
            sessionBusy ||
            isCompacting ||
            messageActionEntryId !== null ||
            branchStatus === "pending"
          }
          historyAnchors={historyAnchors}
          starredEntryIds={starredEntryIds}
          answerRefs={answerRefs}
          onLoadThrough={loadEarlierMessages}
          scrollContainer={scrollContainerRef}
          messageRefs={messageRefs}
        />
      </div>

      <footer className="chat-composer">
        {branchStatus && (
          <div
            className="branch-sync-notice"
            role={branchStatus === "failed" ? "alert" : "status"}
          >
            <span>
              {t(
                branchStatus === "failed"
                  ? "chat.branchSyncFailed"
                  : "chat.branchSyncPending",
              )}
            </span>
            {branchStatus === "failed" && (
              <button
                type="button"
                className="history-action"
                onClick={() => {
                  void retryBranchContext();
                }}
              >
                {t("chat.retryBranchHistory")}
              </button>
            )}
          </div>
        )}
        {chatInputElement}
        <ExtensionStatusBar
          statuses={extensionStatuses}
          widgets={extensionWidgets}
        />
      </footer>
    </section>
  );
}

// Toast height cap; the text area cap subtracts vertical padding (14*2) and borders (1*2).
const NOTICE_MAX_HEIGHT_PX = 500;
const NOTICE_TEXT_MAX_HEIGHT_PX = NOTICE_MAX_HEIGHT_PX - 30;

function NoticeShelf({
  notices,
  floating = false,
  onPauseChange,
}: {
  notices: NoticeItem[];
  floating?: boolean;
  onPauseChange?: (id: string | null) => void;
}) {
  if (notices.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        // Right-anchored: every toast's right edge aligns here, widths extend leftward
        alignItems: "flex-end",
        marginBottom: floating ? 0 : 10,
      }}
    >
      {notices.map((notice, index) => {
        const color =
          notice.type === "error"
            ? "var(--danger)"
            : notice.type === "warning"
              ? "var(--warning)"
              : notice.type === "success"
                ? "var(--success)"
                : "var(--accent)";
        return (
          <div
            key={notice.id}
            className="notice-shelf-item"
            role={notice.type === "error" ? "alert" : "status"}
            onMouseEnter={() => onPauseChange?.(notice.id)}
            onMouseLeave={(event) => {
              if (!event.currentTarget.contains(document.activeElement))
                onPauseChange?.(null);
            }}
            onFocus={() => onPauseChange?.(notice.id)}
            onBlur={(event) => {
              if (!event.currentTarget.matches(":hover")) onPauseChange?.(null);
            }}
            style={{
              display: "flex",
              // Top-align children so the type dot sits by the first line on multi-line toasts
              alignItems: "flex-start",
              gap: 10,
              minHeight: 60,
              height: "auto",
              // Height cap: overflow scrolls inside the text span below (see its overflowY);
              // the container stays hidden so the type dot stays pinned at the top.
              maxHeight: NOTICE_MAX_HEIGHT_PX,
              // The floating wrapper is pointerEvents:"none" (click-through by design),
              // so the toast itself must opt back into interactivity or hover events never reach it
              pointerEvents: "auto",
              marginBottom: index === notices.length - 1 ? 0 : 6,
              overflow: "hidden",
              borderRadius: 14,
              border:
                "1px solid color-mix(in srgb, var(--border) 70%, transparent)",
              background: "var(--bg)",
              color: "var(--text-muted)",
              width: "fit-content",
              maxWidth: "min(100%, 620px)",
              boxShadow: floating
                ? "0 1px 2px rgba(15,23,42,0.05), 0 10px 28px -14px rgba(15,23,42,0.24)"
                : "0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -12px rgba(15,23,42,0.10)",
              fontSize: 14,
              lineHeight: 1.5,
              transformOrigin: "top right",
              // Use backwards fill for the entrance animation so height styles return to
              // inline styles once it finishes; otherwise the keyframe's fixed 60px would
              // stick around in fill mode and permanently clamp the expanded toast
              animation: notice.exiting
                ? "notice-shelf-out 0.18s ease-in forwards"
                : "notice-shelf-in 0.18s ease-out backwards",
              padding: "0 12px",
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: color,
                flexShrink: 0,
                // Align with the optical center of the first text line: 14px vertical
                // padding + (21px line box - 7px dot) / 2
                marginTop: 21,
              }}
            />
            {/* Full text by default: pre-line preserves \n (nowrap/normal collapse
                newlines into spaces) and long lines wrap instead of truncating;
                content taller than the cap scrolls inside the text area */}
            <span
              tabIndex={0}
              style={{
                padding: "14px 0",
                minWidth: 0,
                maxWidth: "100%",
                maxHeight: NOTICE_TEXT_MAX_HEIGHT_PX,
                overflowY: "auto",
                scrollbarWidth: "thin",
                whiteSpace: "pre-line",
                wordBreak: "break-word",
              }}
            >
              {notice.message}
            </span>
          </div>
        );
      })}
    </div>
  );
}

type ExtensionDialogRequest = Extract<
  ExtensionUiRequest,
  { method: "select" | "confirm" | "input" | "editor" }
>;

export function ExtensionDialog({
  request,
  onRespond,
}: {
  request: ExtensionDialogRequest;
  onRespond: (
    request: ExtensionDialogRequest,
    response: { value: string } | { confirmed: boolean } | { cancelled: true },
  ) => void;
}) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(
    request.method === "editor" ? (request.prefill ?? "") : "",
  );

  useEffect(() => {
    setValue(request.method === "editor" ? (request.prefill ?? "") : "");
  }, [request]);

  // showModal() supplies the backdrop, focus trap, top layer and focus
  // restoration this overlay had none of. It also puts focus inside the
  // dialog for the confirm and select methods, which render no field.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  const submitValue = () => {
    if (request.method === "confirm") {
      onRespond(request, { confirmed: true });
    } else {
      onRespond(request, { value });
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="extension-dialog"
      aria-label={request.title}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        // Own the key so the global Esc shortcut cannot abort the turn that is
        // waiting on this request.
        event.preventDefault();
        onRespond(request, { cancelled: true });
      }}
      onCancel={(event) => {
        event.preventDefault();
      }}
    >
      <div
        style={{
          width: "min(560px, 100%)",
          maxHeight: "min(760px, 100%)",
          display: "flex",
          flexDirection: "column",
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "var(--bg)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.28)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            flexShrink: 0,
            padding: "12px 14px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div style={{ color: "var(--text)", fontSize: 14, fontWeight: 650 }}>
            {request.title}
          </div>
          <div
            style={{
              marginTop: 3,
              color: "var(--text-dim)",
              fontSize: 11,
              fontFamily: "var(--font-mono)",
            }}
          >
            {t("chat.extensionRequest")}
          </div>
        </div>

        <div
          style={{
            padding: 14,
            ...(request.method === "select"
              ? { flex: "1 1 auto", minHeight: 0, overflowY: "auto" }
              : {}),
          }}
        >
          {request.method === "confirm" && (
            <div
              style={{
                color: "var(--text-muted)",
                fontSize: 13,
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
              }}
            >
              {request.message}
            </div>
          )}
          {request.method === "select" && (
            <div style={{ display: "grid", gap: 8 }}>
              {request.options.map((option) => (
                <button
                  key={option}
                  onClick={() => {
                    onRespond(request, { value: option });
                  }}
                  style={{
                    width: "100%",
                    padding: "9px 10px",
                    borderRadius: 7,
                    border: "1px solid var(--border)",
                    background: "var(--bg-panel)",
                    color: "var(--text)",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: 13,
                    overflowWrap: "anywhere",
                  }}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
          {request.method === "input" && (
            <input
              autoFocus
              value={value}
              placeholder={request.placeholder}
              onChange={(e) => {
                setValue(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitValue();
              }}
              style={{
                width: "100%",
                padding: "9px 10px",
                borderRadius: 7,
                border: "1px solid var(--border)",
                background: "var(--bg-panel)",
                color: "var(--text)",
                outline: "none",
                fontSize: 13,
              }}
            />
          )}
          {request.method === "editor" && (
            <textarea
              autoFocus
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
              }}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter")
                  submitValue();
              }}
              style={{
                width: "100%",
                minHeight: 220,
                padding: 10,
                borderRadius: 7,
                border: "1px solid var(--border)",
                background: "var(--bg-panel)",
                color: "var(--text)",
                outline: "none",
                resize: "vertical",
                fontSize: 13,
                lineHeight: 1.55,
                fontFamily: "var(--font-mono)",
              }}
            />
          )}
        </div>

        <div
          style={{
            flexShrink: 0,
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            padding: "10px 14px",
            borderTop: "1px solid var(--border)",
            background: "var(--bg-panel)",
          }}
        >
          <button
            onClick={() => {
              onRespond(request, { cancelled: true });
            }}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            {t("chat.cancel")}
          </button>
          {request.method === "confirm" ? (
            <button
              onClick={submitValue}
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid var(--accent)",
                background: "var(--accent)",
                color: "var(--on-accent)",
                cursor: "pointer",
              }}
            >
              {t("chat.confirm")}
            </button>
          ) : request.method !== "select" ? (
            <button
              onClick={submitValue}
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid var(--accent)",
                background: "var(--accent)",
                color: "var(--on-accent)",
                cursor: "pointer",
              }}
            >
              {t("chat.submit")}
            </button>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}

type ExtensionCustomRequest = Extract<ExtensionUiRequest, { method: "custom" }>;

function ExtensionCustomPanel({
  request,
  onInput,
}: {
  request: ExtensionCustomRequest;
  onInput: (request: ExtensionCustomRequest, data: string) => void;
}) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const displayLines = normalizeCustomPanelLines(request.lines);

  useEffect(() => {
    inputRef.current?.focus();
  }, [request.id]);

  // showModal() supplies the backdrop, focus trap, top layer and focus
  // restoration this overlay had none of.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="extension-dialog"
      aria-label={t("chat.extensionInput")}
      // The textarea forwards Escape to the TUI as \x1b, so the dialog must
      // never treat it as a request to close.
      onCancel={(event) => {
        event.preventDefault();
      }}
    >
      <div
        onClick={(event) => {
          if (!(event.target as HTMLElement).closest("button"))
            inputRef.current?.focus();
        }}
        style={{
          position: "relative",
          width: "min(920px, 100%)",
          maxHeight: "min(760px, calc(100vh - 40px))",
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "var(--bg)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.28)",
          overflow: "hidden",
          outline: "none",
        }}
      >
        <textarea
          ref={inputRef}
          aria-label={t("chat.extensionInput")}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onKeyDown={(event) => {
            if (composingRef.current || event.nativeEvent.isComposing) return;
            const data = toTerminalKeyData(event);
            if (!data) return;
            event.preventDefault();
            event.stopPropagation();
            onInput(request, data);
          }}
          onInput={(event) => {
            if (composingRef.current || event.nativeEvent.isComposing) return;
            const text = event.currentTarget.value;
            event.currentTarget.value = "";
            if (text) onInput(request, text);
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={(event) => {
            composingRef.current = false;
            const input = event.currentTarget;
            queueMicrotask(() => {
              const text = input.value;
              input.value = "";
              if (text) onInput(request, text);
            });
          }}
          onPaste={(event) => {
            event.preventDefault();
            const text = event.clipboardData.getData("text");
            if (text) onInput(request, asBracketedPaste(text));
          }}
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            padding: 0,
            border: 0,
            opacity: 0,
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "10px 12px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 650 }}>
            {t("chat.extensionPanel")}
          </div>
          <button
            onClick={() => {
              onInput(request, "\x03");
            }}
            style={{
              padding: "5px 9px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg-panel)",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            {t("chat.close")}
          </button>
        </div>
        <pre
          style={{
            margin: 0,
            padding: 14,
            maxHeight: "calc(min(760px, 100vh - 40px) - 48px)",
            overflow: "auto",
            background: "var(--bg-panel)",
            color: "var(--text)",
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            lineHeight: 1.45,
            whiteSpace: "pre",
          }}
        >
          <AnsiText text={displayLines.join("\n")} />
        </pre>
      </div>
    </dialog>
  );
}
