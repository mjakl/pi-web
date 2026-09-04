"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { SessionInfo } from "@/lib/types";
import { formatRelativeTime } from "@/lib/i18n/format";
import { useI18n } from "@/hooks/useI18n";

export const SESSION_ITEM_HEIGHT = 54;

const TABBABLE_SELECTOR = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

type MenuPosition = {
  top: number;
  left: number;
  anchorTop: number;
  anchorLeft: number;
  isActive: boolean;
  transient: boolean;
};

type ActionSurface =
  | { kind: "idle" }
  | { kind: "menu"; position: MenuPosition }
  | { kind: "rename" };

type FocusPolicy = "none" | "trigger" | "trigger-if-owned" | "surface" | HTMLElement;

const IDLE_ACTION_SURFACE: ActionSurface = { kind: "idle" };

/** Place the fixed-position popup under its trigger, clamped to the viewport. */
function menuPositionFor(
  rect: Pick<DOMRect, "top" | "bottom" | "left" | "right">,
  isActive: boolean,
  transient: boolean,
): MenuPosition {
  const width = 144;
  const height = (Number(isActive) + (transient ? 0 : 2)) * 34 + 8;
  return {
    left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
    top: rect.bottom + 4 + height <= window.innerHeight ? rect.bottom + 4 : Math.max(8, rect.top - height - 4),
    anchorTop: rect.top,
    anchorLeft: rect.left,
    isActive,
    transient,
  };
}

const menuItemStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  height: 34,
  padding: "0 10px",
  border: 0,
  borderRadius: 5,
  background: "transparent",
  color: "var(--text)",
  cursor: "pointer",
  textAlign: "left",
  fontSize: 12,
};

const SESSION_INDICATORS = {
  running: {
    title: "sidebar.agentRunning",
    label: "sidebar.agentRunning",
    color: "var(--accent)",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "block" }}>
        <g>
          <path
            d="M21 12a9 9 0 1 1-3.8-7.4"
            stroke="currentColor"
            strokeWidth="2.8"
            strokeLinecap="round"
          />
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 12 12"
            to="360 12 12"
            dur="0.9s"
            repeatCount="indefinite"
          />
        </g>
      </svg>
    ),
  },
  active: {
    title: "sidebar.sessionActive",
    label: "sidebar.sessionActive",
    color: "var(--success)",
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <circle cx="7" cy="7" r="5" fill="currentColor" />
      </svg>
    ),
  },
  stopped: {
    title: "sidebar.sessionStopped",
    label: "sidebar.sessionStopped",
    color: "var(--text-dim)",
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <rect x="4" y="4" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
  },
  unread: {
    title: "sidebar.newActivity",
    label: "sidebar.newSessionActivity",
    color: "var(--info)",
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ display: "block" }}>
        <circle cx="7" cy="7" r="5" fill="currentColor" />
      </svg>
    ),
  },
};

export function SessionIndicator({ kind }: { kind: keyof typeof SESSION_INDICATORS }) {
  const { t } = useI18n();
  const { title, label, color, icon } = SESSION_INDICATORS[kind];
  return (
    <span
      title={t(title)}
      aria-label={t(label)}
      style={{
        width: 14,
        height: 14,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color,
      }}
    >
      {icon}
    </span>
  );
}

