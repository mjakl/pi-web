"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useTheme, type ThemePreference } from "@/hooks/useTheme";
import { sendAgentCommand } from "@/lib/agent-client";
import type { ShellToolSettingsResponse } from "@/lib/api-types";
import { getPreferredToolPreset, setPreferredToolPreset } from "@/lib/tool-preset-preference";
import type { ToolPreset } from "@/lib/tool-presets";
import {
  setLastSettingsSection,
  type SettingsSection,
} from "@/lib/settings-navigation";
import { ModelsConfig } from "./ModelsConfig";
import { SkillsConfig } from "./SkillsConfig";
import { PluginsConfig } from "./PluginsConfig";
import { ConfigSwitch } from "./SettingsUi";
import type { ToolPresetControl } from "./ChatWindow";

interface Props {
  cwd: string | null;
  sessionId: string | null;
  initialSection: SettingsSection;
  toolPresetControl: ToolPresetControl | null;
  soundEnabled: boolean;
  onSoundToggle: () => void;
  dumbZoneTokens: number;
  onDumbZoneTokensChange: (tokens: number) => void;
  onClose: () => void;
  onSessionReloaded: () => void;
}

export function SettingsSectionIcon({ section, size = 16, strokeWidth = 1.8 }: { section: SettingsSection; size?: number; strokeWidth?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className: "settings-section-icon",
  };

  if (section === "general") return <svg {...common}><path d="M20 7h-9M14 17H5" /><circle cx="7" cy="7" r="3" /><circle cx="17" cy="17" r="3" /></svg>;
  if (section === "models") return <svg {...common}><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 15h3M1 9h3M1 15h3" /></svg>;
  if (section === "skills") return <svg {...common}><path d="m12 2-10 5 10 5 10-5-10-5Z" /><path d="m2 12 10 5 10-5M2 17l10 5 10-5" /></svg>;
  return <svg {...common}><path d="M9 7V2M15 7V2M6 13V8a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v5a6 6 0 0 1-12 0ZM12 19v3" /></svg>;
}

function ThemeIcon({ preference }: { preference: ThemePreference }) {
  if (preference === "light") {
    return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.41M17.66 6.34l1.41-1.41" /></svg>;
  }
  if (preference === "dark") {
    return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" /></svg>;
  }
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></svg>;
}

