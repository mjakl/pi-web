import {
  type PackageInfo,
  type PackagesView,
  type PackageScope,
} from "@core/packages";
import {
  SKILL_GROUPS,
  skillGroup,
  type SkillInfo,
  type SkillSearchHit,
  type SkillUpdate,
} from "@core/skills";
import { DEFAULT_WARN_TOKENS } from "@core/context-usage";
import { shortPath } from "@core/workspaces";
import type { SidebarView } from "@core/workspace";
import { Shell } from "./SessionPage.tsx";
import {
  AddConfigIcon,
  PiDevLogoIcon,
  SettingsSectionIcon,
  ThemeIcon,
} from "./icons.tsx";

// Settings is pi-web's modal over the app: a 1080px surface with a tabbed
// header and, in Skills and Plugins, a list/detail split view. Every class
// name here is pi-web's (components/SettingsPanel.tsx, SettingsUi.tsx,
// SkillsConfig.tsx, PluginsConfig.tsx; app/settings.css). Sections are
// server-rendered pages swapped by HTMX, not React state.

/** pi-web's order: light, dark, then system. */
const THEME_OPTIONS = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "auto", label: "System" },
] as const;

export const SETTINGS_SECTIONS = [
  { key: "general", label: "General", needsProject: false },
  { key: "skills", label: "Skills", needsProject: true },
  { key: "plugins", label: "Plugins", needsProject: true },
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["key"];

export function isSettingsSection(value: string): value is SettingsSection {
  return SETTINGS_SECTIONS.some((section) => section.key === value);
}

/** A section that needs a folder falls back to general when there is none. */
export function resolveSection(
  value: string | undefined,
  hasProject: boolean,
): SettingsSection {
  if (value === undefined || !isSettingsSection(value)) return "general";
  const section = SETTINGS_SECTIONS.find((entry) => entry.key === value);
  return section && section.needsProject && !hasProject ? "general" : value;
}

function sectionHref(section: SettingsSection, cwd: string): string {
  const query = new URLSearchParams({ section });
  if (cwd !== "") query.set("cwd", cwd);
  return `/settings?${query.toString()}`;
}

// --- pi-web's shared config primitives (SettingsUi.tsx) --------------------

function ConfigButton({
  variant = "secondary",
  small,
  children,
  ...rest
}: {
  variant?: "primary" | "secondary" | "danger";
  small?: boolean;
  children?: unknown;
  [key: string]: unknown;
}) {
  return (
    <button
      type="button"
      {...rest}
      class={`config-button config-button-${variant} config-button-${small === true ? "small" : "default"}`}
    >
      {children}
    </button>
  );
}

/** pi-web draws a preference toggle as a button, never as a checkbox. */
function ConfigSwitch({
  checked,
  label,
  ...rest
}: {
  checked: boolean;
  label: string;
  [key: string]: unknown;
}) {
  return (
    <button
      type="button"
      {...rest}
      class="config-switch"
      role="switch"
      aria-checked={checked ? "true" : "false"}
      aria-label={label}
      title={label}
    >
      <span class="config-switch-knob" />
    </button>
  );
}

function ConfigField({
  label,
  children,
}: {
  label: string;
  children: unknown;
}) {
  return (
    <div class="config-field">
      <span class="config-field-label">{label}</span>
      {children}
    </div>
  );
}

/**
 * Global / project scope, as pi-web's segmented control. The chosen scope
 * rides in a hidden field so the surrounding form still posts it; the two
 * buttons are wired up in src/web/client/shell.ts.
 */
function ScopePicker({ name, trusted }: { name: string; trusted: boolean }) {
  return (
    <>
      <input type="hidden" name={name} value="global" data-scope-value />
      <div class="config-scope-picker" data-scope-picker>
        <button type="button" aria-pressed="true" data-scope="global">
          global
        </button>
        <button
          type="button"
          aria-pressed="false"
          data-scope="project"
          disabled={!trusted}
          {...(trusted
            ? {}
            : {
                title:
                  "Project installs are unavailable while project resources are not loaded.",
              })}
        >
          project
        </button>
      </div>
    </>
  );
}

function TrustNotice({ what }: { what: string }) {
  return (
    <div role="status" class="config-trust-notice">
      Project {what} are not loaded because this project is not trusted.
    </div>
  );
}

/** Desktop tabs and the mobile picker render the same list, one hidden. */
function SectionNav({ active, cwd }: { active: SettingsSection; cwd: string }) {
  const usable = (section: (typeof SETTINGS_SECTIONS)[number]) =>
    !section.needsProject || cwd !== "";
  return (
    <>
      <select
        class="settings-mobile-section-picker"
        aria-label="Settings"
        // A native select is the whole mobile navigation: no script, no menu.
        hx-get="/settings"
        hx-target="body"
        hx-swap="innerHTML"
        hx-push-url="true"
        name="section"
        hx-include="#settings-cwd"
        hx-trigger="change"
      >
        {SETTINGS_SECTIONS.map((section) => (
          <option
            value={section.key}
            selected={section.key === active}
            disabled={!usable(section)}
          >
            {section.label}
          </option>
        ))}
      </select>
      <nav class="settings-section-tabs" aria-label="Settings">
        {SETTINGS_SECTIONS.map((section) =>
          usable(section) ? (
            <a
              href={sectionHref(section.key, cwd)}
              class="settings-section-tab"
              title={section.label}
              {...(section.key === active ? { "aria-current": "page" } : {})}
            >
              <SettingsSectionIcon section={section.key} />
              <span>{section.label}</span>
            </a>
          ) : (
            <button
              type="button"
              class="settings-section-tab"
              disabled
              title="Open a project to configure this section"
            >
              <SettingsSectionIcon section={section.key} />
              <span>{section.label}</span>
            </button>
          ),
        )}
      </nav>
    </>
  );
}

/** web-pi's own version and the Pi SDK it resolved at startup. */
export type About = { webPi: string; pi: string };

/** Preferences the server cannot hold: they belong to this browser. */
function GeneralSettings({
  about,
  warnTokens,
}: {
  about?: About;
  warnTokens: number;
}) {
  return (
    <div class="settings-general">
      <h2 class="settings-general-title">General</h2>
      <section class="settings-general-section">
        <h3 class="settings-general-heading">Appearance</h3>
        <p class="settings-general-description">
          Select a theme or follow your system preference.
        </p>
        {/* Which option is checked depends on localStorage, so the server
            renders all three unchecked and src/web/client/theme.ts marks the
            stored one as soon as the page is up. */}
        <div
          role="radiogroup"
          aria-label="Appearance"
          class="settings-theme-options"
        >
          {THEME_OPTIONS.map((option) => (
            <button
              type="button"
              role="radio"
              aria-checked="false"
              data-theme-option={option.id}
              class="settings-theme-option"
            >
              <ThemeIcon preference={option.id} />
              <span class="settings-theme-option-label">{option.label}</span>
            </button>
          ))}
        </div>
      </section>
      <section class="settings-general-section">
        <h3 class="settings-general-heading">Dumb zone</h3>
        <p class="settings-general-description">
          Highlight context usage and Compact when the current context reaches
          this many tokens.
        </p>
        <div class="settings-general-option">
          <label for="dumb-zone-tokens">Token threshold</label>
          <input
            id="dumb-zone-tokens"
            class="settings-number-input"
            type="number"
            min="1"
            step="1000"
            value={String(warnTokens)}
          />
        </div>
      </section>
      <section class="settings-general-section">
        <h3 class="settings-general-heading">Completion sound</h3>
        <p class="settings-general-description">
          Play a tone when a task finishes.
        </p>
        <div class="settings-general-option">
          <span>Completion sound</span>
          <ConfigSwitch
            id="sound-toggle"
            checked
            label="Disable completion sound"
          />
        </div>
      </section>
      <section class="settings-general-section">
        <h3 class="settings-general-heading">Notifications</h3>
        <p class="settings-general-description">
          Needs permission from the browser, and reaches you with the tab
          closed.
        </p>
        <div class="settings-general-option">
          <span>Run finished</span>
          <ConfigSwitch
            id="push-toggle"
            checked={false}
            label="Notify this browser when a run finishes"
          />
        </div>
      </section>
      {about === undefined ? null : (
        <section class="settings-general-section">
          <h3 class="settings-general-heading">About</h3>
          <p class="settings-general-description">
            web-pi {about.webPi} · pi {about.pi}
          </p>
        </section>
      )}
    </div>
  );
}

// --- Skills ----------------------------------------------------------------

export type SkillsView = {
  cwd: string;
  skills: SkillInfo[];
  diagnostics: string[];
  projectResourcesLoaded: boolean;
  /** The last check, so a row can carry its ↑ marker. */
  updates?: SkillUpdate[];
  /** The skill this folder was last looking at. */
  selected?: string;
};

function detailHref(cwd: string, path: string): string {
  return `/settings/skills/detail?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`;
}

function SkillList({
  view,
  selected,
  add,
}: {
  view: SkillsView;
  selected?: string;
  add?: boolean;
}) {
  const updated = new Set(
    (view.updates ?? [])
      .filter((update) => update.state === "update-available")
      .map((update) => update.package),
  );
  const groups = SKILL_GROUPS.map((group) => ({
    ...group,
    skills: view.skills.filter((skill) => skillGroup(skill) === group.key),
  })).filter((group) => group.skills.length > 0);
  return (
    <div class="config-sidebar-list">
      {groups.length === 0 ? (
        <div class="config-sidebar-message is-empty">No skills found</div>
      ) : null}
      {groups.map((group) => (
        <div class="config-sidebar-group">
          <div class="config-sidebar-group-label">{group.label}</div>
          {group.skills.map((skill) => (
            <button
              type="button"
              class="config-sidebar-item"
              {...(add !== true && skill.filePath === selected
                ? { "aria-current": "page" }
                : {})}
              hx-get={detailHref(view.cwd, skill.filePath)}
              hx-target="#settings-body"
              hx-swap="innerHTML"
            >
              <span class="config-sidebar-text is-grow">{skill.name}</span>
              {skill.disableModelInvocation ? (
                <span class="skill-mode-badge">Manual</span>
              ) : null}
              {updated.has(skill.install?.package ?? "") ? (
                <span class="skill-update-indicator" title="Update available">
                  ↑
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/** One skill: what it is, who may call it, and where it came from. */
export function SkillDetail({
  cwd,
  skill,
  update,
  message,
  home,
}: {
  cwd: string;
  skill?: SkillInfo;
  update?: SkillUpdate;
  message?: string;
  home?: string;
}) {
  if (!skill) {
    return <div class="config-empty-state">Select a skill</div>;
  }
  const install = skill.install;
  const relative = skill.filePath.startsWith(`${cwd}/`)
    ? `./${skill.filePath.slice(cwd.length + 1)}`
    : shortPath(skill.filePath, home);
  const manual = skill.disableModelInvocation;
  const action = (extra: Record<string, string>) =>
    JSON.stringify({ cwd, path: skill.filePath, ...extra });
  return (
    <div class="config-detail-stack">
      <div class="skill-detail-heading">
        <div class="config-detail-header">
          <div class="config-detail-header-info">
            <span
              class={
                skill.scope === "project"
                  ? "config-scope-tag is-project"
                  : "config-scope-tag"
              }
            >
              {skill.scope}
            </span>
            <span class="config-detail-path" title={skill.filePath}>
              {relative}
            </span>
          </div>
          <div class="config-detail-actions">
            <ConfigSwitch
              checked={!manual}
              label={manual ? "Switch to Model-visible" : "Switch to Manual"}
              hx-post="/settings/skills/toggle"
              hx-vals={action({ disable: manual ? "" : "1" })}
              hx-target="#settings-body"
              hx-swap="innerHTML"
            />
          </div>
        </div>
        <div class="skill-detail-status-row">
          <span class="skill-mode-label">
            {manual ? "Manual" : "Model-visible"}
          </span>
          {message === undefined ? null : (
            <span style="font-size:12px; color:var(--danger); overflow-wrap:anywhere">
              {message}
            </span>
          )}
        </div>
      </div>
      {install?.skillsShUrl ? (
        <ConfigField label="Source">
          <a
            class="skill-source-link"
            href={install.skillsShUrl}
            target="_blank"
            rel="noreferrer"
            title={install.skillsShUrl}
          >
            <span class="skill-source-link-text">
              {install.skillsShUrl.replace(/^https?:\/\//, "")} ↗
            </span>
          </a>
        </ConfigField>
      ) : null}
      {install ? (
        <ConfigField label="Version">
          <div class="skill-version-row">
            <span class="skill-version-value">
              {(install.versionHash ?? "unknown").slice(0, 8)}
            </span>
            {install.canCheckForUpdates ? (
              <ConfigButton
                small
                hx-post="/settings/skills/check"
                hx-vals={action({
                  package: install.package,
                  scope: install.scope,
                })}
                hx-target="#settings-body"
                hx-swap="innerHTML"
              >
                Check
              </ConfigButton>
            ) : null}
            {update?.state === "update-available" ? (
              <span class="skill-version-value is-update">
                {(update.latestVersion ?? "").slice(0, 8)}
              </span>
            ) : null}
            {update === undefined ||
            update.state === "update-available" ? null : (
              <span
                class={`skill-update-status ${
                  update.state === "up-to-date"
                    ? "is-success"
                    : update.state === "error"
                      ? "is-error"
                      : "is-muted"
                }`}
              >
                {update.state === "up-to-date"
                  ? "Up to date"
                  : update.state === "unsupported"
                    ? "Automatic checks unavailable"
                    : (update.message ?? "Check failed")}
              </span>
            )}
            {update?.state === "update-available" ? (
              <ConfigButton
                variant="primary"
                small
                hx-post="/settings/skills/update"
                hx-vals={action({
                  package: install.package,
                  scope: install.scope,
                })}
                hx-target="#settings-body"
                hx-swap="innerHTML"
              >
                Update
              </ConfigButton>
            ) : null}
          </div>
        </ConfigField>
      ) : null}
      <ConfigField label="Name">
        <span class="skill-name-value">{skill.name}</span>
      </ConfigField>
      <ConfigField label="Description">
        <span class="skill-description">{skill.description}</span>
      </ConfigField>
    </div>
  );
}

export function SkillSearchResults({
  hits,
  cwd,
  message,
}: {
  hits: SkillSearchHit[];
  cwd: string;
  message?: string;
}) {
  return (
    <div id="skill-search-results" style="flex:1; overflow-y:auto">
      {message === undefined ? null : (
        <div role="status" style="font-size:12px; color:var(--text-dim)">
          {message}
        </div>
      )}
      {hits.length === 0 && message === undefined ? (
        <div style="font-size:12px; color:var(--text-dim)">No skills found</div>
      ) : null}
      {hits.map((hit) => {
        const at = hit.package.indexOf("@");
        const repo = at > -1 ? hit.package.slice(0, at) : hit.package;
        const name = at > -1 ? hit.package.slice(at + 1) : repo;
        return (
          <div style="display:flex; align-items:center; gap:14px; padding:12px 0; border-bottom:1px solid var(--border)">
            <div style="flex:1; min-width:0">
              <div style="font-size:13px; font-weight:600; color:var(--text); margin-bottom:3px">
                {name}
              </div>
              <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap">
                <span style="font-family:var(--font-mono); font-size:11px; color:var(--text-dim)">
                  {repo}
                </span>
                <span style="font-size:12px; color:var(--text-muted); font-weight:500">
                  {hit.installs}
                </span>
                {hit.url === "" ? null : (
                  <a
                    href={hit.url}
                    target="_blank"
                    rel="noreferrer"
                    style="font-size:12px; color:var(--accent); text-decoration:none"
                  >
                    skills.sh ↗
                  </a>
                )}
              </div>
            </div>
            <form
              style="flex-shrink:0"
              hx-post="/settings/skills/install"
              hx-target="#skill-search-results"
              hx-swap="outerHTML"
              hx-include="[data-scope-value]"
            >
              <input type="hidden" name="cwd" value={cwd} />
              <input type="hidden" name="package" value={hit.package} />
              <button
                type="submit"
                class="config-button config-button-secondary config-button-small"
                style="background:none; color:var(--text-muted)"
              >
                Install
              </button>
            </form>
          </div>
        );
      })}
    </div>
  );
}

/** The detail pane in add mode: search skills.sh and install one. */
function AddSkillPanel({ view, home }: { view: SkillsView; home?: string }) {
  return (
    <div class="config-detail-stack is-full-height">
      <form
        style="display:flex; flex-direction:column; gap:12px; margin-bottom:20px"
        hx-post="/settings/skills/search"
        hx-target="#skill-search-results"
        hx-swap="outerHTML"
      >
        <div class="config-detail-title">Add skill</div>
        <input type="hidden" name="cwd" value={view.cwd} />
        <div style="display:flex; gap:8px">
          <input
            name="query"
            style="flex:1; padding:7px 10px; font-size:12px; background:var(--bg-panel); border:1px solid var(--border); border-radius:6px; color:var(--text); outline:none"
            placeholder="e.g. react, testing, deploy"
            aria-label="Search skills"
          />
          <button
            type="submit"
            class="config-button config-button-primary config-button-default"
          >
            Search
          </button>
        </div>
        <div style="display:flex; align-items:center; gap:10px">
          <ScopePicker name="scope" trusted={view.projectResourcesLoaded} />
          <span
            style="font-size:12px; color:var(--text-dim); font-family:var(--font-mono); overflow:hidden; text-overflow:ellipsis; white-space:nowrap"
            data-scope-path
            data-scope-path-global="→ ~/.pi/agent/skills/"
            data-scope-path-project={`→ ${shortPath(view.cwd, home)}/.pi/skills/`}
          >
            → ~/.pi/agent/skills/
          </span>
        </div>
      </form>
      <SkillSearchResults
        hits={[]}
        cwd={view.cwd}
        message="Search skills.sh to discover and install skills for your agent."
      />
    </div>
  );
}

export function SkillsSection({
  view,
  selected,
  add,
  update,
  message,
  home,
}: {
  view: SkillsView;
  selected?: string;
  /** The detail pane shows the add form instead of a skill. */
  add?: boolean;
  /** The result of the last single-skill check, for the version row. */
  update?: SkillUpdate;
  message?: string;
  home?: string;
}) {
  const wanted = selected ?? view.selected;
  const skill =
    view.skills.find((entry) => entry.filePath === wanted) ?? view.skills[0];
  const pending = (view.updates ?? []).filter(
    (entry) => entry.state === "update-available",
  ).length;
  return (
    <div class="config-panel-root">
      <div class="config-panel-surface">
        {view.projectResourcesLoaded ? null : <TrustNotice what="skills" />}
        <div class="config-split-view">
          <aside class="config-sidebar">
            <SkillList
              view={view}
              {...(skill === undefined ? {} : { selected: skill.filePath })}
              {...(add === true ? { add: true } : {})}
            />
            <div class="config-list-action">
              <button
                type="button"
                class="config-list-action-button"
                {...(add === true ? { "aria-current": "page" } : {})}
                hx-get={`/settings/skills/detail?cwd=${encodeURIComponent(view.cwd)}&add=1`}
                hx-target="#settings-body"
                hx-swap="innerHTML"
              >
                <AddConfigIcon />
                Add skill
              </button>
            </div>
          </aside>
          <div class="config-detail">
            {add === true ? (
              <AddSkillPanel
                view={view}
                {...(home === undefined ? {} : { home })}
              />
            ) : (
              <div class="config-detail-stack is-fill">
                <SkillDetail
                  cwd={view.cwd}
                  {...(skill ? { skill } : {})}
                  {...(update === undefined ? {} : { update })}
                  {...(message === undefined ? {} : { message })}
                  {...(home === undefined ? {} : { home })}
                />
              </div>
            )}
          </div>
        </div>
        <footer class="config-footer">
          <div class="config-footer-status">
            {pending === 0 ? (
              view.diagnostics.map((diagnostic) => <span>{diagnostic}</span>)
            ) : (
              <span style="font-size:12px; color:var(--warning)">
                {String(pending)} {pending === 1 ? "update" : "updates"}
              </span>
            )}
          </div>
          <div class="config-footer-actions">
            {view.skills.some((entry) => entry.install !== undefined) ? (
              <ConfigButton
                hx-post="/settings/skills/check"
                hx-vals={JSON.stringify({ cwd: view.cwd })}
                hx-target="#settings-body"
                hx-swap="innerHTML"
              >
                Check updates
              </ConfigButton>
            ) : null}
          </div>
        </footer>
      </div>
    </div>
  );
}

// --- Plugins ---------------------------------------------------------------

const STATUS_COLOUR = {
  loaded: "var(--accent)",
  installed: "var(--warning)",
  disabled: "var(--text-dim)",
  missing: "var(--danger)",
} as const;

function pluginKey(info: PackageInfo): string {
  return `${info.scope} ${info.source}`;
}

const RESOURCE_LABELS = [
  ["extensions", "ext"],
  ["skills", "skills"],
  ["prompts", "prompts"],
  ["themes", "themes"],
] as const;

/** pi-web's `resourceSummary`: one count per kind, dot-separated. */
function resourceSummary(info: PackageInfo): string {
  if (info.disabled) return "Disabled";
  const parts = RESOURCE_LABELS.flatMap(([kind, label]) => {
    const count = info.resources.filter(
      (resource) => resource.kind === kind,
    ).length;
    return count === 0 ? [] : [`${String(count)} ${label}`];
  });
  return parts.length === 0 ? "No resources" : parts.join(" · ");
}

/** pi-web's `versionSummary`: "installed 1.2.0 · configured ^1.2.0". */
function versionSummary(info: PackageInfo): string {
  const parts = [
    ...(info.version === undefined ? [] : [`installed ${info.version}`]),
    ...(info.configuredVersion === undefined
      ? []
      : [`configured ${info.configuredVersion}`]),
  ];
  return parts.length === 0 ? "Unknown" : parts.join(" · ");
}

function ScopeTag({ scope }: { scope: PackageScope }) {
  const project = scope === "project";
  return (
    <span
      style={`font-size:10px; padding:1px 5px; border-radius:3px; flex-shrink:0; background:${project ? "rgba(99,102,241,0.12)" : "rgba(120,120,120,0.12)"}; color:${project ? "rgba(99,102,241,0.85)" : "var(--text-dim)"}`}
    >
      {project ? "project" : "global"}
    </span>
  );
}

function InfoRow({
  label,
  value,
  style,
}: {
  label: string;
  value: string;
  style?: string;
}) {
  return (
    <>
      <div style="color:var(--text-dim)">{label}</div>
      <div style={style ?? "color:var(--text-muted)"}>{value}</div>
    </>
  );
}

export function PluginDetail({
  cwd,
  info,
  message,
  home,
}: {
  cwd: string;
  info?: PackageInfo;
  message?: string;
  home?: string;
}) {
  if (!info) {
    return <div class="config-empty-state">Select a package</div>;
  }
  const act = (action: string) =>
    JSON.stringify({
      cwd,
      action,
      source: info.source,
      scope: info.scope,
      selected: pluginKey(info),
    });
  const post = {
    "hx-post": "/settings/plugins",
    "hx-target": "#settings-body",
    "hx-swap": "innerHTML",
  };
  const mono =
    "color:var(--text-muted); font-family:var(--font-mono); overflow-wrap:anywhere";
  return (
    <div class="config-detail-stack">
      <div class="config-detail-header is-top-aligned">
        <div class="config-detail-header-info">
          <ScopeTag scope={info.scope} />
          {info.disabled ? (
            <span style="font-size:10px; padding:1px 5px; border-radius:3px; background:rgba(120,120,120,0.12); color:var(--text-dim)">
              Disabled
            </span>
          ) : info.filtered ? (
            <span style="font-size:10px; padding:1px 5px; border-radius:3px; background:rgba(245,158,11,0.12); color:var(--warning)">
              filtered
            </span>
          ) : null}
          <span style="font-family:var(--font-mono); font-size:12px; color:var(--text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap">
            {info.source}
          </span>
        </div>
        <div class="config-detail-actions">
          <ConfigButton small {...post} hx-vals={act("update")}>
            Update
          </ConfigButton>
          <ConfigButton
            small
            title="Reload extensions, skills, and prompts in the sessions of this folder"
            hx-post="/settings/plugins/reload"
            hx-vals={JSON.stringify({ cwd })}
            hx-target="#settings-body"
            hx-swap="innerHTML"
          >
            Reload session
          </ConfigButton>
          <ConfigButton
            variant="danger"
            small
            {...post}
            hx-vals={act("remove")}
            hx-confirm="Remove this plugin and its settings entry?"
          >
            Remove
          </ConfigButton>
          <ConfigSwitch
            checked={!info.disabled}
            label={info.disabled ? "Enable package" : "Disable package"}
            {...post}
            hx-vals={act(info.disabled ? "enable" : "disable")}
          />
        </div>
      </div>
      <div style="display:grid; grid-template-columns:minmax(96px, 130px) minmax(0, 1fr); gap:9px 14px; font-size:12px; line-height:1.45">
        <InfoRow
          label="Status"
          value={info.status}
          style={`color:${STATUS_COLOUR[info.status]}; text-transform:capitalize`}
        />
        <InfoRow
          label="Version"
          value={versionSummary(info)}
          style="color:var(--text-muted); font-family:var(--font-mono)"
        />
        <InfoRow
          label="Package"
          value={info.packageName ?? "Unknown"}
          style={mono}
        />
        <InfoRow label="Resources" value={resourceSummary(info)} />
        <InfoRow
          label="Installed path"
          value={
            info.installedPath === undefined
              ? "Not found"
              : shortPath(info.installedPath, home)
          }
          style={
            info.installedPath === undefined
              ? "color:var(--danger); font-family:var(--font-mono); overflow-wrap:anywhere"
              : mono
          }
        />
        <InfoRow
          label="CWD"
          value={shortPath(cwd, home)}
          style="color:var(--text-dim); font-family:var(--font-mono); overflow-wrap:anywhere"
        />
      </div>
      <div style="display:flex; flex-direction:column; gap:8px">
        <div class="config-section-title">Resolved Resources</div>
        {info.resources.length === 0 ? (
          <div style="font-size:12px; color:var(--text-dim)">
            No resolved resources
          </div>
        ) : (
          <div style="display:flex; flex-direction:column; gap:6px">
            {info.resources.map((resource) => (
              <div style="min-width:0" title={resource.path}>
                <div style="font-size:12px; color:var(--text); font-family:var(--font-mono); overflow:hidden; text-overflow:ellipsis; white-space:nowrap">
                  {resource.name}
                </div>
                <div style="font-size:10px; color:var(--text-dim); font-family:var(--font-mono); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-top:1px">
                  {resource.kind} · {resource.relativePath}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {message === undefined ? null : (
        <div
          role="status"
          style="font-size:12px; color:var(--success); white-space:pre-wrap"
        >
          {message}
        </div>
      )}
    </div>
  );
}

/** The detail pane in add mode: install a package by source. */
function AddPluginPanel({
  view,
  cwd,
  home,
}: {
  view: PackagesView;
  cwd: string;
  home?: string;
}) {
  const examples = [
    "npm:@scope/pi-plugin",
    "git:https://github.com/user/repo",
    "/absolute/path/to/plugin",
  ];
  return (
    <form
      class="config-detail-stack is-fill"
      hx-post="/settings/plugins"
      hx-target="#settings-body"
      hx-swap="innerHTML"
    >
      <input type="hidden" name="cwd" value={cwd} />
      <input type="hidden" name="action" value="install" />
      <div style="display:flex; flex-direction:column; gap:5px">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap">
          <div class="config-detail-title">Add plugin</div>
          <a
            href="https://pi.dev/packages"
            target="_blank"
            rel="noreferrer"
            style="display:inline-flex; align-items:center; gap:5px; color:var(--accent); font-size:12px; text-decoration:none; white-space:nowrap"
          >
            <PiDevLogoIcon />
            pi.dev/packages
          </a>
        </div>
        <div
          style="font-size:12px; color:var(--text-dim); font-family:var(--font-mono)"
          data-scope-path
          data-scope-path-global="~/.pi/agent/{npm,git}"
          data-scope-path-project={`${shortPath(cwd, home)}/.pi/agent/{npm,git}`}
        >
          ~/.pi/agent/{"{npm,git}"}
        </div>
      </div>
      <ConfigField label="Source">
        <input
          id="plugin-source"
          name="source"
          style="width:100%; height:36px; padding:0 11px; border:1px solid var(--border); border-radius:6px; background:var(--bg-panel); color:var(--text); font-family:var(--font-mono); font-size:12px; outline:none"
          placeholder="npm:@scope/package"
          aria-label="Plugin source"
        />
      </ConfigField>
      <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap">
        <ScopePicker name="scope" trusted={view.projectResourcesLoaded} />
        <button
          type="submit"
          class="config-button config-button-primary config-button-default is-pushed-right"
        >
          Install
        </button>
      </div>
      <div style="display:flex; flex-direction:column; gap:7px">
        <div style="font-size:12px; font-weight:600; color:var(--text-muted)">
          Examples
        </div>
        <div style="display:flex; flex-direction:column; gap:6px">
          {examples.map((example) => (
            <button
              type="button"
              data-plugin-example={example}
              style="width:100%; min-height:30px; text-align:left; padding:6px 9px; border:1px solid var(--border); border-radius:6px; background:var(--bg-panel); color:var(--text-dim); cursor:pointer; font-family:var(--font-mono); font-size:11px"
            >
              {example}
            </button>
          ))}
        </div>
      </div>
    </form>
  );
}

export function PluginsSection({
  cwd,
  view,
  selected,
  add,
  message,
  home,
}: {
  cwd: string;
  view: PackagesView;
  selected?: string;
  add?: boolean;
  message?: string;
  home?: string;
}) {
  const info =
    view.packages.find((entry) => pluginKey(entry) === selected) ??
    view.packages[0];
  const scopes: PackageScope[] = ["project", "user"];
  const errors = view.diagnostics.length;
  return (
    <div class="config-panel-root">
      <div class="config-panel-surface">
        {view.projectResourcesLoaded ? null : <TrustNotice what="plugins" />}
        <div class="config-split-view">
          <aside class="config-sidebar">
            <div class="config-sidebar-list">
              {view.packages.length === 0 ? (
                <div class="config-sidebar-message is-empty">
                  No plugins configured
                </div>
              ) : null}
              {scopes.map((scope) => {
                const rows = view.packages.filter(
                  (entry) => entry.scope === scope,
                );
                if (rows.length === 0) return <></>;
                return (
                  <div class="config-sidebar-group">
                    <div class="config-sidebar-group-label">
                      {scope === "user" ? "global" : "project"}
                    </div>
                    {rows.map((entry) => (
                      <button
                        type="button"
                        class="config-sidebar-item"
                        {...(add !== true &&
                        info !== undefined &&
                        pluginKey(entry) === pluginKey(info)
                          ? { "aria-current": "page" }
                          : {})}
                        hx-get={`/settings/plugins?cwd=${encodeURIComponent(cwd)}&selected=${encodeURIComponent(pluginKey(entry))}`}
                        hx-target="#settings-body"
                        hx-swap="innerHTML"
                      >
                        <span
                          class={
                            entry.disabled
                              ? "config-status-dot is-inactive"
                              : "config-status-dot is-active"
                          }
                          style={`background:${STATUS_COLOUR[entry.status]}`}
                          aria-hidden="true"
                        />
                        <span
                          class={
                            entry.disabled
                              ? "config-sidebar-text is-grow is-muted"
                              : "config-sidebar-text is-grow"
                          }
                        >
                          {entry.source}
                        </span>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
            <div class="config-list-action">
              <button
                type="button"
                class="config-list-action-button"
                {...(add === true ? { "aria-current": "page" } : {})}
                hx-get={`/settings/plugins?cwd=${encodeURIComponent(cwd)}&add=1`}
                hx-target="#settings-body"
                hx-swap="innerHTML"
              >
                <AddConfigIcon />
                Add plugin
              </button>
            </div>
          </aside>
          <div class="config-detail">
            {add === true || view.packages.length === 0 ? (
              <AddPluginPanel
                view={view}
                cwd={cwd}
                {...(home === undefined ? {} : { home })}
              />
            ) : (
              <PluginDetail
                cwd={cwd}
                {...(info ? { info } : {})}
                {...(message === undefined ? {} : { message })}
                {...(home === undefined ? {} : { home })}
              />
            )}
          </div>
        </div>
        <footer class="config-footer">
          <div class="config-footer-status">
            {errors === 0 ? (
              <span>
                {String(view.totals.extensions)} ext ·{" "}
                {String(view.totals.skills)} skills ·{" "}
                {String(view.totals.prompts)} prompts ·{" "}
                {String(view.totals.themes)} themes
              </span>
            ) : (
              <span
                style={
                  view.diagnostics.some(
                    (diagnostic) => diagnostic.type === "error",
                  )
                    ? "color:var(--danger)"
                    : "color:var(--warning)"
                }
                title={view.diagnostics
                  .map(
                    (diagnostic) =>
                      `${diagnostic.type}: ${diagnostic.source === undefined ? "" : `${diagnostic.source}: `}${diagnostic.message}`,
                  )
                  .join("\n")}
              >
                {String(errors)} diagnostic{errors === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <div class="config-footer-actions">
            <ConfigButton
              hx-get={`/settings/plugins?cwd=${encodeURIComponent(cwd)}`}
              hx-target="#settings-body"
              hx-swap="innerHTML"
            >
              Refresh
            </ConfigButton>
          </div>
        </footer>
      </div>
    </div>
  );
}

// --- Page ------------------------------------------------------------------

export function SettingsBody({
  section,
  cwd,
  skills,
  plugins,
  home,
  about,
  error,
  warnTokens,
}: {
  section: SettingsSection;
  cwd: string;
  skills?: SkillsView;
  plugins?: PackagesView;
  home?: string;
  about?: About;
  /** Loading the section failed; saying so beats a silent empty panel. */
  error?: string;
  /** The reader's context-warning threshold, from its cookie. */
  warnTokens?: number;
}) {
  if (error !== undefined) {
    return (
      <div role="alert" class="config-empty-state">
        {error}
      </div>
    );
  }
  if (section === "skills" && skills) {
    return (
      <SkillsSection view={skills} {...(home === undefined ? {} : { home })} />
    );
  }
  if (section === "plugins" && plugins) {
    return (
      <PluginsSection
        cwd={cwd}
        view={plugins}
        {...(home === undefined ? {} : { home })}
      />
    );
  }
  return (
    <GeneralSettings
      warnTokens={warnTokens ?? DEFAULT_WARN_TOKENS}
      {...(about === undefined ? {} : { about })}
    />
  );
}

/**
 * pi-web opens settings over the workspace, so the page renders the shell
 * behind the modal. `back` is where the close button and Escape lead.
 */
export function SettingsPage(props: {
  sidebar: SidebarView;
  section: SettingsSection;
  cwd: string;
  skills?: SkillsView;
  plugins?: PackagesView;
  home?: string;
  about?: About;
  error?: string;
  warnTokens?: number;
  back: string;
}) {
  return (
    <Shell
      sidebar={props.sidebar}
      {...(props.cwd === "" ? {} : { cwd: props.cwd })}
      {...(props.home === undefined ? {} : { home: props.home })}
    >
      <div style="height:100%; display:flex; align-items:center; justify-content:center; color:var(--text-muted); font-size:15px">
        Select a session to view the conversation
      </div>
      <input id="settings-cwd" type="hidden" name="cwd" value={props.cwd} />
      <dialog
        class="settings-dialog"
        aria-label="Settings"
        data-modal
        data-close-href={props.back}
        data-backdrop-close
        open
      >
        <div class="settings-dialog-surface" tabindex={-1} autofocus>
          <div class="settings-dialog-header">
            <strong class="settings-dialog-title">Settings</strong>
            <SectionNav active={props.section} cwd={props.cwd} />
            <a
              class="config-close-button settings-dialog-close"
              href={props.back}
              title="Close"
              aria-label="Close"
            >
              ×
            </a>
          </div>
          <main class="settings-dialog-main">
            <div id="settings-body" class="settings-section-host">
              <SettingsBody {...props} />
            </div>
          </main>
        </div>
      </dialog>
    </Shell>
  );
}
