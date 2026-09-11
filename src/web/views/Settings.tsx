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
import { shortPath } from "./Workspace.tsx";

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
        class="select mb-3 w-full select-sm md:hidden"
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
      <ul class="menu hidden w-48 shrink-0 p-0 text-sm md:block">
        {SETTINGS_SECTIONS.map((section) => (
          <li>
            <a
              href={sectionHref(section.key, cwd)}
              class={section.key === active ? "menu-active" : ""}
              {...(section.key === active ? { "aria-current": "page" } : {})}
              {...(usable(section)
                ? {}
                : {
                    title: "Open a project to configure this section",
                    class: "pointer-events-none opacity-40",
                  })}
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
    <div class="flex max-w-md flex-col gap-5">
      <fieldset>
        <legend class="pb-1 text-sm font-semibold">Appearance</legend>
        <select id="theme-select" class="select select-sm" aria-label="Theme">
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </fieldset>
      <fieldset>
        <legend class="pb-1 text-sm font-semibold">Completion sound</legend>
        <label class="flex items-center gap-2 text-sm">
          <input
            id="sound-toggle"
            type="checkbox"
            class="toggle toggle-sm"
            checked
          />
          <span>Play a tone when a turn finishes</span>
        </label>
      </fieldset>
      <fieldset>
        <legend class="pb-1 text-sm font-semibold">Notifications</legend>
        <label class="flex items-center gap-2 text-sm">
          <input id="push-toggle" type="checkbox" class="toggle toggle-sm" />
          <span>Notify this browser when a run finishes</span>
        </label>
        <p class="pt-1 text-xs text-base-content/50">
          Needs permission from the browser, and reaches you with the tab
          closed.
        </p>
      </fieldset>
      <fieldset>
        <legend class="pb-1 text-sm font-semibold">Dumb zone</legend>
        <label class="flex items-center gap-2 text-sm">
          <input
            id="dumb-zone-tokens"
            type="number"
            min="1"
            step="1000"
            value={String(warnTokens)}
            class="input w-32 input-sm"
          />
          <span class="text-base-content/60">
            Warn about context above this many tokens
          </span>
        </label>
      </fieldset>
      <p class="text-xs text-base-content/50">
        These are kept in this browser. Models, skills and plugins live in
        Pi&apos;s own configuration.
      </p>
      {about === undefined ? null : (
        <fieldset>
          <legend class="pb-1 text-sm font-semibold">About</legend>
          <p class="text-xs text-base-content/60">
            web-pi {about.webPi} · pi {about.pi}
          </p>
        </fieldset>
      )}
    </div>
  );
}

function TrustNotice({ what }: { what: string }) {
  return (
    <div class="mb-2 alert py-2 text-xs alert-warning" role="status">
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
      class="select select-xs"
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

function skillRowClass(active: boolean): string {
  return `flex w-full items-center gap-2 rounded-none text-left ${
    active ? "menu-active" : ""
  }`;
}

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
    <ul id="skill-list" class="menu w-full flex-nowrap p-0 text-sm">
      {groups.length === 0 ? (
        <li class="px-3 py-2 text-xs text-base-content/50">
          No skills in this folder
        </li>
      ) : null}
      {groups.map((group) => (
        <>
          <li class="px-3 py-1 text-xs text-base-content/50">{group.label}</li>
          {group.skills.map((skill) => (
            <li>
              <button
                type="button"
                class={skillRowClass(skill.filePath === selected)}
                hx-get={`/settings/skills/detail?cwd=${encodeURIComponent(view.cwd)}&path=${encodeURIComponent(skill.filePath)}`}
                hx-target="#skill-detail"
                hx-swap="innerHTML"
              >
                <span class="truncate">{skill.name}</span>
                {skill.disableModelInvocation ? (
                  <span class="badge badge-ghost badge-xs">Manual</span>
                ) : null}
                {updated.has(skill.install?.package ?? "") ? (
                  <span class="text-warning" title="Update available">
                    ↑
                  </span>
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
    return (
      <p class="p-3 text-sm text-base-content/60">
        Select a skill to see what it does.
      </p>
    );
  }
  const install = skill.install;
  const relative = skill.filePath.startsWith(`${cwd}/`)
    ? `./${skill.filePath.slice(cwd.length + 1)}`
    : shortPath(skill.filePath, home);
  return (
    <div id="skill-detail-body" class="flex flex-col gap-3 p-3 text-sm">
      <div class="flex items-center gap-2">
        <span class="badge badge-ghost badge-sm">{skill.scope}</span>
        <code class="truncate text-xs opacity-70" title={skill.filePath}>
          {relative}
        </code>
      </div>
      <div class="flex items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={skill.disableModelInvocation ? "false" : "true"}
          class={`btn btn-xs ${skill.disableModelInvocation ? "" : "btn-primary"}`}
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
        <span class="text-xs text-base-content/60">
          {skill.disableModelInvocation
            ? "Only you can invoke this skill."
            : "Pi may invoke this skill on its own."}
        </span>
      </div>
      {install?.skillsShUrl ? (
        <p class="text-xs">
          Source:{" "}
          <a
            class="link"
            href={install.skillsShUrl}
            target="_blank"
            rel="noreferrer"
          >
            {install.source}
          </a>
        </p>
      ) : null}
      {install ? (
        <div class="flex flex-wrap items-center gap-2 text-xs">
          <span>Version</span>
          <code>{(install.versionHash ?? "unknown").slice(0, 8)}</code>
          {install.canCheckForUpdates ? (
            <button
              type="button"
              class="btn btn-xs"
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
                class="btn btn-primary btn-xs"
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
            <span class="opacity-70">
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
        <h4 class="text-xs text-base-content/50">Name</h4>
        <p>{skill.name}</p>
      </div>
      <div>
        <h4 class="text-xs text-base-content/50">Description</h4>
        <p class="whitespace-pre-wrap">{skill.description}</p>
      </div>
      {message === undefined ? null : (
        <pre class="max-h-40 overflow-auto rounded bg-base-200 p-2 text-xs whitespace-pre-wrap">
          {message}
        </pre>
      )}
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
    <div id="skill-search-results" class="flex flex-col gap-1">
      {message === undefined ? null : (
        <p class="text-xs" role="status">
          {message}
        </p>
      )}
      {hits.length === 0 && message === undefined ? (
        <p class="text-xs text-base-content/50">No skills found</p>
      ) : null}
      {hits.map((hit) => (
        <div class="flex items-center gap-2 text-xs">
          <span class="flex-1 truncate font-mono">{hit.package}</span>
          <span class="opacity-60">{hit.installs}</span>
          {hit.url === "" ? null : (
            <a class="link" href={hit.url} target="_blank" rel="noreferrer">
              skills.sh
            </a>
          )}
          <form
            hx-post="/settings/skills/install"
            hx-target="#skill-search-results"
            hx-swap="outerHTML"
            class="flex items-center gap-1"
          >
            <input type="hidden" name="cwd" value={cwd} />
            <input type="hidden" name="package" value={hit.package} />
            <ScopePicker name="scope" trusted={trusted} target=".pi/skills" />
            <button class="btn btn-xs">Install</button>
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
    <div class="flex min-h-0 flex-col gap-2">
      {view.projectResourcesLoaded ? null : <TrustNotice what="skills" />}
      <div class="flex min-h-0 flex-col gap-3 md:flex-row">
        <div class="max-h-72 w-full shrink-0 overflow-y-auto rounded-box border border-base-300 md:max-h-[60vh] md:w-64">
          <SkillList view={view} selected={skill?.filePath} />
        </div>
        <div
          id="skill-detail"
          class="min-w-0 flex-1 rounded-box border border-base-300"
        >
          <SkillDetail cwd={view.cwd} skill={skill} home={home} />
        </div>
      </div>
      <details class="rounded-box border border-base-300 p-2">
        <summary class="cursor-pointer text-sm">Add skill</summary>
        <form
          class="mt-2 flex flex-wrap items-center gap-2"
          hx-post="/settings/skills/search"
          hx-target="#skill-search-results"
          hx-swap="outerHTML"
        >
          <input type="hidden" name="cwd" value={view.cwd} />
          <input
            name="query"
            class="input flex-1 input-sm"
            placeholder="Search skills.sh"
            aria-label="Search skills"
          />
          <button class="btn btn-sm">Search</button>
        </form>
        <div class="mt-2">
          <SkillSearchResults
            hits={[]}
            cwd={view.cwd}
            trusted={view.projectResourcesLoaded}
            message="Search skills.sh to install a skill."
          />
        </div>
      </details>
      <div class="flex items-center gap-2 text-xs text-base-content/60">
        <button
          type="button"
          class="btn btn-ghost btn-xs"
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
          <span class="text-warning">{message}</span>
        ))}
      </div>
    </div>
  );
}

// --- Plugins ---------------------------------------------------------------

const STATUS_CLASS = {
  loaded: "status-primary",
  installed: "status-warning",
  disabled: "status-neutral opacity-40",
  missing: "status-error",
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
    return (
      <p class="p-3 text-sm text-base-content/60">
        Select a plugin to see what it provides.
      </p>
    );
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
    <div class="flex flex-col gap-3 p-3 text-sm">
      <div class="flex flex-wrap items-center gap-2">
        <span class="badge badge-ghost badge-sm">
          {info.scope === "user" ? "global" : "project"}
        </span>
        {info.disabled ? (
          <span class="badge badge-sm badge-neutral">Disabled</span>
        ) : null}
        {info.filtered ? (
          <span class="badge badge-ghost badge-sm">filtered</span>
        ) : null}
        <code class="truncate text-xs">{info.source}</code>
      </div>
      <div class="flex flex-wrap gap-1">
        <button
          type="button"
          class="btn btn-xs"
          hx-post="/settings/plugins"
          hx-vals={act("update")}
          hx-target="#settings-body"
          hx-swap="innerHTML"
        >
          Update
        </button>
        <button
          type="button"
          class="btn btn-xs"
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
          class="btn text-error btn-xs"
          hx-post="/settings/plugins"
          hx-vals={act("remove")}
          hx-target="#settings-body"
          hx-swap="innerHTML"
          hx-confirm="Remove this plugin and its settings entry?"
        >
          Remove
        </button>
      </div>
      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt class="text-base-content/50">Status</dt>
        <dd>{info.status}</dd>
        <dt class="text-base-content/50">Version</dt>
        <dd>
          {info.version ?? "unknown"}
          {info.configuredVersion === undefined
            ? ""
            : ` · configured ${info.configuredVersion}`}
        </dd>
        <dt class="text-base-content/50">Package</dt>
        <dd>{info.packageName ?? "unknown"}</dd>
        <dt class="text-base-content/50">Installed path</dt>
        <dd
          class={info.installedPath === undefined ? "text-error" : "truncate"}
        >
          {info.installedPath === undefined
            ? "Not found"
            : shortPath(info.installedPath, home)}
        </dd>
      </dl>
      <div>
        <h4 class="text-xs text-base-content/50">Resolved resources</h4>
        {info.resources.length === 0 ? (
          <p class="text-xs opacity-60">
            {info.disabled ? "Disabled" : "No resources"}
          </p>
        ) : (
          <ul class="text-xs">
            {info.resources.map((resource) => (
              <li title={resource.path}>
                <span class="font-medium">{resource.name}</span>{" "}
                <span class="opacity-60">
                  {resource.kind} · {resource.relativePath}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {message === undefined ? null : (
        <p class="text-xs" role="status">
          {message}
        </p>
      )}
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
    <div class="flex min-h-0 flex-col gap-2">
      {view.projectResourcesLoaded ? null : <TrustNotice what="plugins" />}
      <div class="flex min-h-0 flex-col gap-3 md:flex-row">
        <div class="max-h-72 w-full shrink-0 overflow-y-auto rounded-box border border-base-300 md:max-h-[60vh] md:w-64">
          <ul class="menu w-full flex-nowrap p-0 text-sm">
            {view.packages.length === 0 ? (
              <li class="px-3 py-2 text-xs text-base-content/50">
                No plugins configured
              </li>
            ) : null}
            {scopes.map((group) => {
              const rows = view.packages.filter(
                (entry) => entry.scope === group.scope,
              );
              if (rows.length === 0) return <></>;
              return (
                <>
                  <li class="px-3 py-1 text-xs text-base-content/50">
                    {group.label}
                  </li>
                  {rows.map((entry) => (
                    <li>
                      <button
                        type="button"
                        class={`flex w-full items-center gap-2 rounded-none text-left ${
                          pluginKey(entry) === pluginKey(info ?? entry)
                            ? "menu-active"
                            : ""
                        }`}
                        hx-get={`/settings/plugins?cwd=${encodeURIComponent(cwd)}&selected=${encodeURIComponent(pluginKey(entry))}`}
                        hx-target="#settings-body"
                        hx-swap="innerHTML"
                      >
                        <span
                          class={`status status-sm ${STATUS_CLASS[entry.status]}`}
                          aria-label={entry.status}
                        />
                        <span
                          class={`truncate ${entry.disabled ? "opacity-50" : ""}`}
                        >
                          {entry.source}
                        </span>
                      </button>
                    </li>
                  ))}
                </>
              );
            })}
          </ul>
        </div>
        <div class="min-w-0 flex-1 rounded-box border border-base-300">
          <PluginDetail
            cwd={cwd}
            {...(info ? { info } : {})}
            {...(message === undefined ? {} : { message })}
            {...(home === undefined ? {} : { home })}
          />
        </div>
      </div>
      <details
        class="rounded-box border border-base-300 p-2"
        open={view.packages.length === 0}
      >
        <summary class="cursor-pointer text-sm">Add plugin</summary>
        <form
          class="mt-2 flex flex-wrap items-center gap-2"
          hx-post="/settings/plugins"
          hx-target="#settings-body"
          hx-swap="innerHTML"
        >
          <input type="hidden" name="cwd" value={cwd} />
          <input type="hidden" name="action" value="install" />
          <input
            name="source"
            class="input flex-1 font-mono input-sm"
            placeholder="npm:@scope/pi-plugin"
            aria-label="Plugin source"
          />
          <ScopePicker
            name="scope"
            trusted={view.projectResourcesLoaded}
            target=".pi"
          />
          <button class="btn btn-sm">Install</button>
        </form>
        <p class="mt-1 text-xs text-base-content/50">
          npm:@scope/pi-plugin · git:https://github.com/user/repo ·
          /absolute/path/to/plugin
        </p>
      </details>
      <div class="flex flex-wrap items-center gap-2 text-xs text-base-content/60">
        <span>
          {String(view.totals.extensions)} ext · {String(view.totals.skills)}{" "}
          skills · {String(view.totals.prompts)} prompts ·{" "}
          {String(view.totals.themes)} themes
        </span>
        {view.diagnostics.map((diagnostic) => (
          <span
            class={diagnostic.type === "error" ? "text-error" : "text-warning"}
            title={diagnostic.source}
          >
            {diagnostic.message}
          </span>
        ))}
        <button
          type="button"
          class="btn btn-ghost btn-xs"
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
          class="btn btn-ghost btn-xs"
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
      <div class="alert alert-error" role="alert">
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
    <div class="mx-auto flex min-h-0 w-full max-w-5xl flex-col gap-3 p-4">
      <div class="flex items-center gap-2">
        <h1 class="flex-1 text-xl font-semibold">Settings</h1>
        {props.cwd === "" ? null : (
          <code class="truncate text-xs opacity-60">
            {shortPath(props.cwd, props.home)}
          </code>
        )}
        <a class="btn btn-ghost btn-sm" href={props.back}>
          Close
        </a>
      </div>
      <input id="settings-cwd" type="hidden" name="cwd" value={props.cwd} />
      <div class="flex min-h-0 flex-col gap-4 md:flex-row">
        <SectionNav active={props.section} cwd={props.cwd} />
        <div id="settings-body" class="min-w-0 flex-1">
          <SettingsBody {...props} />
        </div>
      </div>
    </div>
  );
}