function GeneralSettings({ sessionId, toolPresetControl, soundEnabled, onSoundToggle, dumbZoneTokens, onDumbZoneTokensChange, onSessionReloaded }: Pick<Props, "sessionId" | "toolPresetControl" | "soundEnabled" | "onSoundToggle" | "dumbZoneTokens" | "onDumbZoneTokensChange" | "onSessionReloaded">) {
  const { t } = useI18n();
  const { preference, setThemePreference } = useTheme();
  const [preferredToolPreset, setPreferredToolPresetState] = useState(getPreferredToolPreset);
  const [shellSettings, setShellSettings] = useState<ShellToolSettingsResponse | null>(null);
  const [shellSaving, setShellSaving] = useState(false);
  const [shellError, setShellError] = useState<string | null>(null);
  const themeOptions: { id: ThemePreference; label: string }[] = [
    { id: "light", label: t("settings.themeLight") },
    { id: "dark", label: t("settings.themeDark") },
    { id: "auto", label: t("settings.themeSystem") },
  ];
  const toolPresetOptions: { id: ToolPreset; label: string }[] = [
    { id: "none", label: t("settings.toolPresetChatOnly") },
    { id: "read-only", label: t("settings.toolPresetReadOnly") },
    { id: "default", label: t("settings.toolPresetDefault") },
    { id: "full", label: t("settings.toolPresetFull") },
  ];
  const activeToolPreset = toolPresetControl?.preset ?? preferredToolPreset;

  const selectToolPreset = (preset: ToolPreset) => {
    setPreferredToolPreset(preset);
    setPreferredToolPresetState(preset);
    if (toolPresetControl?.preset !== preset) toolPresetControl?.onChange(preset);
  };

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/tools/settings")
      .then(async (response) => {
        const data = await response.json() as ShellToolSettingsResponse & { error?: string };
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
        if (!cancelled) setShellSettings(data);
      })
      .catch((cause) => {
        if (!cancelled) setShellError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => { cancelled = true; };
  }, []);

  const togglePowerShell = async (enabled: boolean) => {
    setShellSaving(true);
    setShellError(null);
    try {
      const response = await fetch("/api/tools/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const data = await response.json() as ShellToolSettingsResponse & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setShellSettings(data);
      if (sessionId) {
        await sendAgentCommand(sessionId, { type: "reload" });
        onSessionReloaded();
      }
    } catch (cause) {
      setShellError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setShellSaving(false);
    }
  };

  return (
    <div className="settings-general">
      <h2 className="settings-general-title">{t("settings.general")}</h2>

      <section className="settings-general-section">
        <h3 className="settings-general-heading">{t("settings.appearance")}</h3>
        <p className="settings-general-description">{t("settings.appearanceDescription")}</p>
        <div role="radiogroup" aria-label={t("settings.appearance")} className="settings-theme-options">
          {themeOptions.map((option) => {
            const selected = preference === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setThemePreference(option.id)}
                className="settings-theme-option"
              >
                <ThemeIcon preference={option.id} />
                <span className="settings-theme-option-label">{option.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="settings-general-section">
        <h3 className="settings-general-heading">{t("settings.dumbZone")}</h3>
        <p className="settings-general-description">{t("settings.dumbZoneDescription")}</p>
        <div className="settings-shell-option">
          <label htmlFor="dumb-zone-tokens">{t("settings.dumbZoneTokenThreshold")}</label>
          <input
            id="dumb-zone-tokens"
            className="settings-number-input"
            type="number"
            min="1"
            step="1000"
            value={dumbZoneTokens}
            onChange={(event) => {
              const tokens = event.currentTarget.valueAsNumber;
              if (Number.isSafeInteger(tokens) && tokens > 0) onDumbZoneTokensChange(tokens);
            }}
          />
        </div>
      </section>

      <section className="settings-general-section">
        <h3 className="settings-general-heading">{t("settings.toolSelection")}</h3>
        <p className="settings-general-description">{t("settings.toolSelectionDescription")}</p>
        <div role="radiogroup" aria-label={t("chat.changeToolPreset")} className="settings-theme-options settings-tool-options">
          {toolPresetOptions.map((option) => {
            const selected = activeToolPreset === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={toolPresetControl?.disabled}
                onClick={() => selectToolPreset(option.id)}
                className="settings-theme-option"
              >
                <span className="settings-theme-option-label">{option.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="settings-general-section">
        <h3 className="settings-general-heading">{t("settings.completionSound")}</h3>
        <p className="settings-general-description">{t("settings.completionSoundDescription")}</p>
        <div className="settings-shell-option">
          <span>{t("settings.completionSound")}</span>
          <ConfigSwitch
            checked={soundEnabled}
            label={t(soundEnabled ? "chat.disableSound" : "chat.enableSound")}
            onChange={onSoundToggle}
          />
        </div>
      </section>

      {shellSettings?.isWindows && (
        <section className="settings-general-section">
          <h3 className="settings-general-heading">{t("settings.shellTool")}</h3>
          <p className="settings-general-description">{t("settings.shellToolDescription")}</p>
          <div className="settings-shell-option">
            <span>{t("settings.usePowerShell")}</span>
            <ConfigSwitch
              checked={shellSettings.powerShellEnabled}
              loading={shellSaving}
              label={t("settings.usePowerShell")}
              onChange={(enabled) => void togglePowerShell(enabled)}
            />
          </div>
          {shellError && <p role="alert" className="settings-general-error">{shellError}</p>}
        </section>
      )}
    </div>
  );
}

export function SettingsPanel({ cwd, sessionId, initialSection, toolPresetControl, soundEnabled, onSoundToggle, dumbZoneTokens, onDumbZoneTokensChange, onClose, onSessionReloaded }: Props) {
  const { t } = useI18n();
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [mountedSections, setMountedSections] = useState<ReadonlySet<SettingsSection>>(
    () => new Set([section]),
  );
  const sections: { id: SettingsSection; label: string; requiresProject: boolean }[] = [
    { id: "general", label: t("settings.general"), requiresProject: false },
    { id: "models", label: t("common.models"), requiresProject: false },
    { id: "skills", label: t("common.skills"), requiresProject: true },
    { id: "plugins", label: t("common.plugins"), requiresProject: true },
  ];

  useEffect(() => setLastSettingsSection(initialSection), [initialSection]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (cwd || (section !== "skills" && section !== "plugins")) return;
    setSection("general");
    setMountedSections((current) => new Set(current).add("general"));
    setLastSettingsSection("general");
  }, [cwd, section]);

  const activateSection = (nextSection: SettingsSection) => {
    setMountedSections((current) => new Set(current).add(nextSection));
    setSection(nextSection);
    setLastSettingsSection(nextSection);
  };

  const sectionHost = (id: SettingsSection, content: ReactNode) => mountedSections.has(id) ? (
    <div
      key={id}
      hidden={section !== id}
      className="settings-section-host"
    >
      {content}
    </div>
  ) : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("settings.title")}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      className="settings-dialog-backdrop"
    >
      <div className="settings-dialog-surface">
        <div className="settings-dialog-header">
          <strong className="settings-dialog-title">{t("settings.title")}</strong>
          <select
            aria-label={t("settings.title")}
            value={section}
            onChange={(event) => activateSection(event.target.value as SettingsSection)}
            className="settings-mobile-section-picker"
          >
            {sections.map((item) => (
              <option key={item.id} value={item.id} disabled={item.requiresProject && !cwd}>
                {item.label}
              </option>
            ))}
          </select>
          <nav aria-label={t("settings.title")} className="settings-section-tabs">
            {sections.map((item) => {
              const selected = section === item.id;
              const disabled = item.requiresProject && !cwd;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="settings-section-tab"
                  disabled={disabled}
                  title={disabled ? t("settings.projectRequired") : item.label}
                  aria-current={selected ? "page" : undefined}
                  onClick={() => activateSection(item.id)}
                >
                  <SettingsSectionIcon section={item.id} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
          <button type="button" onClick={onClose} title={t("i18n.close")} aria-label={t("i18n.close")} className="config-close-button settings-dialog-close">×</button>
        </div>

        <main className="settings-dialog-main">
          {sectionHost("general", <GeneralSettings sessionId={sessionId} toolPresetControl={toolPresetControl} soundEnabled={soundEnabled} onSoundToggle={onSoundToggle} dumbZoneTokens={dumbZoneTokens} onDumbZoneTokensChange={onDumbZoneTokensChange} onSessionReloaded={onSessionReloaded} />)}
          {sectionHost("models", <ModelsConfig embedded onClose={onClose} />)}
          {cwd && sectionHost("skills", <SkillsConfig embedded key={cwd} cwd={cwd} onClose={onClose} />)}
          {cwd && sectionHost("plugins", <PluginsConfig embedded key={cwd} cwd={cwd} sessionId={sessionId} onClose={onClose} onReloaded={onSessionReloaded} />)}
        </main>
      </div>
    </div>
  );
}
