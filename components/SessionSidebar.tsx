"use client";

import { useEffect, useId, useLayoutEffect, useState, useCallback, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import { errorMessage } from "@/lib/error-message";
import { createClientId } from "@/lib/client-id";
import { SettingsSectionIcon } from "./SettingsPanel";
import type { SessionInfo } from "@/lib/types";
import { SESSION_METADATA_BATCH_SIZE, type SessionRowMetadata } from "@/lib/session-metadata-types";
import {
  canAcceptInventoryResult,
  hasSessionRowMetadata,
  sessionInfoFingerprint as sessionFingerprint,
} from "@/lib/transcript-refresh";
import { loadExplorerOpen, saveExplorerOpen } from "@/lib/file-explorer-state";
import { getBrowserStorage } from "@/lib/browser-storage";
import { getProjectActivity, getRecentProjects, sessionsForProject } from "@/lib/project-groups";
import { workspaceKeyOf } from "@/lib/workspace-memory";
import { useI18n } from "@/hooks/useI18n";
import { DirectoryPicker } from "./DirectoryPicker";
import { FileExplorer, type FileExplorerHandle } from "./FileExplorer";
import { ProjectFolderGroup } from "./ProjectFolderGroup";
import { PiWebTitle } from "./PiWebTitle";
import { SESSION_ITEM_HEIGHT, SessionItem } from "./SessionItem";

declare global {
  interface Window {
    piDesktop?: {
      selectDirectory: () => Promise<string | null>;
    };
  }
}

function ToolbarIconButton({
  onClick,
  title,
  disabled,
  skipHover,
  color,
  background = "none",
  marginRight,
  ariaPressed,
  children,
}: {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  skipHover?: boolean;
  color: string;
  background?: string;
  marginRight?: number;
  ariaPressed?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={ariaPressed}
      className={`sidebar-toolbar-button${skipHover ? " is-hover-locked" : ""}`}
      style={{
        marginRight,
        "--toolbar-button-color": color,
        "--toolbar-button-background": background,
      } as CSSProperties}
    >
      {children}
    </button>
  );
}

interface Props {
  /** The server's home directory, read once in the page rather than fetched. */
  homeDir: string;
  selectedSessionId: string | null;
  onSelectSession: (session: SessionInfo, isRestore?: boolean) => void;
  onNewSession?: (sessionId: string, cwd: string) => void;
  initialSessionId?: string | null;
  skipInitialProjectSelection?: boolean;
  onInitialRestoreDone?: () => void;
  refreshKey?: number;
  onSessionDeleted?: (sessionId: string) => void;
  selectedCwd?: string | null;
  onCwdChange?: (
    cwd: string | null,
    projectRoot?: string | null,
    projectKey?: string | null,
  ) => void;
  onOpenFile?: (filePath: string, fileName: string, options?: { sourceSessionId?: string | null; modeHint?: "diff" }) => void;
  explorerRefreshKey?: number;
  onExplorerRefresh?: () => void;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  onAtMentions?: (relativePaths: string[]) => void;
  /** Fired when a session that is not currently selected finishes running.
   *  Lets the app play a cross-workspace completion tone. */
  onBackgroundTaskDone?: () => void;
  onActiveSessionIdsChange?: (ids: Set<string>) => void;
  onRunningSessionIdsChange?: (ids: Set<string>) => void;
  beginSessionInventoryAttempt: () => number;
  onSessionsChange?: (sessions: SessionInfo[], inventoryAttempt: number) => void;
  onRefreshSelectedSession?: () => Promise<boolean>;
  actionsAvailable: boolean;
  /** Opens the settings dialog at the last used section. */
  onOpenSettings: () => void;
}

interface WorktreeEntry {
  path: string;
  branch: string | null;
}

interface WorktreeState {
  /** The cwd this data was fetched for — guards against stale responses */
  forCwd: string;
  projectRoot: string;
  /** Stable server-computed identity; never derive OS path semantics here. */
  projectKey: string;
  isGit: boolean;
  /** Subdirectory sessions keep their own project identity. */
  isTopLevel: boolean;
  /** Canonical path of the checkout containing forCwd, resolved server-side. */
  currentWorktreePath: string | null;
  worktrees: WorktreeEntry[];
}

interface ProjectSelection {
  root: string;
  key: string;
}

interface ValidatedProject {
  cwd: string;
  root: string;
  key: string;
}

const UNREAD_SESSIONS_STORAGE_KEY = "pi-web:unread-session-ids";
const LAST_CUSTOM_CWD_STORAGE_KEY = "pi-web:last-custom-cwd";
const RUNNING_SESSIONS_POLL_MS = 2500;
const SESSION_METADATA_RETRY_DELAY_MS = 1000;
const SESSION_METADATA_OVERSCAN_PX = SESSION_ITEM_HEIGHT * 2;

/** True when both id sets hold the same members. Lets a poll result that
 *  changed nothing keep the previous Set, so an idle sidebar does not
 *  re-render every RUNNING_SESSIONS_POLL_MS. */
export function sameSessionIds(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...b].every((id) => a.has(id));
}