export function SessionItem({
  session,
  shortcutLabel,
  isSelected,
  isActive,
  isRunning,
  isUnread,
  actionsAvailable,
  onClick,
  onRenamed,
  onStopped,
  onDeleted,
}: {
  session: SessionInfo;
  shortcutLabel?: string;
  isSelected: boolean;
  isActive?: boolean;
  isRunning?: boolean;
  isUnread?: boolean;
  actionsAvailable: boolean;
  onClick: () => void;
  onRenamed?: () => void;
  onStopped?: (id: string) => void;
  onDeleted?: (id: string) => void;
}) {
  const { t } = useI18n();
  const [actionSurface, setActionSurface] = useState<ActionSurface>(IDLE_ACTION_SURFACE);
  const [renameValue, setRenameValue] = useState("");
  const [stopping, setStopping] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const menuHadFocusRef = useRef(false);
  // A press on the trigger while the popup is open reaches onClick after the
  // browser's light dismiss has already closed it, so reopening from a
  // "currently closed" reading would leave the trigger unable to close its own
  // menu. These two stamps scope the guard to one gesture instead of a
  // timeout: the popover's toggle event is queued as a task, so a close caused
  // by this very press always lands after the press began.
  const pressStartedAtRef = useRef(0);
  const dismissedAtRef = useRef(0);
  const pendingFocusRef = useRef<FocusPolicy>("none");
  const renderedSurfaceRef = useRef(actionSurface);
  const actionsAvailableRef = useRef(actionsAvailable);
  const hasActionsRef = useRef(false);
  const menuId = useId();
  const eligibleForActions = isActive || !session.transient;
  const hasActions = actionsAvailable && eligibleForActions;
  const actionPending = stopping || deleting;
  const renderedSurface = actionsAvailable ? actionSurface : IDLE_ACTION_SURFACE;
  actionsAvailableRef.current = actionsAvailable;
  hasActionsRef.current = hasActions;
  renderedSurfaceRef.current = renderedSurface;
  const menuPosition = renderedSurface.kind === "menu" ? renderedSurface.position : undefined;
  const menuEligibilityValid = !menuPosition
    || (menuPosition.isActive === Boolean(isActive)
      && menuPosition.transient === Boolean(session.transient));

  const transitionActionSurface = useCallback((next: ActionSurface, focus: FocusPolicy) => {
    const actionsAvailableNow = actionsAvailableRef.current;
    const hasActionsNow = hasActionsRef.current;
    renderedSurfaceRef.current = actionsAvailableNow ? next : IDLE_ACTION_SURFACE;
    if (!actionsAvailableNow || (focus === "trigger" && !hasActionsNow)) {
      pendingFocusRef.current = "none";
    } else if (focus === "trigger-if-owned") {
      pendingFocusRef.current = menuHadFocusRef.current && hasActionsNow ? "trigger" : "none";
    } else {
      pendingFocusRef.current = focus;
    }
    menuHadFocusRef.current = false;
    setActionSurface(next);
  }, []);

  useLayoutEffect(() => {
    if (!actionsAvailable) {
      pendingFocusRef.current = "none";
      if (actionSurface.kind !== "idle") transitionActionSurface(IDLE_ACTION_SURFACE, "none");
      return;
    }

    const focus = pendingFocusRef.current;
    pendingFocusRef.current = "none";
    if (typeof focus === "object") {
      if (focus.isConnected) focus.focus();
    } else if (focus === "trigger") {
      menuTriggerRef.current?.focus();
    } else if (focus === "surface") {
      if (renderedSurface.kind === "menu") menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
      else if (renderedSurface.kind === "rename") {
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
  }, [actionSurface, actionsAvailable, renderedSurface, transitionActionSurface]);

  // Follow the trigger rather than tearing the popup down when it moves. A
  // phone fires resize for every URL-bar and on-screen-keyboard animation, and
  // an unmount mid-tap drops the press the user already started.
  const repositionMenu = useCallback(() => {
    const rect = menuTriggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const position = menuPositionFor(rect, Boolean(isActive), Boolean(session.transient));
    setActionSurface((current) => (current.kind === "menu" ? { kind: "menu", position } : current));
  }, [isActive, session.transient]);

  useLayoutEffect(() => {
    if (!menuPosition) return;
    const rect = menuTriggerRef.current?.getBoundingClientRect();
    if (!rect || !menuEligibilityValid) {
      transitionActionSurface(IDLE_ACTION_SURFACE, rect ? "trigger-if-owned" : "none");
      return;
    }
    if (rect.top !== menuPosition.anchorTop || rect.left !== menuPosition.anchorLeft) repositionMenu();
  });

  // Show as a native popover so the browser owns dismissal. Its light dismiss
  // is implemented below the DOM event layer, which is where the phone quirks
  // that dropped a tap on Stop live: a URL-bar resize, the scroll that rides
  // along with it, and a tap that blurs the focused button without focusing
  // anything. Escape stays ours because window shortcuts must not also see it,
  // and positioning stays ours because CSS anchor positioning is too new.
  // Keyed on open/closed, not on the position: repositioning swaps the
  // position object every time, and showPopover() on an already-open popover
  // throws InvalidStateError.
  const menuShown = Boolean(menuPosition) && menuEligibilityValid;
  useLayoutEffect(() => {
    if (!menuShown) return;
    menuRef.current?.showPopover?.();
  }, [menuShown]);

  useEffect(() => {
    if (!menuPosition || !menuEligibilityValid) return;

    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      transitionActionSurface(IDLE_ACTION_SURFACE, "trigger");
    };

    document.addEventListener("keydown", dismissOnEscape);
    window.addEventListener("resize", repositionMenu);
    return () => {
      document.removeEventListener("keydown", dismissOnEscape);
      window.removeEventListener("resize", repositionMenu);
    };
  }, [menuEligibilityValid, menuPosition, repositionMenu, transitionActionSurface]);

  const firstMessage = session.firstMessage ?? "";
  const title = session.name || firstMessage.slice(0, 50) || session.id.slice(0, 12);
  const actionsLabel = t("sidebar.sessionActions", { title });

  const startRename = useCallback(() => {
    if (session.transient) return;
    setRenameValue(session.name || firstMessage.slice(0, 50) || session.id.slice(0, 12));
    transitionActionSurface({ kind: "rename" }, "surface");
  }, [session.name, session.transient, firstMessage, session.id, transitionActionSurface]);

  const commitRename = useCallback(async (restoreFocus = false) => {
    const name = renameValue.trim();
    transitionActionSurface(IDLE_ACTION_SURFACE, restoreFocus ? "trigger" : "none");
    // No-op when unchanged: the fallback title (first message / id) isn't a
    // real stored name, so don't persist it as one. (The rename input seeds
    // from the same server-collapsed firstMessage, so an untouched rename of
    // a skill-invoked session stays a no-op instead of persisting raw XML.)
    if (renameValue === title || name === (session.name ?? "")) return;
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      onRenamed?.();
    } catch {
      // ignore
    }
  }, [renameValue, session.id, session.name, onRenamed, title, transitionActionSurface]);

  const performStop = useCallback(async () => {
    if (!isActive) return;
    transitionActionSurface(IDLE_ACTION_SURFACE, "trigger");
    setStopping(true);
    try {
      const response = await fetch(`/api/agent/${encodeURIComponent(session.id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (session.transient) transitionActionSurface(IDLE_ACTION_SURFACE, "none");
      onStopped?.(session.id);
    } catch {
      // Transient sessions keep their trigger only when Stop fails.
      if (session.transient) transitionActionSurface(IDLE_ACTION_SURFACE, "trigger");
    } finally {
      setStopping(false);
    }
  }, [isActive, onStopped, session.id, session.transient, transitionActionSurface]);

  const performDelete = useCallback(async () => {
    if (session.transient) return;
    transitionActionSurface(IDLE_ACTION_SURFACE, "trigger");
    setDeleting(true);
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      transitionActionSurface(IDLE_ACTION_SURFACE, "none");
      onDeleted?.(session.id);
    } catch {
      setDeleting(false);
      transitionActionSurface(IDLE_ACTION_SURFACE, "trigger");
    }
  }, [session.id, session.transient, onDeleted, transitionActionSurface]);

  const handleMenuKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const leavingBackward = e.shiftKey && e.target === buttons[0];
    const leavingForward = !e.shiftKey && e.target === buttons.at(-1);
    if (!leavingBackward && !leavingForward) return;

    e.preventDefault();
    const trigger = menuTriggerRef.current;
    let destination: HTMLElement | null = trigger;
    if (leavingForward && trigger) {
      const tabbable = [...document.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)]
        .filter((element) => element.tabIndex >= 0 && !element.closest("[hidden], [inert]") && !menuRef.current?.contains(element));
      destination = tabbable[tabbable.indexOf(trigger) + 1] ?? trigger;
    }
    transitionActionSurface(IDLE_ACTION_SURFACE, destination ?? "none");
  }, [transitionActionSurface]);

  const toggleMenu = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (actionPending) return;
    if (dismissedAtRef.current > 0 && dismissedAtRef.current >= pressStartedAtRef.current) {
      // This press is what closed the popup. Leave it closed.
      dismissedAtRef.current = 0;
      return;
    }
    if (menuPosition) {
      transitionActionSurface(IDLE_ACTION_SURFACE, "none");
      return;
    }

    const position = menuPositionFor(
      e.currentTarget.getBoundingClientRect(),
      Boolean(isActive),
      Boolean(session.transient),
    );
    transitionActionSurface({ kind: "menu", position }, "surface");
  }, [actionPending, isActive, menuPosition, session.transient, transitionActionSurface]);

  const chooseMenuAction = useCallback((e: React.MouseEvent, action: "stop" | "rename" | "delete") => {
    e.stopPropagation();
    if (action === "rename") startRename();
    else if (action === "stop") void performStop();
    else void performDelete();
  }, [performDelete, performStop, startRename]);

  // Fixed-height outer wrapper — content swaps in place so the list never reflows.
  return (
    <div
      className="session-row"
      data-session-inventory-id={session.id}
      onClick={renderedSurface.kind === "idle" || renderedSurface.kind === "menu" ? onClick : undefined}
      style={{
        height: SESSION_ITEM_HEIGHT,
        display: "flex",
        alignItems: "center",
        paddingLeft: 14,
        paddingRight: 8,
        cursor: renderedSurface.kind === "idle" || renderedSurface.kind === "menu" ? "pointer" : "default",
        background: isSelected ? "var(--bg-selected)" : undefined,
        borderLeft: isSelected ? "2px solid var(--accent)" : "2px solid transparent",
        transition: "background 0.1s",
        opacity: stopping || deleting ? 0.5 : 1,
        gap: 6,
        overflow: "hidden",
      }}
    >
      {renderedSurface.kind === "rename" ? (
        /* ── Rename: input fills the same row ── */
        <input
          ref={inputRef}
          aria-label={t("sidebar.renameSession", { title })}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={(e) => {
            if (e.relatedTarget !== menuTriggerRef.current && renderedSurfaceRef.current.kind === "rename") {
              void commitRename();
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void commitRename(true);
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              transitionActionSurface(IDLE_ACTION_SURFACE, "trigger");
            }
          }}
          style={{
            flex: 1,
            fontSize: 12,
            padding: "5px 8px",
            border: "1px solid var(--accent)",
            borderRadius: 5,
            outline: "none",
            background: "var(--bg)",
            color: "var(--text)",
            height: 30,
          }}
        />
      ) : (
        /* ── Normal view ── */
        <>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                minWidth: 0,
                fontSize: 12,
                fontWeight: isSelected ? 500 : 400,
                lineHeight: 1.4,
                color: isActive ? "var(--text)" : "var(--text-muted)",
              }}
              title={title}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                {title}
              </span>
            </div>
            <div style={{ marginTop: 2, display: "flex", alignItems: "center", gap: 8, color: "var(--text-dim)", fontSize: 11, minWidth: 0, overflow: "hidden" }}>
              <SessionIndicator kind={isRunning ? "running" : isActive ? "active" : "stopped"} />
              {isUnread && <SessionIndicator kind="unread" />}
              <span title={session.modified} style={{ whiteSpace: "nowrap", flexShrink: 0 }}>{formatRelativeTime(session.modified)}</span>
              {session.isWorktree && session.branch && (
                <span
                  title={`Worktree: ${session.cwd}`}
                  style={{ display: "flex", alignItems: "center", gap: 3, color: "var(--accent)", minWidth: 0, overflow: "hidden" }}
                >
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <line x1="6" y1="3" x2="6" y2="15" />
                    <circle cx="18" cy="6" r="3" />
                    <circle cx="6" cy="18" r="3" />
                    <path d="M18 9a9 9 0 0 1-9 9" />
                  </svg>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{session.branch}</span>
                </span>
              )}
            </div>
          </div>

          <div
            style={{
              width: 44,
              height: SESSION_ITEM_HEIGHT,
              padding: "4px 0 5px",
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              justifyContent: "space-between",
              flexShrink: 0,
              color: "var(--text-dim)",
              fontSize: 11,
            }}
          >
            {shortcutLabel ? (
              <kbd
                aria-hidden="true"
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 28, height: 28,
                  color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 10,
                }}
              >
                {shortcutLabel}
              </kbd>
            ) : hasActions ? (
              <button
                ref={menuTriggerRef}
                type="button"
                onPointerDown={() => { pressStartedAtRef.current = Date.now(); }}
                aria-label={actionsLabel}
                aria-controls={menuId}
                aria-expanded={Boolean(menuPosition)}
                aria-disabled={actionPending || undefined}
                onClick={toggleMenu}
                onFocus={() => { menuHadFocusRef.current = false; }}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 28, height: 28, padding: 0,
                  background: menuPosition ? "var(--bg-selected)" : "transparent",
                  border: "1px solid transparent", borderRadius: 6,
                  color: "var(--text-muted)", cursor: actionPending ? "default" : "pointer",
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <circle cx="5" cy="12" r="1.8" />
                  <circle cx="12" cy="12" r="1.8" />
                  <circle cx="19" cy="12" r="1.8" />
                </svg>
              </button>
            ) : <span />}
            {session.messageCount === undefined ? (
              <span role="status" aria-label={t("sidebar.loading")}>…</span>
            ) : (
              <span
                title={t("sidebar.messagesCount", { count: session.messageCount })}
                style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {t("sidebar.messagesCount", { count: session.messageCount })}
              </span>
            )}
          </div>

          {menuPosition && (
            <div
              ref={menuRef}
              id={menuId}
              popover="auto"
              onToggle={(e) => {
                if ((e as unknown as { newState?: string }).newState !== "closed") return;
                dismissedAtRef.current = Date.now();
                transitionActionSurface(IDLE_ACTION_SURFACE, "trigger-if-owned");
              }}
              role="group"
              aria-label={actionsLabel}
              style={{
                // inset/margin reset the UA popover sheet, which centres with
                // inset: 0 and margin: auto and would ignore top/left.
                position: "fixed", inset: "auto", margin: 0,
                top: menuPosition.top, left: menuPosition.left, zIndex: 1000,
                width: "min(144px, calc(100vw - 16px))", maxHeight: "calc(100vh - 16px)", overflowY: "auto",
                padding: 4, background: "var(--bg)", border: "1px solid var(--border)",
                borderRadius: 7, boxShadow: "0 6px 18px rgba(0,0,0,0.18)",
              }}
              onClick={(e) => e.stopPropagation()}
              onFocusCapture={() => { menuHadFocusRef.current = true; }}
              onKeyDown={handleMenuKeyDown}
            >
              {isActive && (
                <button type="button" onClick={(e) => chooseMenuAction(e, "stop")} style={menuItemStyle}>
                  {t("sidebar.stop")}
                </button>
              )}
              {!session.transient && (
                <>
                  <button type="button" onClick={(e) => chooseMenuAction(e, "rename")} style={menuItemStyle}>
                    {t("sidebar.rename")}
                  </button>
                  <button type="button" onClick={(e) => chooseMenuAction(e, "delete")} style={{ ...menuItemStyle, color: "var(--danger)" }}>
                    {t("sidebar.delete")}
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
