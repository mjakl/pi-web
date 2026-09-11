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
import { ThemeIcon } from "./icons.tsx";

/** pi-web's order: light, dark, then system (§8.2). */
const THEME_OPTIONS = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "auto", label: "System" },
] as const;

// Settings are plain pages: one section at a time, swapped by HTMX. Nothing
// here holds state the server does not already know, except the three browser
// preferences at the top, which only the browser can honour.

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

/** Desktop tabs and the mobile picker render the same list, one hidden. */
function SectionNav({ active, cwd }: { active: SettingsSection; cwd: string }) {
  const usable = (section: (typeof SETTINGS_SECTIONS)[number]) =>
    !section.needsProject || cwd !== "";
  return (
    <>
      <select
        class="settings-mobile-section-picker"
        aria-label="Settings section"
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
      <ul class="settings-section-tabs">
        {SETTINGS_SECTIONS.map((section) => (
          <li>
            <a
              href={sectionHref(section.key, cwd)}
              class="settings-section-tab"
              {...(section.key === active ? { "aria-current": "page" } : {})}
              {...(usable(section)
                ? {}
                : { title: "Open a project to configure this section" })}
            >
              {section.label}
            </a>
          </li>
        ))}
      </ul>
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
          <label>
            <input id="sound-toggle" type="checkbox" checked />
            <span>Play a tone when a turn finishes</span>
          </label>
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
          <label>
            <input id="push-toggle" type="checkbox" />
            <span>Notify this browser when a run finishes</span>
          </label>
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

function TrustNotice({ what }: { what: string }) {
  return (
    <div role="status">
      Project {what} are not loaded because this project is not trusted.
    </div>
  );
}

function ScopePicker({
  name,
  trusted,
  target,
}: {
  name: string;
  trusted: boolean;
  target: string;
}) {
  return (
    <select
      name={name}

      aria-label="Install scope"
      title={
        trusted
          ? undefined
          : "Project installs are unavailable while project resources are not loaded."
      }
    >
      <option value="global">Global</option>
      <option value="project" disabled={!trusted}>
        Project ({target})
      </option>
    </select>
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

export function SkillList({
  view,
  selected,
}: {
  view: SkillsView;
  selected?: string;
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
    <ul id="skill-list">
      {groups.length === 0 ? <li>No skills in this folder</li> : null}
      {groups.map((group) => (
        <>
          <li>{group.label}</li>
          {group.skills.map((skill) => (
            <li>
              <button
                type="button"
                class="menu-item"
                aria-current={skill.filePath === selected ? "true" : "false"}
                hx-get={`/settings/skills/detail?cwd=${encodeURIComponent(view.cwd)}&path=${encodeURIComponent(skill.filePath)}`}
                hx-target="#skill-detail"
                hx-swap="innerHTML"
              >
                <span>{skill.name}</span>
                {skill.disableModelInvocation ? <span>Manual</span> : null}
                {updated.has(skill.install?.package ?? "") ? (
                  <span title="Update available">↑</span>
                ) : null}
              </button>
            </li>
          ))}
        </>
      ))}
    </ul>
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
    return <p>Select a skill to see what it does.</p>;
  }
  const install = skill.install;
  const relative = skill.filePath.startsWith(`${cwd}/`)
    ? `./${skill.filePath.slice(cwd.length + 1)}`
    : shortPath(skill.filePath, home);
  return (
    <div id="skill-detail-body">
      <div>
        <span>{skill.scope}</span>
        <code title={skill.filePath}>{relative}</code>
      </div>
      <div>
        <button
          type="button"
          role="switch"
          aria-checked={skill.disableModelInvocation ? "false" : "true"}
          hx-post="/settings/skills/toggle"
          hx-vals={JSON.stringify({
            cwd,
            path: skill.filePath,
            disable: skill.disableModelInvocation ? "" : "1",
          })}
          hx-target="#skill-detail"
          hx-swap="innerHTML"
        >
          {skill.disableModelInvocation ? "Manual" : "Model-visible"}
        </button>
        <span>
          {skill.disableModelInvocation
            ? "Only you can invoke this skill."
            : "Pi may invoke this skill on its own."}
        </span>
      </div>
      {install?.skillsShUrl ? (
        <p>
          Source:{" "}
          <a href={install.skillsShUrl} target="_blank" rel="noreferrer">
            {install.source}
          </a>
        </p>
      ) : null}
      {install ? (
        <div>
          <span>Version</span>
          <code>{(install.versionHash ?? "unknown").slice(0, 8)}</code>
          {install.canCheckForUpdates ? (
            <button
              type="button"

              hx-post="/settings/skills/check"
              hx-vals={JSON.stringify({
                cwd,
                path: skill.filePath,
                package: install.package,
                scope: install.scope,
              })}
              hx-target="#skill-detail"
              hx-swap="innerHTML"
            >
              Check
            </button>
          ) : null}
          {update?.state === "update-available" ? (
            <>
              <code>{(update.latestVersion ?? "").slice(0, 8)}</code>
              <button
                type="button"

                hx-post="/settings/skills/update"
                hx-vals={JSON.stringify({
                  cwd,
                  path: skill.filePath,
                  package: install.package,
                  scope: install.scope,
                })}
                hx-target="#skill-detail"
                hx-swap="innerHTML"
              >
                Update
              </button>
            </>
          ) : null}
          {update ? (
            <span>
              {update.state === "up-to-date"
                ? "Up to date"
                : update.state === "unsupported"
                  ? "Automatic checks unavailable"
                  : update.state === "error"
                    ? (update.message ?? "Check failed")
                    : "Update available"}
            </span>
          ) : null}
        </div>
      ) : null}
      <div>
        <h4>Name</h4>
        <p>{skill.name}</p>
      </div>
      <div>
        <h4>Description</h4>
        <p>{skill.description}</p>
      </div>
      {message === undefined ? null : <pre>{message}</pre>}
    </div>
  );
}

export function SkillSearchResults({
  hits,
  cwd,
  trusted,
  message,
}: {
  hits: SkillSearchHit[];
  cwd: string;
  trusted: boolean;
  message?: string;
}) {
  return (
    <div id="skill-search-results">
      {message === undefined ? null : <p role="status">{message}</p>}
      {hits.length === 0 && message === undefined ? (
        <p>No skills found</p>
      ) : null}
      {hits.map((hit) => (
        <div>
          <span>{hit.package}</span>
          <span>{hit.installs}</span>
          {hit.url === "" ? null : (
            <a href={hit.url} target="_blank" rel="noreferrer">
              skills.sh
            </a>
          )}
          <form
            hx-post="/settings/skills/install"
            hx-target="#skill-search-results"
            hx-swap="outerHTML"
          >
            <input type="hidden" name="cwd" value={cwd} />
            <input type="hidden" name="package" value={hit.package} />
            <ScopePicker name="scope" trusted={trusted} target=".pi/skills" />
            <button>Install</button>
          </form>
        </div>
      ))}
    </div>
  );
}

export function SkillsSection({
  view,
  selected,
  home,
}: {
  view: SkillsView;
  selected?: string;
  home?: string;
}) {
  const skill =
    view.skills.find(
      (entry) => entry.filePath === (selected ?? view.selected),
    ) ?? view.skills[0];
  return (
    <div>
      {view.projectResourcesLoaded ? null : <TrustNotice what="skills" />}
      <div>
        <div>
          <SkillList view={view} selected={skill?.filePath} />
        </div>
        <div id="skill-detail">
          <SkillDetail cwd={view.cwd} skill={skill} home={home} />
        </div>
      </div>
      <details>
        <summary>Add skill</summary>
        <form
          hx-post="/settings/skills/search"
          hx-target="#skill-search-results"
          hx-swap="outerHTML"
        >
          <input type="hidden" name="cwd" value={view.cwd} />
          <input
            name="query"

            placeholder="Search skills.sh"
            aria-label="Search skills"
          />
          <button>Search</button>
        </form>
        <div>
          <SkillSearchResults
            hits={[]}
            cwd={view.cwd}
            trusted={view.projectResourcesLoaded}
            message="Search skills.sh to install a skill."
          />
        </div>
      </details>
      <div>
        <button
          type="button"

          hx-post="/settings/skills/check"
          hx-vals={JSON.stringify({ cwd: view.cwd })}
          hx-target="#settings-body"
          hx-swap="innerHTML"
        >
          Check updates
        </button>
        {view.updates === undefined ? null : (
          <span>
            {String(
              view.updates.filter(
                (update) => update.state === "update-available",
              ).length,
            )}{" "}
            update(s)
          </span>
        )}
        {view.diagnostics.map((message) => (
          <span>{message}</span>
        ))}
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
  return `${info.scope} ${info.source}`;
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
    return <p>Select a plugin to see what it provides.</p>;
  }
  const act = (action: string) =>
    JSON.stringify({
      cwd,
      action,
      source: info.source,
      scope: info.scope,
      selected: pluginKey(info),
    });
  return (
    <div>
      <div>
        <span>{info.scope === "user" ? "global" : "project"}</span>
        {info.disabled ? <span>Disabled</span> : null}
        {info.filtered ? <span>filtered</span> : null}
        <code>{info.source}</code>
      </div>
      <div>
        <button
          type="button"

          hx-post="/settings/plugins"
          hx-vals={act("update")}
          hx-target="#settings-body"
          hx-swap="innerHTML"
        >
          Update
        </button>
        <button
          type="button"

          hx-post="/settings/plugins"
          hx-vals={act(info.disabled ? "enable" : "disable")}
          hx-target="#settings-body"
          hx-swap="innerHTML"
          title={
            info.disabled
              ? "Re-enabling writes the plain source back; any per-resource filters it carried are lost."
              : "Disabling keeps the entry but loads none of its resources."
          }
        >
          {info.disabled ? "Enable" : "Disable"}
        </button>
        <button
          type="button"

          hx-post="/settings/plugins"
          hx-vals={act("remove")}
          hx-target="#settings-body"
          hx-swap="innerHTML"
          hx-confirm="Remove this plugin and its settings entry?"
        >
          Remove
        </button>
      </div>
      <dl>
        <dt>Status</dt>
        <dd>{info.status}</dd>
        <dt>Version</dt>
        <dd>
          {info.version ?? "unknown"}
          {info.configuredVersion === undefined
            ? ""
            : ` · configured ${info.configuredVersion}`}
        </dd>
        <dt>Package</dt>
        <dd>{info.packageName ?? "unknown"}</dd>
        <dt>Installed path</dt>
        <dd>
          {info.installedPath === undefined
            ? "Not found"
            : shortPath(info.installedPath, home)}
        </dd>
      </dl>
      <div>
        <h4>Resolved resources</h4>
        {info.resources.length === 0 ? (
          <p>{info.disabled ? "Disabled" : "No resources"}</p>
        ) : (
          <ul>
            {info.resources.map((resource) => (
              <li title={resource.path}>
                <span>{resource.name}</span>{" "}
                <span>
                  {resource.kind} · {resource.relativePath}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {message === undefined ? null : <p role="status">{message}</p>}
    </div>
  );
}

export function PluginsSection({
  cwd,
  view,
  selected,
  message,
  home,
}: {
  cwd: string;
  view: PackagesView;
  selected?: string;
  message?: string;
  home?: string;
}) {
  const info =
    view.packages.find((entry) => pluginKey(entry) === selected) ??
    view.packages[0];
  const scopes = [
    { scope: "project" as PackageScope, label: "Project" },
    { scope: "user" as PackageScope, label: "Global" },
  ];
  return (
    <div>
      {view.projectResourcesLoaded ? null : <TrustNotice what="plugins" />}
      <div>
        <div>
          <ul>
            {view.packages.length === 0 ? <li>No plugins configured</li> : null}
            {scopes.map((group) => {
              const rows = view.packages.filter(
                (entry) => entry.scope === group.scope,
              );
              if (rows.length === 0) return <></>;
              return (
                <>
                  <li>{group.label}</li>
                  {rows.map((entry) => (
                    <li>
                      <button
                        type="button"
                        class="menu-item"
                        aria-current={
                          pluginKey(entry) === pluginKey(info ?? entry)
                            ? "true"
                            : "false"
                        }
                        hx-get={`/settings/plugins?cwd=${encodeURIComponent(cwd)}&selected=${encodeURIComponent(pluginKey(entry))}`}
                        hx-target="#settings-body"
                        hx-swap="innerHTML"
                      >
                        <span
                          class="config-status-dot"
                          style={`background:${STATUS_COLOUR[entry.status]}`}
                          aria-label={entry.status}
                        />
                        <span>{entry.source}</span>
                      </button>
                    </li>
                  ))}
                </>
              );
            })}
          </ul>
        </div>
        <div>
          <PluginDetail
            cwd={cwd}
            {...(info ? { info } : {})}
            {...(message === undefined ? {} : { message })}
            {...(home === undefined ? {} : { home })}
          />
        </div>
      </div>
      <details open={view.packages.length === 0}>
        <summary>Add plugin</summary>
        <form
          hx-post="/settings/plugins"
          hx-target="#settings-body"
          hx-swap="innerHTML"
        >
          <input type="hidden" name="cwd" value={cwd} />
          <input type="hidden" name="action" value="install" />
          <input
            name="source"

            placeholder="npm:@scope/pi-plugin"
            aria-label="Plugin source"
          />
          <ScopePicker
            name="scope"
            trusted={view.projectResourcesLoaded}
            target=".pi"
          />
          <button>Install</button>
        </form>
        <p>
          npm:@scope/pi-plugin · git:https://github.com/user/repo ·
          /absolute/path/to/plugin
        </p>
      </details>
      <div>
        <span>
          {String(view.totals.extensions)} ext · {String(view.totals.skills)}{" "}
          skills · {String(view.totals.prompts)} prompts ·{" "}
          {String(view.totals.themes)} themes
        </span>
        {view.diagnostics.map((diagnostic) => (
          <span
            style={
              diagnostic.type === "error"
                ? "color:var(--danger)"
                : "color:var(--warning)"
            }
            title={diagnostic.source}
          >
            {diagnostic.message}
          </span>
        ))}
        <button
          type="button"

          hx-get={`/settings/plugins?cwd=${encodeURIComponent(cwd)}`}
          hx-target="#settings-body"
          hx-swap="innerHTML"
        >
          Refresh
        </button>
        {/* A plugin change only reaches a session that is rebuilt: this asks
            every live session of this folder to reload its resources. */}
        <button
          type="button"

          title="Reload extensions, skills, and prompts in the sessions of this folder"
          hx-post="/settings/plugins/reload"
          hx-vals={JSON.stringify({ cwd })}
          hx-target="#settings-body"
          hx-swap="innerHTML"
        >
          Reload sessions
        </button>
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
      <div role="alert">
        <span>{error}</span>
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

export function SettingsPage(props: {
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
    <div>
      <div>
        <h1>Settings</h1>
        {props.cwd === "" ? null : (
          <code>{shortPath(props.cwd, props.home)}</code>
        )}
        <a href={props.back}>Close</a>
      </div>
      <input id="settings-cwd" type="hidden" name="cwd" value={props.cwd} />
      <div>
        <SectionNav active={props.section} cwd={props.cwd} />
        <div id="settings-body">
          <SettingsBody {...props} />
        </div>
      </div>
    </div>
  );
}