function loadLastCustomCwd(): string {
  try {
    return getBrowserStorage()?.getItem(LAST_CUSTOM_CWD_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveLastCustomCwd(cwd: string): void {
  try {
    getBrowserStorage()?.setItem(LAST_CUSTOM_CWD_STORAGE_KEY, cwd);
  } catch {
    // Persistence is best-effort.
  }
}

function loadUnreadSessionIds(): Set<string> {
  try {
    const raw = getBrowserStorage()?.getItem(UNREAD_SESSIONS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return new Set(parsed.filter((id): id is string => typeof id === "string"));
    return new Set();
  } catch {
    return new Set();
  }
}

function saveUnreadSessionIds(ids: Set<string>): void {
  try {
    const storage = getBrowserStorage();
    if (ids.size === 0) storage?.removeItem(UNREAD_SESSIONS_STORAGE_KEY);
    else storage?.setItem(UNREAD_SESSIONS_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // ignore storage quota / privacy-mode errors
  }
}

/** Substitute the home dir prefix with ~ (no path truncation — see PathLabel) */
function displayCwd(cwd: string, homeDir?: string): string {
  return (homeDir && cwd.startsWith(homeDir)) ? "~" + cwd.slice(homeDir.length) : cwd;
}

/**
 * Path label that ellipsizes on the LEFT, keeping the (most relevant) trailing
 * segments visible: "…orkspace/pi-web". Shows as much of the path as fits
 * instead of a fixed number of segments. The rtl container moves the ellipsis
 * to the left edge; the inner plaintext bidi isolation keeps the path itself
 * rendered strictly left-to-right (no punctuation reordering).
 */
function PathLabel({ text, style }: { text: string; style?: CSSProperties }) {
  return (
    <span
      style={{
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        display: "block",
        minWidth: 0,
        lineHeight: 1.35,
        direction: "rtl",
        textAlign: "left",
        ...style,
      }}
    >
      <span style={{ unicodeBidi: "plaintext" }}>{text}</span>
    </span>
  );
}

/** A dropdown panel shown as a native popover, anchored by CSS to its trigger. */
function AnchoredMenu({
  id, open, onOpenChange, anchorClass, children, style,
}: {
  id: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorClass: string;
  children: ReactNode;
  style: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof el.showPopover !== "function") return;
    if (open) { if (!el.matches(":popover-open")) el.showPopover(); }
    else if (el.matches(":popover-open")) el.hidePopover();
  }, [open]);

  return (
    <div
      ref={ref}
      id={id}
      popover="auto"
      className={`anchored-menu menu-surface opens-down ${anchorClass}`}
      // The trigger opens this through popovertarget, so the browser toggles
      // it and state follows. Tracking both directions matters: a UA-driven
      // open that React never learned about would be closed again by the
      // effect above on the next render.
      onToggle={(e) => onOpenChange((e as unknown as { newState?: string }).newState === "open")}
      style={style}
    >
      {children}
    </div>
  );
}

export function SessionSidebar({ homeDir, selectedSessionId, onSelectSession, onNewSession, initialSessionId, skipInitialProjectSelection, onInitialRestoreDone, refreshKey, onSessionDeleted, selectedCwd: selectedCwdProp, onCwdChange, onOpenFile, explorerRefreshKey, onExplorerRefresh, onAtMention, onAtMentions, onBackgroundTaskDone, onActiveSessionIdsChange, onRunningSessionIdsChange, beginSessionInventoryAttempt, onSessionsChange, onRefreshSelectedSession, actionsAvailable, onOpenSettings }: Props) {
  const { t } = useI18n();
  const projectMenuId = useId();
  const [allSessions, setAllSessions] = useState<SessionInfo[]>([]);
  const [inventoryRevision, setInventoryRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCwd, setSelectedCwd] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [projectFilter, setProjectFilter] = useState("");
  const [customPathOpen, setCustomPathOpen] = useState(false);
  const [customPathValue, setCustomPathValue] = useState(loadLastCustomCwd);
  const [customPathError, setCustomPathError] = useState<string | null>(null);
  const [customPathValidating, setCustomPathValidating] = useState(false);
  const [validatedProject, setValidatedProject] = useState<ValidatedProject | null>(null);
  // Worktree switcher state
  const [worktreeState, setWorktreeState] = useState<WorktreeState | null>(null);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [explorerKey, setExplorerKey] = useState(0);
  const [explorerUploadBusy, setExplorerUploadBusy] = useState(false);
  const [fileSearchOpen, setFileSearchOpen] = useState(false);
  const [changesCount, setChangesCount] = useState(0);
  const [changesCollapsed, setChangesCollapsed] = useState(true);
  const [sessionRefreshDone, setSessionRefreshDone] = useState(false);
  const [explorerRefreshDone, setExplorerRefreshDone] = useState(false);
  const [activeSessionIds, setActiveSessionIds] = useState<Set<string>>(() => new Set());
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(() => new Set());
  const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(() => loadUnreadSessionIds());
  const [shortcutModifier, setShortcutModifier] = useState<"ctrl" | "meta" | null>(null);
  const previousRunningSessionIdsRef = useRef<Set<string>>(new Set());
  // Once polling has delivered a snapshot it is the source of truth for
  // running state; late /api/sessions responses must not overwrite it.
  const runningPollAuthoritativeRef = useRef(false);
  const sessionRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionRefreshRequestIdRef = useRef(0);
  const explorerRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileExplorerRef = useRef<FileExplorerHandle>(null);
  const sessionListRef = useRef<HTMLDivElement>(null);
  const metadataQueueRef = useRef<Map<string, SessionInfo>>(new Map());
  const metadataLoadedRef = useRef<Map<string, string>>(new Map());
  const latestInventoryAttemptRef = useRef(0);
  const acceptedInventoryAttemptRef = useRef(0);
  const metadataRequestRunningRef = useRef(false);
  const metadataAbortRef = useRef<AbortController | null>(null);
  const metadataStaleRefreshRef = useRef<Set<string>>(new Set());
  const metadataRetriedFingerprintRef = useRef<Map<string, string>>(new Map());
  const metadataRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drainMetadataQueueRef = useRef<() => void>(() => {});
  const refreshSessionInventoryRef = useRef<() => void>(() => {});
  const allSessionsRef = useRef(allSessions);
  allSessionsRef.current = allSessions;

  const scheduleMetadataRetry = useCallback((sessions: SessionInfo[]) => {
    let needsRetry = false;
    for (const session of sessions) {
      const fingerprint = sessionFingerprint(session);
      if (!fingerprint || metadataRetriedFingerprintRef.current.get(session.id) === fingerprint) continue;
      metadataRetriedFingerprintRef.current.set(session.id, fingerprint);
      needsRetry = true;
    }
    if (!needsRetry || metadataRetryTimerRef.current) return;
    metadataRetryTimerRef.current = setTimeout(() => {
      metadataRetryTimerRef.current = null;
      drainMetadataQueueRef.current();
    }, SESSION_METADATA_RETRY_DELAY_MS);
  }, []);

  const drainMetadataQueue = useCallback(async () => {
    if (metadataRequestRunningRef.current) return;
    metadataRequestRunningRef.current = true;
    try {
      while (metadataQueueRef.current.size > 0) {
        const batch = [...metadataQueueRef.current.values()].slice(0, SESSION_METADATA_BATCH_SIZE);
        for (const session of batch) metadataQueueRef.current.delete(session.id);
        const requestSessions = batch.flatMap((session) => (
          session.fileSize === undefined
            ? []
            : [{ id: session.id, fileSize: session.fileSize, modified: session.modified }]
        ));
        if (requestSessions.length === 0) continue;

        const requeueCurrentBatch = (ids?: ReadonlySet<string>) => {
          for (const requested of batch) {
            if (ids && !ids.has(requested.id)) continue;
            const current = allSessionsRef.current.find((session) => session.id === requested.id);
            if (
              current
              && !hasSessionRowMetadata(current)
              && sessionFingerprint(current) === sessionFingerprint(requested)
            ) metadataQueueRef.current.set(current.id, current);
          }
        };

        try {
          const controller = metadataAbortRef.current ?? new AbortController();
          metadataAbortRef.current = controller;
          const response = await fetch("/api/sessions/metadata", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessions: requestSessions }),
            cache: "no-store",
            signal: controller.signal,
          });
          if (!response.ok) {
            requeueCurrentBatch();
            scheduleMetadataRetry(batch);
            return;
          }
          const body = await response.json() as {
            metadata?: SessionRowMetadata[];
            staleSessionIds?: string[];
          };
          const metadataById = new Map((body.metadata ?? []).map((item) => [item.id, item]));
          const staleSessionIds = new Set(body.staleSessionIds ?? []);
          setAllSessions((current) => current.map((session) => {
            const metadata = metadataById.get(session.id);
            if (
              !metadata
              || metadata.fileSize !== session.fileSize
              || metadata.modified !== session.modified
            ) return session;
            const hydrated = {
              ...session,
              name: metadata.name,
              messageCount: metadata.messageCount,
              firstMessage: metadata.firstMessage,
            };
            const fingerprint = sessionFingerprint(hydrated);
            if (fingerprint) metadataLoadedRef.current.set(session.id, fingerprint);
            metadataRetriedFingerprintRef.current.delete(session.id);
            metadataStaleRefreshRef.current.delete(session.id);
            return hydrated;
          }));
          if (staleSessionIds.size > 0) {
            requeueCurrentBatch(staleSessionIds);
            const needsRefresh = [...staleSessionIds].some((id) => {
              if (metadataStaleRefreshRef.current.has(id)) return false;
              metadataStaleRefreshRef.current.add(id);
              return true;
            });
            if (needsRefresh) refreshSessionInventoryRef.current();
            return;
          }
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") return;
          requeueCurrentBatch();
          scheduleMetadataRetry(batch);
          return;
        }
      }
    } finally {
      metadataRequestRunningRef.current = false;
    }
  }, [scheduleMetadataRetry]);

  const queueSessionMetadata = useCallback((sessions: SessionInfo[]) => {
    for (const session of sessions) {
      const fingerprint = sessionFingerprint(session);
      if (!fingerprint || hasSessionRowMetadata(session)) continue;
      if (metadataLoadedRef.current.get(session.id) === fingerprint) continue;
      metadataQueueRef.current.set(session.id, session);
    }
    void drainMetadataQueue();
  }, [drainMetadataQueue]);

  useEffect(() => {
    metadataAbortRef.current = new AbortController();
    return () => {
      metadataAbortRef.current?.abort();
      metadataAbortRef.current = null;
      if (metadataRetryTimerRef.current) clearTimeout(metadataRetryTimerRef.current);
      metadataRetryTimerRef.current = null;
    };
  }, []);

  useEffect(() => {
    drainMetadataQueueRef.current = () => void drainMetadataQueue();
    return () => { drainMetadataQueueRef.current = () => {}; };
  }, [drainMetadataQueue]);

  const showSessionRefreshSuccess = useCallback(() => {
    setSessionRefreshDone(true);
    if (sessionRefreshTimerRef.current) clearTimeout(sessionRefreshTimerRef.current);
    sessionRefreshTimerRef.current = setTimeout(() => setSessionRefreshDone(false), 2000);
  }, []);

  const loadSessions = useCallback(async (
    showLoading = false,
    force = false,
  ): Promise<boolean> => {
    const inventoryAttempt = beginSessionInventoryAttempt();
    latestInventoryAttemptRef.current = inventoryAttempt;
    try {
      if (showLoading) setLoading(true);
      const res = await fetch(force ? "/api/sessions?force=1" : "/api/sessions", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as {
        sessions: SessionInfo[];
        activeSessionIds?: string[];
        runningSessionIds?: string[];
      };
      if (!canAcceptInventoryResult(inventoryAttempt, acceptedInventoryAttemptRef.current)) return false;
      acceptedInventoryAttemptRef.current = inventoryAttempt;
      setAllSessions((current) => {
        const previousById = new Map(current.map((session) => [session.id, session]));
        const nextById = new Map(data.sessions.map((session) => [session.id, session]));
        const nextIds = new Set(nextById.keys());
        for (const [id, fingerprint] of metadataLoadedRef.current) {
          const next = nextById.get(id);
          if (!next || sessionFingerprint(next) !== fingerprint) metadataLoadedRef.current.delete(id);
        }
        for (const id of metadataQueueRef.current.keys()) {
          if (!nextIds.has(id)) metadataQueueRef.current.delete(id);
        }
        for (const id of metadataStaleRefreshRef.current) {
          if (!nextIds.has(id)) metadataStaleRefreshRef.current.delete(id);
        }
        for (const id of metadataRetriedFingerprintRef.current.keys()) {
          if (!nextIds.has(id)) metadataRetriedFingerprintRef.current.delete(id);
        }
        return data.sessions.map((session) => {
          const previous = previousById.get(session.id);
          const fingerprint = sessionFingerprint(session);
          const preserveHydrated = previous
            && fingerprint
            && fingerprint === sessionFingerprint(previous)
            && metadataLoadedRef.current.get(session.id) === fingerprint
            && hasSessionRowMetadata(previous);
          const preserveTransient = previous?.transient && session.transient && hasSessionRowMetadata(previous);
          if (!preserveHydrated && !preserveTransient) return session;
          return {
            ...session,
            name: previous.name,
            messageCount: previous.messageCount,
            firstMessage: previous.firstMessage,
          };
        });
      });
      setInventoryRevision((revision) => revision + 1);
      // Treat the fetched running set as an initial fallback only. Once the
      // lightweight poll is live, a slow session-list fetch cannot overwrite it.
      if (!runningPollAuthoritativeRef.current) {
        setActiveSessionIds(new Set(data.activeSessionIds ?? []));
        setRunningSessionIds(new Set(data.runningSessionIds ?? []));
      }
      // Drop markers for deleted sessions.
      const unreadEligibleIds = new Set(data.sessions.map((session) => session.id));
      setUnreadSessionIds((prev) => {
        if (prev.size === 0) return prev;
        const next = new Set([...prev].filter((id) => unreadEligibleIds.has(id)));
        return next.size === prev.size ? prev : next;
      });
      setError(null);
      setLoading(false);
      return true;
    } catch (e) {
      if (inventoryAttempt !== latestInventoryAttemptRef.current) return false;
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(errorMessage(e));
      setLoading(false);
      return false;
    }
  }, [beginSessionInventoryAttempt]);

  const handleSessionRefresh = useCallback(() => {
    const requestId = ++sessionRefreshRequestIdRef.current;
    setSessionRefreshDone(false);
    const refreshes = [loadSessions(false, true)];
    if (selectedSessionId) {
      refreshes.push(onRefreshSelectedSession?.() ?? Promise.resolve(false));
    }
    void Promise.allSettled(refreshes).then((results) => {
      const succeeded = results.every((result) => result.status === "fulfilled" && result.value);
      if (succeeded && sessionRefreshRequestIdRef.current === requestId) {
        showSessionRefreshSuccess();
      }
    });
  }, [loadSessions, onRefreshSelectedSession, selectedSessionId, showSessionRefreshSuccess]);

  useEffect(() => {
    refreshSessionInventoryRef.current = () => void loadSessions(false, true);
    return () => { refreshSessionInventoryRef.current = () => {}; };
  }, [loadSessions]);

  const initialLoadDone = useRef(false);
  useEffect(() => {
    const isFirst = !initialLoadDone.current;
    initialLoadDone.current = true;
    loadSessions(isFirst, !isFirst);
  }, [loadSessions, refreshKey]);

  // Browser storage is unavailable during server rendering. Restore the panel
  // preference after hydration so a collapsed explorer stays collapsed on reload.
  useEffect(() => {
    setExplorerOpen(loadExplorerOpen());
  }, []);

  // Persist unread markers so they survive a browser refresh before the user
  // has actually opened the completed session.
  useEffect(() => {
    saveUnreadSessionIds(unreadSessionIds);
  }, [unreadSessionIds]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;

    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const schedule = () => {
      clearTimer();
      if (stopped || document.visibilityState !== "visible") return;
      timer = setTimeout(() => void poll(), RUNNING_SESSIONS_POLL_MS);
    };

    const poll = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      const current = new AbortController();
      controller?.abort();
      controller = current;
      try {
        const res = await fetch("/api/agent/running", {
          cache: "no-store",
          signal: current.signal,
        });
        if (!res.ok) return;
        const data = await res.json() as {
          activeSessionIds?: string[];
          runningSessionIds?: string[];
        };
        if (stopped || controller !== current) return;
        runningPollAuthoritativeRef.current = true;
        const nextActive = new Set(data.activeSessionIds ?? []);
        const nextRunning = new Set(data.runningSessionIds ?? []);
        setActiveSessionIds((previous) => sameSessionIds(previous, nextActive) ? previous : nextActive);
        setRunningSessionIds((previous) => sameSessionIds(previous, nextRunning) ? previous : nextRunning);
      } catch {
        // Keep the last known state; the next visible-tab poll retries.
      } finally {
        if (controller === current) controller = null;
        schedule();
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void poll();
        return;
      }
      clearTimer();
      controller?.abort();
      controller = null;
    };

    void poll();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stopped = true;
      clearTimer();
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    onActiveSessionIdsChange?.(activeSessionIds);
  }, [activeSessionIds, onActiveSessionIdsChange]);

  useEffect(() => {
    onRunningSessionIdsChange?.(runningSessionIds);
  }, [onRunningSessionIdsChange, runningSessionIds]);

  useEffect(() => {
    onSessionsChange?.(allSessions, acceptedInventoryAttemptRef.current);
  }, [allSessions, onSessionsChange]);

  useEffect(() => {
    const previous = previousRunningSessionIdsRef.current;
    const completedInBackground = [...previous].filter((id) => (
      !runningSessionIds.has(id)
      && activeSessionIds.has(id)
      && id !== selectedSessionId
    ));
    const newlyRunning = [...runningSessionIds].filter((id) => !previous.has(id));

    if (completedInBackground.length > 0 || newlyRunning.length > 0) {
      setUnreadSessionIds((prev) => {
        const next = new Set(prev);
        runningSessionIds.forEach((id) => next.delete(id));
        completedInBackground.forEach((id) => next.add(id));
        return next;
      });
    }
    const hasUnlistedRunningSession = newlyRunning.some(
      (id) => !allSessions.some((session) => session.id === id),
    );
    if (completedInBackground.length > 0 || hasUnlistedRunningSession) {
      loadSessions(false, true);
    }
    if (completedInBackground.length > 0) {
      onBackgroundTaskDone?.();
    }

    previousRunningSessionIdsRef.current = runningSessionIds;
  }, [activeSessionIds, runningSessionIds, selectedSessionId, allSessions, loadSessions, onBackgroundTaskDone]);

  useEffect(() => {
    if (!selectedSessionId) return;
    setUnreadSessionIds((prev) => {
      if (!prev.has(selectedSessionId)) return prev;
      const next = new Set(prev);
      next.delete(selectedSessionId);
      return next;
    });
  }, [selectedSessionId]);

  useEffect(() => {
    if (explorerRefreshKey !== undefined) setExplorerKey((k) => k + 1);
  }, [explorerRefreshKey]);

  const restoredRef = useRef(false);

  const projectSelection = useCallback((root: string, key: string): ProjectSelection => ({
    root,
    key,
  }), []);

  /** Resolve both display root and stable identity from server-provided data. */
  const projectFor = useCallback((cwd: string | null): ProjectSelection | null => {
    if (!cwd) return null;
    // /api/cwd/validate resolves identity before a custom path becomes active,
    // preventing one render with a raw path key from looking like a switch.
    if (validatedProject?.cwd === cwd) {
      return projectSelection(validatedProject.root, validatedProject.key);
    }
    if (worktreeState && worktreeState.forCwd === cwd) {
      return projectSelection(worktreeState.projectRoot, worktreeState.projectKey);
    }
    // Any path in the loaded worktree list belongs to that project — covers
    // worktrees without sessions, so switching to them keeps the row mounted.
    if (worktreeState?.worktrees.some((w) => w.path === cwd)) {
      return projectSelection(worktreeState.projectRoot, worktreeState.projectKey);
    }
    const match = allSessions.find((session) => (
      session.cwd === cwd || (session.projectRoot ?? session.cwd) === cwd
    ));
    return match
      ? projectSelection(match.projectRoot ?? match.cwd, workspaceKeyOf(match))
      : projectSelection(cwd, cwd);
  }, [validatedProject, worktreeState, allSessions, projectSelection]);

  // A worktree/session refresh can hydrate the stable key without changing
  // cwd, so notify when either changes. The parent treats same-cwd key changes
  // as identity hydration rather than a workspace switch.
  const lastNotifiedProjectRef = useRef<{ cwd: string | null; key: string | null } | null>(null);
  useEffect(() => {
    const project = projectFor(selectedCwd);
    const previous = lastNotifiedProjectRef.current;
    if (previous?.cwd === selectedCwd && previous.key === (project?.key ?? null)) return;
    lastNotifiedProjectRef.current = { cwd: selectedCwd, key: project?.key ?? null };
    onCwdChange?.(
      selectedCwd,
      project?.root ?? null,
      project?.key ?? null,
    );
  }, [selectedCwd, onCwdChange, projectFor]);

  // Sync the folder picker to the selected session's cwd. Sessions of all
  // worktrees in a project share one list, so clicking a session from another
  // worktree should move the effective cwd there. Only fires when the prop
  // value changes, so a manual switcher change is not snapped back.
  const lastSyncedCwdPropRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedCwdProp && selectedCwdProp !== lastSyncedCwdPropRef.current) {
      lastSyncedCwdPropRef.current = selectedCwdProp;
      setSelectedCwd(selectedCwdProp);
    }
  }, [selectedCwdProp]);

  // Load worktrees for the current effective cwd
  useLayoutEffect(() => {
    if (!selectedCwd) {
      setWorktreeState(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/worktrees?cwd=${encodeURIComponent(selectedCwd)}`)
      .then((r) => r.json())
      .then((d: { projectRoot?: string; projectKey?: string; isGit?: boolean; isTopLevel?: boolean; currentWorktreePath?: string | null; worktrees?: WorktreeEntry[]; error?: string }) => {
        if (cancelled) return;
        if (d.error || !d.projectRoot) {
          setWorktreeState(null);
          return;
        }
        setWorktreeState({
          forCwd: selectedCwd,
          projectRoot: d.projectRoot,
          projectKey: d.projectKey ?? d.projectRoot,
          isGit: d.isGit ?? false,
          isTopLevel: d.isTopLevel ?? false,
          currentWorktreePath: d.currentWorktreePath ?? null,
          worktrees: d.worktrees ?? [],
        });
      })
      .catch(() => {
        if (!cancelled) {
          setWorktreeState(null);
        }
      });
    return () => { cancelled = true; };
  }, [selectedCwd, refreshKey]);

  // Auto-select cwd and restore session from URL on first load
  useEffect(() => {
    if (allSessions.length === 0 || skipInitialProjectSelection) return;

    if (selectedCwd === null) {
      // If restoring a session, set cwd to match that session
      if (initialSessionId && !restoredRef.current) {
        restoredRef.current = true;
        const target = allSessions.find((s) => s.id === initialSessionId);
        if (target) {
          setSelectedCwd(target.cwd);
          onSelectSession(target, true);
          return;
        }
        // Session not found — notify parent so it can show the placeholder
        onInitialRestoreDone?.();
      }
      const projects = getRecentProjects(allSessions);
      if (projects.length > 0) setSelectedCwd(projects[0].cwd);
    }
  }, [allSessions, selectedCwd, initialSessionId, skipInitialProjectSelection, onSelectSession, onInitialRestoreDone]);

  const commitCustomPath = useCallback(async (candidate?: string) => {
    const path = (candidate ?? customPathValue).trim();
    if (!path || customPathValidating) return;

    setCustomPathValidating(true);
    setCustomPathError(null);
    try {
      const res = await fetch("/api/cwd/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: path }),
      });
      const data = await res.json().catch(() => ({})) as {
        cwd?: string;
        projectRoot?: string;
        projectKey?: string;
        error?: string;
      };
      if (!res.ok || data.error || !data.cwd || !data.projectRoot || !data.projectKey) {
        setCustomPathError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setValidatedProject({
        cwd: data.cwd,
        root: data.projectRoot,
        key: data.projectKey,
      });
      saveLastCustomCwd(data.cwd);
      setCustomPathValue(data.cwd);
      setSelectedCwd(data.cwd);
      setCustomPathOpen(false);
      setDropdownOpen(false);
    } catch (e) {
      setCustomPathError(errorMessage(e));
    } finally {
      setCustomPathValidating(false);
    }
  }, [customPathValue, customPathValidating]);

  const handleCustomPathClick = useCallback(() => {
    setCustomPathOpen(true);
    setCustomPathError(null);
    setDropdownOpen(false);
  }, []);
  // Re-selecting a session restores its own working folder.
  const handleSelectSessionFromList = useCallback((session: SessionInfo) => {
    if (session.cwd) setSelectedCwd(session.cwd);
    onSelectSession(session);
    if (session.id === selectedSessionId) void onRefreshSelectedSession?.();
  }, [onSelectSession, selectedSessionId, onRefreshSelectedSession]);

  const handleSessionActivated = useCallback((id: string) => {
    setError(null);
    setActiveSessionIds((current) => new Set(current).add(id));
  }, []);

  const handleSessionStopped = useCallback((id: string) => {
    setActiveSessionIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setRunningSessionIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }, []);

  const handleSessionDeleted = useCallback((id: string) => {
    onSessionDeleted?.(id);
    loadSessions();
  }, [loadSessions, onSessionDeleted]);

  const handleNewSession = useCallback(() => {
    if (!selectedCwd) return;
    // Generate a temporary UUID client-side — no backend call needed.
    // Pi will be spawned lazily when the user sends the first message.
    const tempId = createClientId();
    onNewSession?.(tempId, selectedCwd);
  }, [selectedCwd, onNewSession]);

  const recentProjects = getRecentProjects(allSessions);
  const currentProject = projectFor(selectedCwd);
  if (selectedCwd && currentProject && !recentProjects.some(project => project.key === currentProject.key)) {
    recentProjects.unshift({ key: currentProject.key, root: currentProject.root, cwd: selectedCwd });
  }
  const showProjectFilter = recentProjects.length > 8;
  const visibleProjects = projectFilter.trim()
    ? recentProjects.filter((project) => project.root.toLowerCase().includes(projectFilter.trim().toLowerCase()))
    : recentProjects;

  // Sessions of every worktree in the selected project are shown together
  const selectedProject = projectFor(selectedCwd);
  const selectedProjectKey = selectedProject?.key ?? null;

  // Per-project activity counts (running / unread) for the workspace selector.
  // Uses the same stable server key as the project list and filtering.
  const projectActivity = useMemo(
    () => getProjectActivity(allSessions, runningSessionIds, unreadSessionIds),
    [allSessions, runningSessionIds, unreadSessionIds],
  );

  // Any activity in a project other than the one currently selected — shown as
  // a dot on the (collapsed) selector button so it is visible without opening
  // the dropdown.
  const hasOtherWorkspaceActivity = useMemo(
    () => [...projectActivity.entries()].some(
      ([key, { running, unread }]) => key !== selectedProjectKey && (running > 0 || unread > 0),
    ),
    [projectActivity, selectedProjectKey],
  );

  const filteredSessions = useMemo(() => (selectedProjectKey
    ? sessionsForProject(allSessions, selectedProjectKey)
    : allSessions).toSorted((a, b) =>
      Number(runningSessionIds.has(b.id)) - Number(runningSessionIds.has(a.id))
      || Number(activeSessionIds.has(b.id)) - Number(activeSessionIds.has(a.id))
      || b.modified.localeCompare(a.modified),
    ), [activeSessionIds, allSessions, runningSessionIds, selectedProjectKey]);

  useEffect(() => {
    const updateModifier = (event: KeyboardEvent) => {
      setShortcutModifier(event.metaKey ? "meta" : event.ctrlKey ? "ctrl" : null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      updateModifier(event);
      if (event.repeat || event.altKey || event.shiftKey || (!event.ctrlKey && !event.metaKey) || !/^[0-9]$/.test(event.key)) return;
      const index = event.key === "0" ? 9 : Number(event.key) - 1;
      const session = filteredSessions[index];
      if (!session) return;
      event.preventDefault();
      handleSelectSessionFromList(session);
    };
    const handleKeyUp = (event: KeyboardEvent) => updateModifier(event);
    const clearModifier = () => setShortcutModifier(null);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", clearModifier);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", clearModifier);
    };
  }, [filteredSessions, handleSelectSessionFromList]);

  const observedInventoryKey = filteredSessions
    .map((session) => `${session.id}:${sessionFingerprint(session) ?? "transient"}`)
    .join("|");

  useEffect(() => {
    const root = sessionListRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.flatMap((entry) => {
        if (!entry.isIntersecting) return [];
        const id = (entry.target as HTMLElement).dataset.sessionInventoryId;
        const session = id ? allSessionsRef.current.find((candidate) => candidate.id === id) : undefined;
        return session ? [session] : [];
      });
      if (visible.length > 0) queueSessionMetadata(visible);
    }, {
      root,
      rootMargin: `${SESSION_METADATA_OVERSCAN_PX}px 0px`,
    });
    for (const row of root.querySelectorAll<HTMLElement>("[data-session-inventory-id]")) {
      observer.observe(row);
    }
    return () => observer.disconnect();
  }, [inventoryRevision, observedInventoryKey, queueSessionMetadata]);

  const selectedInventory = selectedSessionId
    ? allSessions.find((session) => session.id === selectedSessionId)
    : undefined;
  useEffect(() => {
    if (selectedInventory) queueSessionMetadata([selectedInventory]);
  }, [selectedInventory, queueSessionMetadata]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {customPathOpen && (
        <DirectoryPicker
          initialPath={customPathValue}
          busy={customPathValidating}
          error={customPathError}
          onCancel={() => {
            setCustomPathOpen(false);
            setCustomPathError(null);
          }}
          onSelect={(path) => void commitCustomPath(path)}
        />
      )}
      {/* Header */}
      <div
        style={{
          padding: "12px 10px 10px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <PiWebTitle />
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={handleNewSession}
              disabled={!selectedCwd}
              aria-label={t("i18n.newSession")}
              className="sidebar-icon-button"
              title={selectedCwd ? t("sidebar.newSessionTitle", { path: selectedCwd }) : t("sidebar.selectProject")}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <line x1="6" y1="1" x2="6" y2="11" />
                <line x1="1" y1="6" x2="11" y2="6" />
              </svg>
            </button>
            <button
              onClick={handleSessionRefresh}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                background: sessionRefreshDone ? "rgba(74,222,128,0.18)" : "var(--bg-hover)",
                border: `1px solid ${sessionRefreshDone ? "rgba(74,222,128,0.4)" : "var(--border)"}`,
                color: sessionRefreshDone ? "var(--success)" : "var(--text-muted)",
                cursor: "pointer",
                width: 32, height: 32,
                borderRadius: 7,
                padding: 0,
                flexShrink: 0,
                transition: "background 0.3s, color 0.3s, border-color 0.3s",
              }}
              onMouseEnter={(e) => {
                if (sessionRefreshDone) return;
                e.currentTarget.style.background = "var(--bg-selected)";
                e.currentTarget.style.color = "var(--accent)";
                e.currentTarget.style.borderColor = "rgba(37,99,235,0.35)";
              }}
              onMouseLeave={(e) => {
                if (sessionRefreshDone) return;
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = "var(--text-muted)";
                e.currentTarget.style.borderColor = "var(--border)";
              }}
               title={t("sidebar.refresh")}
              aria-label={t("sidebar.refresh")}
            >
              {sessionRefreshDone ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
              )}
            </button>
            <button
              onClick={onOpenSettings}
              className="sidebar-icon-button"
              title={t("common.settings")}
              aria-label={t("common.settings")}
            >
              <SettingsSectionIcon section="general" size={15} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* CWD picker */}
        <div style={{ position: "relative" }}>
          <button
            className="anchor-sidebar-project"
            popoverTarget={projectMenuId}
            title={selectedCwd ?? ""}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              padding: "6px 10px",
              background: selectedCwd ? "var(--bg-hover)" : "rgba(37,99,235,0.06)",
              border: selectedCwd ? "1px solid var(--border)" : "1px solid rgba(37,99,235,0.4)",
              borderRadius: 7,
              cursor: "pointer",
              fontSize: 12,
              color: "var(--text)",
              textAlign: "left",
              transition: "border-color 0.15s, background 0.15s",
            }}
          >
            {selectedCwd ? (
              <PathLabel
                text={displayCwd(selectedCwd, homeDir)}
                style={{
                  flex: 1,
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--text)",
                }}
              />
            ) : (
              <span
                style={{
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--text-dim)",
                }}
              >
                 {initialSessionId && !restoredRef.current ? "" : t("sidebar.selectProject")}
              </span>
            )}
            {hasOtherWorkspaceActivity && (
              <span
                title={t("sidebar.newActivity")}
                aria-label={t("sidebar.newActivity")}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  flexShrink: 0,
                  marginLeft: 6,
                  background: "var(--accent)",
                }}
              />
            )}
          </button>

          <AnchoredMenu
            id={projectMenuId}
            open={dropdownOpen}
            anchorClass="menu-sidebar-project"
            onOpenChange={(next) => {
              setDropdownOpen(next);
              if (!next) setProjectFilter("");
              else {
                void loadSessions(false, true);
                void onRefreshSelectedSession?.();
              }
            }}
            style={{
              zIndex: 100,
              overflow: "hidden",
            }}
          >
              {showProjectFilter && (
                <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
                  <input
                    value={projectFilter}
                    onChange={(e) => setProjectFilter(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setProjectFilter("");
                        setDropdownOpen(false);
                      }
                    }}
                     placeholder={t("sidebar.filterProjects")}
                    autoFocus
                    className="menu-filter"
                  />
                </div>
              )}
              <div style={{ maxHeight: "min(50vh, 380px)", overflowY: "auto" }}>
                {dropdownOpen && visibleProjects.map((project) => (
                  <ProjectFolderGroup key={project.key} project={project}
                    selectedCwd={selectedCwd} selected={project.key === selectedProject?.key}
                    homeDir={homeDir} activity={showProjectActivity(projectActivity.get(project.key), t)}
                    onSelect={(cwd, root, key) => {
                      setValidatedProject({ cwd, root, key });
                      setSelectedCwd(cwd);
                      setProjectFilter("");
                      setCustomPathOpen(false);
                      setCustomPathError(null);
                      setDropdownOpen(false);
                    }} />
                ))}
                {visibleProjects.length === 0 && projectFilter.trim() && (
                   <div style={{ padding: "8px 10px", fontSize: 11, color: "var(--text-dim)" }}>{t("sidebar.noMatchingProjects")}</div>
                )}
              </div>

              {/* Custom path directory picker */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleCustomPathClick();
                }}
                className="menu-item"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" style={{ flexShrink: 0 }}>
                  <line x1="5" y1="1" x2="5" y2="9" />
                  <line x1="1" y1="5" x2="9" y2="5" />
                </svg>
                <span>{t("sidebar.customPath")}</span>
              </button>
          </AnchoredMenu>
        </div>

      </div>

      {/* Session list */}
      <div ref={sessionListRef} style={{ flex: explorerOpen && (selectedCwdProp || selectedCwd) ? "1 1 0" : "1 1 auto", overflowY: "auto", padding: "0", minHeight: 80 }}>
        {loading && (
          <div style={{ padding: "16px 14px", color: "var(--text-muted)", fontSize: 12 }}>
            {t("sidebar.loading")}
          </div>
        )}
        {error && (
          <div style={{ padding: "12px 14px", color: "var(--danger)", fontSize: 12 }}>
            {error}
          </div>
        )}
        {!loading && !error && filteredSessions.length === 0 && (
          <div style={{ padding: "16px 14px", color: "var(--text-muted)", fontSize: 12 }}>
            {t("sidebar.noSessions")}
          </div>
        )}
        {filteredSessions.map((session, index) => (
          <SessionItem
            key={session.id}
            session={session}
            shortcutLabel={shortcutModifier && index < 10
              ? `${shortcutModifier === "meta" ? "⌘" : "Ctrl+"}${index === 9 ? 0 : index + 1}`
              : undefined}
            isSelected={session.id === selectedSessionId}
            isActive={activeSessionIds.has(session.id)}
            isRunning={runningSessionIds.has(session.id)}
            isUnread={unreadSessionIds.has(session.id)}
            actionsAvailable={actionsAvailable}
            onSelect={handleSelectSessionFromList}
            onRenamed={loadSessions}
            onActivated={handleSessionActivated}
            onActivationFailed={setError}
            onStopped={handleSessionStopped}
            onDeleted={handleSessionDeleted}
          />
        ))}
      </div>

      {/* File Explorer section */}
      {(selectedCwdProp || selectedCwd) && (
        <div
          style={{
            borderTop: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            flex: explorerOpen ? "1 1 0" : "0 0 auto",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
            <button
              onClick={() => setExplorerOpen((open) => {
                const next = !open;
                saveExplorerOpen(next);
                return next;
              })}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                flex: 1,
                padding: "6px 10px",
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                textAlign: "left",
              }}
            >
              <svg
                width="9" height="9" viewBox="0 0 10 10" fill="none"
                stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
                style={{ transform: explorerOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }}
              >
                <polyline points="3 2 7 5 3 8" />
              </svg>
              {t("files.explorer")}
            </button>
            {explorerOpen && changesCount > 0 && (
              <ToolbarIconButton
                onClick={() => setChangesCollapsed((v) => !v)}
                title={t("sidebar.changedFiles", { count: changesCount })}
                ariaPressed={!changesCollapsed}
                color={changesCollapsed ? "var(--text-dim)" : "var(--accent)"}
                background={changesCollapsed ? "none" : "var(--bg-selected)"}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M3 12h6" />
                  <path d="M15 12h6" />
                </svg>
              </ToolbarIconButton>
            )}
            {explorerOpen && (
              <ToolbarIconButton
                onClick={() => {
                  setFileSearchOpen((open) => !open);
                }}
                title={t("sidebar.searchFiles")}
                ariaPressed={fileSearchOpen}
                color={fileSearchOpen ? "var(--accent)" : "var(--text-dim)"}
                background={fileSearchOpen ? "var(--bg-selected)" : "none"}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" />
                </svg>
              </ToolbarIconButton>
            )}
            {explorerOpen && (
              <ToolbarIconButton
                onClick={() => fileExplorerRef.current?.openUploadPicker()}
                disabled={explorerUploadBusy}
                title={t("sidebar.uploadFilesTitle")}
                color="var(--text-dim)"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <path d="m17 8-5-5-5 5" />
                  <path d="M12 3v12" />
                </svg>
              </ToolbarIconButton>
            )}
            <ToolbarIconButton
              onClick={() => {
                if (onExplorerRefresh) onExplorerRefresh();
                else setExplorerKey((k) => k + 1);
                setExplorerRefreshDone(true);
                if (explorerRefreshTimerRef.current) clearTimeout(explorerRefreshTimerRef.current);
                explorerRefreshTimerRef.current = setTimeout(() => setExplorerRefreshDone(false), 2000);
              }}
              title={t("sidebar.refreshExplorer")}
              skipHover={explorerRefreshDone}
              color={explorerRefreshDone ? "var(--success)" : "var(--text-dim)"}
              background={explorerRefreshDone ? "rgba(74,222,128,0.18)" : "none"}
              marginRight={6}
            >
              {explorerRefreshDone ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
              )}
            </ToolbarIconButton>
          </div>
          {explorerOpen && (
            <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
              <FileExplorer
                ref={fileExplorerRef}
                cwd={selectedCwd ?? selectedCwdProp!}
                onOpenFile={onOpenFile ?? (() => {})}
                refreshKey={explorerKey}
                onAtMention={onAtMention}
                onAtMentions={onAtMentions}
                onUploadBusyChange={setExplorerUploadBusy}
                changesCollapsed={changesCollapsed}
                onChangesCountChange={setChangesCount}
                fileSearchOpen={fileSearchOpen}
                onFileSearchOpenChange={setFileSearchOpen}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Compact per-project activity badges for the workspace selector dropdown items:
 * a spinning running icon + count and an unread dot + count. Renders nothing
 * when the project has no activity. Counts share the accent / unread colors of
 * the per-session indicators so the two stay visually consistent.
 */
function showProjectActivity(
  activity: { running: number; unread: number } | undefined,
  t: (key: string) => string,
): ReactNode {
  if (!activity || (activity.running === 0 && activity.unread === 0)) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0, marginLeft: 6 }}>
      {activity.running > 0 && (
        <span
          title={t("sidebar.agentRunning")}
          aria-label={`${t("sidebar.agentRunning")} (${activity.running})`}
          style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "var(--accent)", fontSize: 10, fontFamily: "var(--font-mono)" }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "block" }}>
            <g>
              <path d="M21 12a9 9 0 1 1-3.8-7.4" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
              <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite" />
            </g>
          </svg>
          {activity.running}
        </span>
      )}
      {activity.unread > 0 && (
        <span
          title={t("sidebar.newSessionActivity")}
          aria-label={`${t("sidebar.newSessionActivity")} (${activity.unread})`}
          style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "var(--info)", fontSize: 10, fontFamily: "var(--font-mono)" }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", display: "inline-block" }} />
          {activity.unread}
        </span>
      )}
    </span>
  );
}
