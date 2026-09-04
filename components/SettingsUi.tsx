"use client";

import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";

type ConfigButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ConfigButtonSize = "small" | "default";

/** Replace a /Users/<name> or /home/<name> prefix with ~ for display. */
export function shortenPath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

/**
 * Settings surface for one SettingsPanel section. SettingsPanel owns the
 * dialog, its header and its close button, so this shell only fills its host.
 */
export function ConfigPanelShell({ children }: { children: ReactNode }) {
  return (
    <div className="config-panel-root">
      <div className="config-panel-surface">{children}</div>
    </div>
  );
}

export function ConfigSplitView({ children }: { children: ReactNode }) {
  return <div className="config-split-view">{children}</div>;
}

export function ConfigSidebar({ children }: { children: ReactNode }) {
  return <aside className="config-sidebar">{children}</aside>;
}

export function ConfigSidebarList({ children }: { children: ReactNode }) {
  return <div className="config-sidebar-list">{children}</div>;
}

export function ConfigSidebarGroupLabel({ children }: { children: ReactNode }) {
  return <div className="config-sidebar-group-label">{children}</div>;
}

export function ConfigSidebarItem({
  active = false,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      aria-current={active ? "page" : undefined}
      className={["config-sidebar-item", className].filter(Boolean).join(" ")}
    >
      {children}
    </button>
  );
}

export function ConfigSidebarText({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      {...props}
      className={["config-sidebar-text", className].filter(Boolean).join(" ")}
    />
  );
}

export function ConfigDetailStack({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={["config-detail-stack", className].filter(Boolean).join(" ")}
    />
  );
}

export function ConfigDetailHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={["config-detail-header", className].filter(Boolean).join(" ")}
    />
  );
}

export function ConfigDetailHeaderInfo({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={["config-detail-header-info", className].filter(Boolean).join(" ")}
    />
  );
}

export function ConfigDetailActions({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={["config-detail-actions", className].filter(Boolean).join(" ")}
    />
  );
}

export function ConfigDetailTitle({ children }: { children: ReactNode }) {
  return <div className="config-detail-title">{children}</div>;
}

export function ConfigSectionTitle({ children }: { children: ReactNode }) {
  return <div className="config-section-title">{children}</div>;
}

export function ConfigField({ label, children, style }: { label: ReactNode; children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="config-field" style={style}>
      <span className="config-field-label">{label}</span>
      {children}
    </div>
  );
}

export function ConfigEmptyState({ children }: { children: ReactNode }) {
  return <div className="config-empty-state">{children}</div>;
}

export function ConfigDetail({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="config-detail" style={style}>
      {children}
    </div>
  );
}

export function ConfigFooter({ status, children }: { status?: ReactNode; children?: ReactNode }) {
  return (
    <footer className="config-footer">
      <div className="config-footer-status">{status}</div>
      <div className="config-footer-actions">{children}</div>
    </footer>
  );
}

export function ConfigButton({
  variant = "secondary",
  size = "default",
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ConfigButtonVariant; size?: ConfigButtonSize }) {
  return (
    <button
      type="button"
      {...props}
      className={[
        "config-button",
        `config-button-${variant}`,
        `config-button-${size}`,
        className,
      ].filter(Boolean).join(" ")}
    >
      {children}
    </button>
  );
}

export function ConfigSwitch({ checked, disabled = false, loading = false, label, onChange }: { checked: boolean; disabled?: boolean; loading?: boolean; label: string; onChange: (checked: boolean) => void }) {
  const inactive = disabled || loading;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={inactive}
      className={`config-switch${loading ? " is-loading" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="config-switch-knob" />
    </button>
  );
}

export function ConfigListAction({ active = false, children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <div className="config-list-action">
      <button
        type="button"
        {...props}
        aria-current={active ? "page" : undefined}
        className={["config-list-action-button", className].filter(Boolean).join(" ")}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        {children}
      </button>
    </div>
  );
}

export function ConfigStatusDot({ active, color }: { active?: boolean; color?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`config-status-dot${active ? " is-active" : active === false ? " is-inactive" : ""}`}
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}

/**
 * Global / project scope picker. Skills and Plugins each had their own copy
 * that behaved identically and differed only in padding, weight and which
 * muted token the inactive label used.
 */
export function ConfigScopePicker({
  value,
  projectEnabled,
  onChange,
}: {
  value: "global" | "project";
  projectEnabled: boolean;
  onChange: (scope: "global" | "project") => void;
}) {
  const { t } = useI18n();
  return (
    <div className="config-scope-picker">
      {(["global", "project"] as const).map((scope) => {
        const disabled = scope === "project" && !projectEnabled;
        return (
          <button
            key={scope}
            type="button"
            aria-pressed={value === scope}
            onClick={() => { if (!disabled) onChange(scope); }}
            disabled={disabled}
            title={disabled ? t("trust.projectScopeUnavailable") : undefined}
          >
            {scope}
          </button>
        );
      })}
    </div>
  );
}
