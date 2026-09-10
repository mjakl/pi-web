# pi-web behaviour spec: workspace selection and configuration

Extracted from /home/mjakl/Projects/pi-web on 2026-09-10; describes pi-web behaviour, not web-pi's design.

Line numbers refer to that checkout. Pi SDK = `@earendil-works/pi-coding-agent`
0.85.1, resolved through a host shim (bin/link-host-pi.js); SDK line references
point at its `dist/` build.

## 0. Map

| Concern | Client | Server |
|---|---|---|
| Project/worktree picker | SessionSidebar.tsx (dropdown) + ProjectFolderGroup.tsx | GET /api/worktrees |
| Filesystem browse dialog | DirectoryPicker.tsx | GET /api/cwd/browse |
| Commit a chosen folder | SessionSidebar.tsx:1044-1090 | POST /api/cwd/validate |
| Read-only (missing folder) | ChatWindow.tsx:400-524, 987-991 | lib/worktree.ts:30-44, lib/rpc-manager.ts:544 |
| Project trust | AppShell.tsx:1039-1090, ProjectTrustDialog.tsx | GET/POST /api/project-trust |
| Skills | SkillsConfig.tsx | GET/PATCH /api/skills, /api/skills/{search,install,check,update} |
| Plugins (packages) | PluginsConfig.tsx | GET/POST /api/plugins |
| Tools / system prompt popovers | ToolDefinitionsPanel.tsx, SystemPromptPanel.tsx | RPC `get_tools`, `get_state` |
| Settings dialog | SettingsPanel.tsx, SettingsUi.tsx | — (client-only prefs) |
| Prefs storage | hooks/useTheme.ts, hooks/useAudio.ts, lib/context-warning.ts, lib/settings-navigation.ts, lib/workspace-memory.ts | — |
| Models cache freshness | — | lib/agent-config-stamp.ts + lib/models-cache.ts |

Agent dir: `getAgentDir()` = `$PI_CODING_AGENT_DIR` or `~/.pi/agent`
(SDK dist/config.js:421-427). Project config dir: `.pi` (`CONFIG_DIR_NAME`,
dist/config.js:403).

---

## 1. Worktree discovery and project identity (lib/worktree.ts)

### 1.1 Types

```ts
ProjectInfo  { projectRoot: string; branch: string|null; isWorktree: boolean; isTopLevel: boolean }   // :11-17
WorktreeInfo { path: string; branch: string|null }                                                    // :19-22
```

### 1.2 git invocation (:46-53)

All git runs as `execFile("git", ["-C", cwd, ...args])`, never a shell,
`timeout: 10_000`, `maxBuffer: 1 MiB`, `env: {...process.env, LC_ALL: "C"}`,
stdout trimmed. Failure of the whole probe is caught, not surfaced.

### 1.3 `resolveProject(cwd, refresh=false)` (:107-163)

1. Cache: `globalThis.__piProjectCache`, key `` `${getAgentDir()}:${pathIdentityKey(cwd)}` ``,
   TTL 60 s (:112-121, :161). `refresh=true` bypasses reads but still writes.
2. Availability is checked **before** the cache: if `statSync(cwd).isDirectory()`
   is false the cache entry is deleted and `removedProject(cwd)` is returned
   (:114-118). Availability can therefore never be masked by the cache.
3. `git rev-parse --path-format=absolute --git-common-dir --git-dir` → two
   absolute paths, each through `toNativePath` (git prints POSIX separators
   even on Windows). Missing either line throws (:123-131).
4. Bare test: `git -C <commonDir> rev-parse --is-bare-repository === "true"` (:132-133).
5. `root = realpath(bare ? commonDir : dirname(commonDir))` (:134).
   `isBareDirectory = bare && samePath(realpath(cwd), root)` (:135).
6. `toplevel = isBareDirectory ? root : git rev-parse --show-toplevel`;
   `isTopLevel = samePath(toplevel, realpath(cwd))` (:136-139).
7. `isWorktree = isTopLevel && !samePath(gitDir, commonDir)` — a linked
   worktree has its own gitdir (:140).
8. `branch = isBareDirectory ? null : git symbolic-ref --quiet --short HEAD`,
   `.catch(() => null)` → detached HEAD reports `null` (:141-145).
9. `projectRoot = isTopLevel ? root : cwd` — a subdirectory of a checkout keeps
   its own identity (:147, and the comment at :12).
10. When `isTopLevel`, `rememberProjects([cwd, realpath(cwd)], root)` (:152).
11. Any throw → `{ projectRoot: cwd, branch: null, isWorktree: false, isTopLevel: false }`
    (non-git folder) (:153-160).

### 1.4 `listWorktrees(cwd)` (:165-196)

`git worktree list --porcelain -z`; NUL-separated fields parsed in order:
`worktree <path>` starts a record (path → `toNativePath`), `branch <ref>` sets
branch with `refs/heads/` stripped, bare `bare` and `prunable...` flags set
booleans. After parsing, `rememberProjects(all paths, records[0].path)` — the
first record is the main checkout / bare dir (:183-187). Returned list excludes
records that are `bare`, `prunable`, or whose path fails
`isWorkingDirectoryAvailable` (:188-195). Only `{path, branch}` is returned.

`findCurrentWorktreePath(worktrees, cwd)` matches `samePath(w.path, realpath(cwd))`,
else `null` (:198-206).

### 1.5 `web-worktree-projects.json` (:63-104)

* Path: `join(getAgentDir(), "web-worktree-projects.json")`.
* Format: a flat JSON object, `pathIdentityKey(folder)` → `projectRoot` string.
  `pathIdentityKey` normalizes, strips trailing separators, and lowercases on
  Windows (lib/paths.ts:68-80). Written with `JSON.stringify(known)` — no
  indentation, no trailing newline.
* Read is fully defensive: any parse error, non-object, or array → `{}`;
  non-string values are filtered out (:65-77).
* Write only when a mapping actually changes; `mkdirSync(agentDir, {recursive:true})`
  then `writePrivateFileAtomicSync` — temp file `.<name>-<uuid>.tmp` opened `wx`
  with mode `0o600` and `flush: true`, then `renameSync` (lib/atomic-file.ts:9-40).
* Purpose (comment :63-65): git forgets removed worktrees; this keeps sidebar
  history grouped after a worktree is deleted and after a server restart,
  without editing session transcripts.
* `removedProject(cwd)` (:97-105) reads the map: `projectRoot = known[key] ?? cwd`,
  `branch: null`, `isWorktree = Boolean(root && !samePath(root, cwd))`,
  `isTopLevel = Boolean(root)`. Unknown folders stay standalone — pi-web never
  guesses a repo from the folder name (docs/worktrees.md:51-54).

### 1.6 GET /api/worktrees (app/api/worktrees/route.ts)

Query: `cwd` (required, else 400 `{error:"cwd is required"}`).

Authorization (:16-25): the same gate as /api/files — `cwd` must pass both
`isPathWithinRoots` and `isExistingPathWithinRoots` against
`getAllowedFileRoots()`, else 403 `{error:"Access denied"}`.

Body (:37-63):

```jsonc
{ "cwdAvailable": true,           // isWorkingDirectoryAvailable(cwd)
  "projectRoot": "/abs/path",
  "projectKey": "<pathIdentityKey(projectRoot)>",
  "isGit": true,                  // false when `git worktree list` threw
  "isTopLevel": true,
  "currentWorktreePath": "/abs/path"|null,
  "worktrees": [{ "path": "...", "branch": "main"|null }] }
```

* `resolveProject(cwd, true)` — always refreshed, so the picker sees external
  changes (docs/worktrees.md:27-30: no background polling; refresh happens on
  open/expand).
* If `cwd` is gone, `listWorktrees` is run against `project.projectRoot` so a
  session of a deleted worktree still lists its siblings (:42-46).
* Side effect: every listed worktree path is passed to `allowFileRoot(w.path)`
  (:54), which is how the explorer regains access to worktrees without sessions
  and how access is restored after a restart.
* Any throw → 500 `{error: String(error)}`.
* Read-only endpoint: pi-web never creates, deletes, prunes, or re-branches a
  worktree (docs/worktrees.md:3-5).

---

## 2. Folder picker

### 2.1 Project dropdown (SessionSidebar.tsx)

The closed control shows the selected cwd (`~`-shortened) or "Select project…"
(:1476-1500). It carries a dot when another workspace has activity (:1502-1516).
The menu is an anchored popover (:1516-1614) containing:

* an optional filter input (`sidebar.filterProjects`, Esc clears and closes),
* one `ProjectFolderGroup` per recent project. The list comes from
  `getRecentProjects(allSessions)` (lib/project-groups.ts:14-37): sessions
  deduplicated by `workspaceKeyOf` (projectKey ?? projectRoot ?? cwd), most
  recently modified first, entering cwd = `projectEntryPath ?? cwd`,
* "No matching projects" when the filter matches nothing,
* a trailing **Custom path…** item that opens `DirectoryPicker` (:1591-1613).

Opening the menu re-loads sessions and refreshes the selected session
(:1519-1526).

### 2.2 ProjectFolderGroup (components/ProjectFolderGroup.tsx)

* On mount and on each expand it fetches
  `GET /api/worktrees?cwd=<queryCwd>` with `cache:"no-store"` and an
  AbortController; `queryCwd` is the selected cwd for the active project, else
  the project's entering cwd (:66-90). Expanding bumps `refreshKey` so the list
  is re-fetched (:126).
* Folder list (:92-98): `isGit && isTopLevel` → the worktree paths;
  else if `cwdAvailable` → `[project.cwd]`; else `[]`.
* Exactly one folder ⇒ "direct" mode: the row itself selects, no disclosure
  triangle, check mark when current (:109-158).
* More than one ⇒ collapsible; children show basename + `~`-shortened path,
  `aria-current` + ✓ on the current one (:159-194).
* States: row is `disabled`/`aria-busy` until data or error arrives;
  "Loading" (role=status), the error text (role=alert), or
  "No working folders available" when the list is empty (:161-175).
* Selection calls `onSelect(path, data.projectRoot ?? project.root, data.projectKey ?? project.key)`
  (:102-108).

### 2.3 DirectoryPicker (components/DirectoryPicker.tsx)

Native `<dialog>`; `showModal()` on mount supplies backdrop, focus trap, top
layer and focus restore (:120-127). Esc is intercepted on the dialog
(`preventDefault`, then `onCancel` unless `busy`) so the app-global Esc cannot
abort the running turn behind it (:151-157); the `cancel` event is also
preventDefault'ed (:148-150). Backdrop click cancels unless busy (:158-160).

Layout: header with title + × ; a path form (parent button, monospace text
input `autoFocus`, "Go"); a scrolling list; a footer (Cancel / "Select this
folder").

* `navigateTo(dir?)` → `GET /api/cwd/browse[?path=...]`; sets currentPath,
  parentPath, and mirrors the resolved path into the input (:100-116).
* Initial navigation uses `initialPath` or none (server default = `homedir()`) (:129-131).
* Submitting the path input navigates to the typed path (`~` and relative
  accepted server-side); errors render in red inside the list area (:133-137, :422-428).
* Parent button enabled when `parentPath` exists or the current path is a
  Windows drive root `X:\` (:71-73, :140-141).
* Windows drive mode: when the response carries `drives`, those are listed with
  a drive icon instead of directories; empty → "No drives found" (:341-379).
* **Select gate**: `canSelect = currentPath && pathInput.trim() === currentPath && !busy`
  (:138-139). A typed-but-not-opened path cannot be selected; the button title
  says "Open this path before selecting it" (:467-471). Label switches to
  "Checking" while `busy`.
* The picker itself performs no validation; it hands `currentPath` to
  `onSelect`.

### 2.4 GET /api/cwd/browse (app/api/cwd/browse/route.ts, lib/directory-browser.ts)

Query: `path` (optional, trimmed).

* Windows with no `path` → `{path:"", parentPath:null, drives:[{name:"C:",path:"C:\\"},...], directories:[]}`
  — A–Z probed with `stat`, non-directories dropped (directory-browser.ts:10-43).
* Otherwise start dir = `path || homedir()` (:17-19), then
  `realpath(normalizeDirectory(dir))`: `~`/`~/x` expand to the home dir,
  everything else `path.resolve(process.cwd(), dir)` (:45-53, :101-103).
* Failures: unresolvable → 404 `{error:"Directory does not exist"}`;
  not a directory → 400 `{error:"Path is not a directory"}`; other throw → 500
  `{error:String(error)}`.
* Success: `{path: <resolved>, parentPath: <getParentDirectory|null>, directories:[{name,path}]}`.
  `getParentDirectory` picks `path.win32` for drive/UNC paths and `path.posix`
  otherwise, returning `null` at the root (:91-99).
* `listDirectories` includes real directories and symlinks whose realpath is a
  directory (broken/inaccessible links dropped), sorted by
  `localeCompare(name, "en")` (:105-131). Hidden directories are **not**
  filtered.
* **No allowed-roots check.** This endpoint browses the whole filesystem
  visible to the server process; it exposes directory names only.

### 2.5 POST /api/cwd/validate (app/api/cwd/validate/route.ts)

Request `{ cwd: string }`. Responses:

| Case | Status | Body |
|---|---|---|
| empty/non-string | 400 | `{error:"Path is required"}` |
| `statSync` throws | 400 | `` {error:`Directory does not exist: ${cwd}`} `` |
| not a directory | 400 | `` {error:`Path is not a directory: ${cwd}`} `` |
| ok | 200 | `{success:true, cwd:<normalized>, projectRoot, projectKey}` |
| throw | 500 | `{error:String(error)}` |

`normalizeDirectory` runs first (tilde + resolve). On success the normalized
path is added to the in-memory allowed roots via `allowFileRoot` (:36) — this
is the mechanism by which an arbitrary folder becomes browsable — then
`resolveProject` supplies identity. Also used by AppShell for a `?cwd=` deep
link (AppShell.tsx:568-600).

### 2.6 Custom path flow (SessionSidebar.tsx)

* `pi-web:last-custom-cwd` (:165) holds the last successfully validated custom
  path; read into `customPathValue` at mount (:179-190, :336) and used as the
  picker's `initialPath` (:1307).
* `commitCustomPath(candidate)` (:1044-1090): trims, ignores empty/in-flight,
  POSTs `/api/cwd/validate`; on any failure sets `customPathError` (shown inside
  the picker) and keeps it open. On success: `setValidatedProject({cwd,root,key})`,
  save last custom cwd, set the input, set `selectedCwd`, close the picker and
  the dropdown.
* `validatedProject` short-circuits `projectFor()` so the first render after a
  custom pick already has the server-resolved key and does not look like a
  spurious workspace switch (:900-908).

### 2.7 What selecting a folder changes

Sidebar side (`onSelect` at :1574-1582): records `validatedProject`, sets
`selectedCwd`, clears the filter, closes picker/dropdown. `selectedCwd` drives:
the worktree fetch (:970-1000), the file explorer root, the new-session button,
and `onCwdChange(cwd, root, key)` (:945-955) which fires whenever cwd **or**
resolved key changes.

AppShell `handleCwdChange` (:672-740):

* always `setActiveCwd(cwd)` and invalidate any in-flight workspace restore;
* same cwd with a newly hydrated key ⇒ identity hydration, no switch (:697);
* same project key while a session is open (or the fresh composer already sits
  on that cwd) ⇒ no-op: sessions stay open when moving between worktrees of one
  project (:701-707);
* otherwise: new draft id, `setSelectedSession(null)`, drop a stale
  `newSessionCwd`, `resetSessionView()` (bumps sessionKey → ChatWindow
  remounts, clears stats/usage/panels);
* on a *project* change also: clear file tabs, close the right panel, and
  `restoreWorkspaceContext(newProject)`;
* finally `router.replace("/")` — the `?session=` param is dropped.

Existing sessions keep their own cwd; opening a session selects that session's
folder (SessionSidebar.tsx:963-968; docs/worktrees.md:20-23).

### 2.8 Workspace memory (lib/workspace-memory.ts)

* Key `pi-web:last-open-by-workspace` (:17), value a JSON object
  `workspaceKey → sessionId`. Defensive read (non-object/array/parse error →
  `{}`), best-effort write; `clearLastOpen` removes the whole key when the map
  becomes empty (:63-78).
* `workspaceKeyOf(session) = projectKey ?? projectRoot ?? cwd` (:80-87), so all
  worktrees of a repo and both Windows path spellings share one slot.
* Written on every active-session transition (AppShell.tsx:559-566).
* `restoreWorkspaceContext(projectKey)` (AppShell.tsx:615-657): looks up the
  remembered id, fetches `/api/sessions`, ignores stale results via a token,
  forgets the memory when the list loaded but the session is gone (keeps it on
  a network failure), verifies `workspaceKeyOf(s) === projectKey`, then selects
  the session, bumps sessionKey and rewrites `?session=<id>`.

---

## 3. Missing-folder read-only mode

Server truth: `isWorkingDirectoryAvailable(cwd)` = `statSync(cwd).isDirectory()`
guarded by try/catch (lib/worktree.ts:30-36). `assertWorkingDirectoryAvailable`
throws ``Working folder is unavailable. This session is read-only: ${cwd}``
(:38-44).

Where it is enforced server-side:

* session listing sets `cwdAvailable` per session (lib/session-reader.ts:121);
* `GET /api/worktrees` reports `cwdAvailable` (route.ts:56);
* RPC command gate (lib/rpc-manager.ts:527-546): every command **except**
  `get_state`, `get_session_stats`, `get_last_assistant_text`, `get_tools`,
  `get_commands`, `abort`, `abort_compaction`, `abort_bash`, `clear_queue`
  calls `assertWorkingDirectoryAvailable`. Inspection and stopping keep working;
  everything mutating fails;
* session start/activation paths assert as well (:1724, :1737, :1741, :1849).

Client (`readOnly = session?.cwdAvailable === false`, ChatWindow.tsx:400):

* the composer is replaced by a `role="status"` notice with
  `chat.missingWorkingFolder` = "Working folder is unavailable. This session is
  read-only." (:987-991, i18n en.ts:149-150);
* input auto-focus is disabled (:401-405);
* fork/branch history actions are removed (:406-424);
* compaction control is disabled (:508-514);
* rewind is disabled and starring is suppressed (:1298-1310).

The picker hides unavailable folders (ProjectFolderGroup.tsx:92-98, and
`listWorktrees` filters unavailable paths). Availability is re-checked when a
session is opened/refreshed and when the picker opens; the backend checks again
before activation (docs/worktrees.md:43-46).

---

## 4. Project trust

### 4.1 When trust is required (SDK dist/core/trust-manager.js:137-165)

`hasTrustRequiringProjectResources(cwd)` is true when `<cwd>/.pi` contains any
of `settings.json`, `extensions`, `skills`, `prompts`, `themes`, `SYSTEM.md`,
`APPEND_SYSTEM.md`, **or** when `<dir>/.agents/skills` exists in cwd or any
ancestor — except the user's own `~/.agents/skills`, which is always trusted.

lib/project-trust.ts:

* `getProjectTrustStatus(cwd, agentDir)` → `{requiresTrust:false, trusted:true}`
  when nothing gated exists; otherwise `{requiresTrust:true, trusted: store.get(cwd) === true}` (:7-19).
* `trustProject` no-ops when trust is not required, else `new ProjectTrustStore(agentDir).set(cwd, true)` (:21-30).
* `projectTrustReloadOptions(cwd, agentDir)` returns
  `{ resolveProjectTrust: async () => store.get(cwd) === true }`, or `undefined`
  when no gated resources exist (:49-59). Rationale in the doc comment
  (:32-48): pi-web *executes* project extensions when it builds session
  services, so an untrusted repo must not be loaded (issue #236). Used by
  lib/skills-service.ts:17, lib/rpc-manager.ts:1752, app/api/models/route.ts:49.

### 4.2 Trust store file (SDK dist/core/trust-manager.js:167-200)

* Path: `join(agentDir, "trust.json")` — shared with the `pi` CLI.
* Format: JSON object, canonicalized absolute path → `true|false` (`null`
  deletes the key). Written with keys sorted, `JSON.stringify(data, null, 2)`
  plus a trailing newline, `mkdirSync(dirname, {recursive:true})` first.
* Lookup walks up ancestors and takes the nearest recorded decision
  (`findNearestTrustEntry`, :18-32), so trusting a parent covers children.
* All reads and writes take a `proper-lockfile` lock on the agent dir with
  `lockfilePath = trust.json.lock`, retried 10× with a 20 ms busy wait.
* Invalid values or a non-object file throw (`Invalid trust store …`).

### 4.3 GET/POST /api/project-trust

`GET ?cwd=` → `authorizeDirectory(cwd)` (400 non-absolute / 403 outside allowed
roots / 404 missing / 400 not a directory, lib/file-access.ts:37-61), then
`getProjectTrustStatus` → `{requiresTrust, trusted}`.

`POST {cwd}`:

| Case | Status | Body |
|---|---|---|
| authorization failure | 400/403/404 | `{error}` |
| `!requiresTrust` | 409 | `{error:"This project has no resources that require trust"}` |
| a session for that cwd is running/starting | 409 | `{error:"Wait for the active session to finish before trusting this project"}` |
| ok | 200 | `{requiresTrust:true, trusted:true}` |
| throw | 500 | `{error: errorMessage(error)}` |

On success (route.ts:58-61): write trust, `invalidateModelsCache()`, then
`await destroyRpcSessionsForCwd(cwd)` — every live RPC session for that cwd is
shut down (rpc-manager.ts:1643-1650) so it restarts with project resources
loaded. Busy detection covers both starting and running sessions (:1634-1641).
Sessions started later pick trust up through `projectTrustReloadOptions`
(:1752-1772); an in-place `reload` command re-syncs
`settingsManager.setProjectTrusted(...)` first (:1115-1122, :1334-1337).

### 4.4 UI

* AppShell loads trust for `projectTrustCwd = selectedSession?.cwd ?? effectiveNewSessionCwd`
  whenever it changes, resetting state first and aborting stale requests
  (:1039-1064).
* While `requiresTrust && !trusted` and a chat is shown, a warning button is
  rendered in the toolbar (desktop) or as a full-width banner (mobile) reading
  **"Restricted mode"** with a shield icon (:1140-1194). Clicking it opens the
  dialog.
* `ProjectTrustDialog` (components/ProjectTrustDialog.tsx): native `<dialog>` +
  `showModal()`, same Esc/backdrop handling as the folder picker (:223-249).
  Content: shield icon, title **"Trust this project?"**, body **"Project
  resources can run local code. Trust only projects whose contents you know."**,
  the cwd in a `<code>` block, an optional `role="alert"` error, and
  Cancel / **"Trust project"** (label "Trusting..." while busy) (:251-361;
  strings en.ts:367-372).
* `handleTrustProject` (AppShell.tsx:1066-1090) POSTs, then on success stores
  the new status, closes the dialog, bumps `modelsRefreshKey` and `sessionKey`
  (chat remounts against the now-trusted session).
* Downstream notices: SkillsConfig and PluginsConfig render a
  `config-trust-notice` bar when `projectResourcesLoaded === false`
  ("Project skills are not loaded because this project is not trusted." /
  "…project plugins…", en.ts:373-377), and `ConfigScopePicker` disables the
  **project** scope with the title "Project installs are unavailable while
  project resources are not loaded." (SettingsUi.tsx:301-331, en.ts:378-379).

---

## 5. Skills

### 5.1 Listing — GET /api/skills?cwd=

`authorizeDirectory(cwd)` then `loadSkillsWithInstallInfo` (lib/skills-service.ts:12-27):

```ts
const loader = new DefaultResourceLoader({ cwd, agentDir });
await loader.reload(projectTrustReloadOptions(cwd, agentDir));
const { skills, diagnostics } = loader.getSkills();
return { skills: annotateSkillsWithInstallInfo(skills, {cwd, agentDir}),
         diagnostics,
         projectResourcesLoaded: getProjectTrustStatus(cwd, agentDir).trusted };
```

Using the loader means settings-declared skill paths, package skills and
`.agents/skills` directories are all included, exactly as at session startup
(route comment :11-12). Response shape (lib/api-types.ts:38-55):

```ts
SkillInfo { name, description, filePath, baseDir,
            disableModelInvocation: boolean,
            sourceInfo: { source?: string; scope?: string },
            install?: SkillInstallInfo }
SkillInstallInfo { package, scope:"global"|"project", source, sourceType?,
                   skillsShUrl?, skillPath?, ref?, versionHash?,
                   canCheckForUpdates: boolean }
```

Errors: missing cwd → 400 `{error:"cwd required"}`; auth failure → its status;
throw → 500 `{error:String(e)}`.

### 5.2 Install metadata from lock files (lib/skill-lock.ts)

* Global lock: `$XDG_STATE_HOME/skills/.skill-lock.json` when the env var is
  set, else `~/.agents/.skill-lock.json` (:35-42). Project lock:
  `<cwd>/skills-lock.json` (:150).
* Both are read as `{ skills: { <name>: entry } }`; any error → `{}` (:44-53).
  Entry keys are matched exactly first, then case-insensitively (:65-75).
* Scope is decided by location of `skill.filePath`: inside `<agentDir>/skills`
  → global entries; inside `<cwd>/.pi/skills` → project entries; anything else
  gets no install info. Skills whose file no longer exists are returned
  unchanged (:144-168).
* `source` normalization (:77-85): trailing `/` stripped; for `sourceType ===
  "github"` also `git+`, `https?://github.com/`, `git@github.com:` and `.git`.
* `package` = `` `${source}@${skillName}` ``.
* `versionHash` = `skillFolderHash` (global) or `computedHash` (project) (:118-123).
* `skillsShUrl` = `https://skills.sh/<url-encoded source segments>/<name>`,
  omitted for `sourceType === "local"` or a source containing `://` / `git@` (:87-100).
* `canCheckForUpdates = isGitHubSource && skillPath && versionHash && (scope === "global" || !ref)`
  where `isGitHubSource` requires `sourceType === "github"` and `source`
  matching `^[\w.-]+/[\w.-]+$` (:124-140).

### 5.3 Skills list UI (components/SkillsConfig.tsx)

Left sidebar groups, in this fixed order, showing only non-empty groups
(:753-794): `project / skills.sh`, `project`, `global / skills.sh`, `global`,
`path`. `sourceLabel()` maps `sourceInfo.scope|source`: `user` → "global",
`project` → "project", anything else → "path" (:41-47). Rows show the skill
name, a **Manual** badge when `disableModelInvocation`, and a ↑ indicator when a
stored update check says `update-available` (:795-830). Sidebar footer:
**Add skill**.

Detail pane (`SkillDetail`, :59-232):

* scope tag + file path — project skills are shown relative as `./rel`, others
  through `shortenPath` (`/Users/x` or `/home/x` → `~`, SettingsUi.tsx:15-17);
* a `role="switch"` toggle whose checked state is `!disableModelInvocation`,
  with a status line reading **Model-visible** or **Manual** and the save error
  beside it;
* Source: the `skills.sh` link when present;
* Version: short (8-char) `versionHash`, a **Check** button when
  `canCheckForUpdates`, the latest hash and an **Update** button when an update
  is available, plus a status word — Checking / Up to date / "Automatic checks
  unavailable" (state `unsupported`) / the server message or "Check failed";
* Name and Description.

Footer: **Check updates** (only when any skill has install info; disabled while
checking or updating) and a `<n> update(s)` counter (:914-944).

Selection is remembered per cwd via `setLastSettingsSelection("skills", filePath, cwd)`
(:592-594); on load the remembered filePath is kept if still present, else the
first skill (:572-576).

### 5.4 Toggle — PATCH /api/skills

Request `{ filePath, disableModelInvocation }`. Checks: `filePath` required
(400), file must exist (404), and must lie within
`getAllowedFileRoots() ∪ {getAgentDir()} ∪ {~/.agents/skills if it exists}`
after symlink resolution (403 `{error:"Access denied"}`) — the extra root is
needed because global skills are symlinked into the agent dir (route.ts:44-54).
Then read, transform, `writeFileSync(filePath, updated, "utf8")`, respond
`{success:true}`. Any throw → 500 `{error:String(e)}`.

`setDisableModelInvocation(content, disable)` (lib/skill-frontmatter.ts) does a
surgical line edit so every other YAML field keeps its formatting:

* key is `disable-model-invocation`; presence is tested with
  `hasOwnProperty` on the parsed frontmatter, not truthiness, so an explicit
  `disable-model-invocation: false` is rewritten in place instead of getting a
  duplicate key (which would make the file unparseable and drop the skill) (:6-21);
* `disable === false` and the key is absent → content returned unchanged (:21);
* edits are confined to the frontmatter block: `head` = text before the first
  `\n---` after position 3 when the file starts with `---`, `tail` the rest (:25-27);
* enabling with the key present: replace `^(<key-line>)[^\r\n]*(\r?)$` with
  `$1 true$2`; the key may be quoted (`"key"`/`'key'`) and may have leading
  tabs/spaces; if the regex does not match → throw
  `Cannot edit disable-model-invocation: unsupported frontmatter formatting` (:30-36);
* enabling with no key: insert `disable-model-invocation: true` immediately
  after the opening `---` line (preserving `\r\n`); if there is no frontmatter
  block at all, prepend a fresh `---\n…\n---\n` block (:38-43);
* disabling: delete `\n` + the key line (regex `\n<key-line>[^\n]*`) so no blank
  line remains; same throw when the line cannot be matched (:46-51).

Client (`toggle`, SkillsConfig.tsx:692-726) is optimistic-after-response: it
tracks per-file "toggling" state, sets `saveError` from the response, and
patches the local list on success. No reload of the session is triggered.

### 5.5 Search — POST /api/skills/search

Request `{ query, limit? }`. `query` required (400). `limit` coerced to an
integer clamped to 1..50, default 50 (:21-25). Upstream:
`` `${SKILLS_API_URL || "https://skills.sh"}/api/search?q=<enc>&limit=<n>` ``
with `cache:"no-store"`; non-OK → thrown, so any failure answers **502**
`{error}` (comment :79-81: skills.sh is the only source of truth).

Mapping (:44-62): results sorted by `installs` descending; each becomes
`{ package: `${source||id}@${name}`, installs: "<n> install(s)"/"1.2K installs"/"3.4M installs"
(empty for 0), url: `${base}/${id}` or "" }`. Entries without a name or a
source/id are dropped.

UI (`AddSkillPanel`, :234-536): search box (Enter or button), a
global/project `ConfigScopePicker` with the target path shown next to it
(`~/.pi/agent/skills/` or `<cwd>/.pi/skills/`, :319-322), result rows showing
skill name, repo, install count and a skills.sh link, plus an Install button
that flips to `✓ Installed` for packages already installed in that scope or
just installed in this panel. Empty results show "No skills found"; before any
search a hint links to skills.sh.

### 5.6 Install — POST /api/skills/install

Request `{ package, scope?, cwd? }`; `scope !== "project"` means global.

* `package` required → 400.
* Project scope: `cwd` required → 400; `authorizeDirectory(cwd)`; must be
  trusted, else 403 `{error:"Project resources must be trusted before installing project skills"}`.
* Command: `npx skills add <package> -y --agent pi` plus `-g` for global
  (:46-47), run through `runNpx` with `timeout: 60000`,
  `cwd` only for project scope, `env: {...process.env, FORCE_COLOR: "0"}`.
  The invocation is logged server-side (`[skills/install] running: npx …`).
* Success is decided by matching `/Installation complete|Installed \d+ skill/`
  against `stripAnsi(stdout + stderr)`; otherwise 500 with the last 300
  characters (or "Install failed"). Thrown exec errors → 500 with the
  ANSI-stripped combined output, else the message.
* Success body `{success:true, output}` — the client ignores `output` and just
  reloads the skills list (`onInstalled`).
* No streaming: this is one request/response; the UI shows only
  "Installing..." then the result. ANSI is neutralized twice (FORCE_COLOR=0 and
  `stripAnsi`, lib/ansi.ts:11-13).

`runNpx` (lib/npx.ts): locates `npx-cli.js` next to the running Node
(`<nodeDir>/node_modules/npm/bin/npx-cli.js` or
`<nodeDir>/../lib/node_modules/npm/bin/npx-cli.js`) and runs it with the current
`execPath`; falls back to bare `npx`. Never uses a shell — on Windows
`spawn("npx.cmd")` needs `shell:true` since Node 20.12/CVE-2024-27980, and a
shell would reintroduce quoting bugs for user-supplied args (:9-18, :48-64).

### 5.7 Update check — POST /api/skills/check

Request `{ cwd, package?, scope? }`. `cwd` required (400) + `authorizeDirectory`.
`package` and `scope` must be supplied together, else 400
`{error:"package and scope must be provided together"}`. The skills list is
loaded, install infos filtered to the requested package (or all installs), and
a specific-but-unknown package answers 404 `{error:"Installed skill not found"}`.
GitHub credentials come from `GITHUB_TOKEN || GH_TOKEN`. Response
`{updates: SkillUpdateResult[]}`, each
`{package, scope, state:"up-to-date"|"update-available"|"unsupported"|"error", currentVersion?, latestVersion?, message?}`.

lib/skill-updates.ts:

* Non-checkable entries (`!canCheckForUpdates || !versionHash || !skillPath`)
  → `unsupported`, message "This lock entry cannot be checked automatically." (:238-249).
* Global scope (:153-207): GET
  `https://api.github.com/repos/<source>/git/trees/<ref|HEAD>?recursive=1`,
  headers `Accept: application/vnd.github.v3+json`, `User-Agent: pi-web`, and
  `Authorization: Bearer <token>` when available; 15 s `AbortSignal.timeout`.
  Latest hash = the tree `sha` for a root-level skill, or the `sha` of the
  `tree` entry whose `path` equals the skill folder. On HTTP 401/403/429 it
  falls back to `resolveGitTreeHash`; other errors propagate to the catch and
  become `state:"error"` with the message.
* `resolveGitTreeHash` (:116-151): `mkdtemp(tmpdir(), "pi-web-skill-check-")`,
  `git init --bare`, `git --git-dir=… fetch --depth=1 --filter=blob:none
  --no-tags <https://github.com/<source>.git> <ref|HEAD>`, then
  `rev-parse FETCH_HEAD:<folder>` (or `FETCH_HEAD^{tree}`), 30 s timeouts, hash
  validated against `^[0-9a-f]{40}$`, temp dir removed in `finally`.
* Project scope (:209-232): GET
  `` `${SKILLS_API_URL||https://skills.sh}/api/download/<owner>/<repo>/<slug>` ``
  where `slug` is the skill name lowercased with spaces/underscores → `-`,
  non `[a-z0-9-]` dropped, runs collapsed and trimmed (:64-71). Missing `hash`
  → `error` "skills.sh did not return a version hash."
* Result is `up-to-date` when the remote hash equals `install.versionHash`,
  else `update-available`.
* Batch checks share one in-flight request per URL and hand out
  `response.clone()` (:267-290).
* The folder for a skill is derived from `skillPath` by stripping a trailing
  `SKILL.md`/`skill.md` and trailing slash, backslashes normalized (:78-84).

### 5.8 Update apply — POST /api/skills/update

Request `{ cwd, package, scope }` — all three required (400
`{error:"cwd, package, and scope are required"}`), `authorizeDirectory(cwd)`.
Unknown package → 404 `{error:"Installed skill not found"}`;
`!canCheckForUpdates` → 400 `{error:"This skill cannot be updated automatically"}`.
Runs `runNpx(buildSkillUpdateArgs(install), {timeout:60_000, cwd: scope==="project"?cwd:undefined, env:{...process.env, FORCE_COLOR:"0"}})`,
reloads the skills list, and answers
`{success:true, skill:<refreshed SkillInfo|undefined>, output:<last 500 chars of stdout+stderr>}`.
Exec failures → 500 with the combined output (or message).

`buildSkillUpdateArgs` (:46-62):
`["skills","add", `${source}[/<folder>][#<encoded ref>]`, "--skill", <name from package after last @>, "-y", "--agent", "pi"]`
plus `-g` when scope is global.

Client (`updateInstalledSkill`, SkillsConfig.tsx:646-690) sets a per-key busy
flag, reloads the whole list on success and writes a synthetic `up-to-date`
status with the new hash. `output` is not displayed.

---

## 6. Plugins (packages)

### 6.1 Sources of truth

`SettingsManager.create(cwd, agentDir, {projectTrusted})` reads global
`<agentDir>/settings.json` and project `<cwd>/.pi/settings.json`
(SDK dist/core/settings-manager.js:54-55). The relevant field is
`packages?: PackageSource[]` where

```ts
PackageSource = string | { source: string; autoload?: boolean;
                           extensions?: string[]; skills?: string[];
                           prompts?: string[]; themes?: string[] }
```
(SDK dist/core/settings-manager.d.ts:56-67).

`DefaultPackageManager({cwd, agentDir, settingsManager})` supplies
`listConfiguredPackages()` → `{source, scope:"user"|"project", filtered, installedPath?}`
and `resolve(onMissing)` → `ResolvedPaths` of
`{path, enabled, metadata:{source, scope, origin:"package"|"top-level", baseDir?}}`
per resource kind. Install roots are `<agentDir>/npm|git` and
`<cwd>/.pi/npm|git` (dist/core/package-manager.js:1686-1731) — note the Add
panel *labels* them `~/.pi/agent/{npm,git}` / `<cwd>/.pi/agent/{npm,git}`
(PluginsConfig.tsx:96-100), which does not match the SDK layout.

### 6.2 GET /api/plugins?cwd=

`cwd` required (400 `{error:"cwd required"}`), `authorizeDirectory`. `readPlugins`
(route.ts:254-333):

1. trust status → `SettingsManager.create(cwd, agentDir, {projectTrusted})`;
2. `packageManager.resolve(onMissing)` where `onMissing` records a warning
   diagnostic `"Package is configured but not installed yet."` and returns
   `"skip"` — nothing is installed implicitly. A throw becomes an `error`
   diagnostic;
3. resources are counted per `scope\0source` key and only when
   `resource.enabled && metadata.origin === "package"` (:178-208). Resource
   display names: a `SKILL.md` uses its parent folder name, `index.ts|js`
   extensions use the parent folder, other extension/theme/prompt files drop the
   extension (:113-124). `relativePath` is relative to `metadata.baseDir` when
   inside it, else the absolute path (:126-131);
4. disabled detection (`isDisabledPackage`, :42-54): an object entry whose
   `extensions`, `skills`, `prompts` and `themes` are all present and empty;
5. `configuredVersion` is parsed from the source string: for `npm:` specs the
   part after the last `@` beyond the package name, for `git:`/URL sources the
   part after a trailing `@ref` (:133-152);
6. `packageName`/`version` come from `package.json` next to `installedPath`
   (:154-176); a package with no `installedPath` also adds the warning
   `"Configured package path was not found."`;
7. `status` = `disabled` → `loaded` (any resolved resources) → `installed`
   (path exists) → `missing`.

Response (`PluginsResponse`, api-types.ts:90-109):
`{packages: PluginPackageInfo[], totals: {extensions,skills,prompts,themes}, diagnostics: [{type:"warning"|"error", message, source?, path?}], projectResourcesLoaded}`.

### 6.3 POST /api/plugins

Request `{action, source?, scope?, cwd}`; `action ∈ install|remove|update|disable|enable`.
Validation order: `cwd` required (400) → `action` required (400) →
`authorizeDirectory` → project scope requires trust, else 403
`{error:"Project resources must be trusted before modifying project plugins"}`
→ per-action `source` required (400) for everything except `update`.
Unknown action → 400 `` {error:`Unsupported action: ${action}`} ``. Any throw →
500 `{error: errorMessage(error)}`. Success returns the freshly recomputed
`PluginsResponse` (route.ts:425), so the client always re-renders from server
state.

Action → SDK call (`local = scope === "project"`):

| Action | Call | Writes |
|---|---|---|
| install | `packageManager.installAndPersist(source, {local})` | downloads into the npm/git root and adds the source to the scoped `settings.json` `packages` |
| remove | `packageManager.removeAndPersist(source, {local})` | removes files and the settings entry |
| update | `packageManager.update(source)` (source may be undefined ⇒ all; scope is not passed) | re-fetches into the install root |
| disable | `setPackageDisabled(…, true)` + `settingsManager.flush()` | rewrites the entry as `{source, extensions:[], skills:[], prompts:[], themes:[]}` (object form preserved and merged) |
| enable | `setPackageDisabled(…, false)` + `flush()` | rewrites the entry back to the plain source string — **any per-resource filters in the original object form are lost** |

`setPackageDisabled` (:75-104) reads the scoped `packages` array, maps matching
entries, and calls `setProjectPackages` or `setPackages`; when no entry matches
it returns false and nothing is written, yet the request still answers 200.

### 6.4 Plugins UI (components/PluginsConfig.tsx)

* Trust notice bar when `projectResourcesLoaded === false` (:829-833).
* Sidebar grouped `project` then `global` (:687-694, :847-880); each row is a
  status dot coloured by `status` (`loaded` accent, `installed` warning,
  `disabled` dim, `missing` danger, :120-125) plus the source string, muted when
  disabled. Empty list → "No plugins configured". Footer action **Add plugin**;
  the add panel is forced open when the list is empty (:705).
* Detail (`PackageDetail`, :450-657): scope tag, `Disabled`/`filtered` badge,
  source; action row **Update / Reload session / Remove / enable-disable switch**;
  a field grid of Status, Version (`installed x · configured y` or "Unknown"),
  Package (package.json name), Resources (`n ext · n skills · …` or "No
  resources"/"Disabled"), Installed path (`shortenPath`, "Not found" in danger
  colour) and CWD; then **Resolved Resources** grouped by kind, each entry
  showing name over `relativePath` with the absolute path as the title.
  Success messages ("Package installed." etc.) and errors render below.
* **Reload session** is enabled only with an open session; it sends the RPC
  `{type:"reload"}` via `sendAgentCommand` (:808-823), which re-syncs project
  trust, reloads SDK resources and invalidates the models cache
  (rpc-manager.ts:1115-1122); then it calls `onReloaded` (AppShell bumps
  `sessionKey`) and re-fetches the plugin list.
* Add panel (`AddPluginPanel`, :244-448): a source input, a scope picker
  (project disabled when untrusted), Install button, the target install
  location, three clickable examples (`npm:@scope/pi-plugin`,
  `git:https://github.com/user/repo`, `/absolute/path/to/plugin`) and a
  `pi.dev/packages` link. Pasting or blurring `pi install <src>` (optionally
  `$`-prefixed) is normalized to just `<src>` (:41-44, :341-350).
* Footer: diagnostics count (danger when any is an error, full text in the
  `title`) or the totals line, plus a **Refresh** button (:933-968).
* Selection persisted per cwd as `plugins` → `scope\0source` (:722-724).

---

## 7. Tool definitions and system prompt panels

Both are dropdown panels anchored under the chat toolbar, mutually exclusive
(`activeTopPanel: "system" | "tools" | "session" | null`, AppShell.tsx:2107-2135).

Data comes from one call (useAgentSession.ts:1002-1012):

```ts
const [state] = await Promise.all([
  sendAgentCommand<AgentStateResponse>(sid, { type: "get_state" }),
  loadTools(sid),                       // sendAgentCommand(sid, {type:"get_tools"})
]);
setSystemPrompt(state.systemPrompt ?? "");
```

Opening either panel may create an otherwise dormant session
(`ensureNewSession()`); the comment at :998-1000 stresses these are non-prompt
commands — no message and no model run. Both are in the read-only allowlist, so
they still work when the working folder is gone (rpc-manager.ts:530-540).

* `get_state` returns, among other fields, `systemPrompt: agent.state?.systemPrompt ?? ""`
  (rpc-manager.ts:783). Live state updates also refresh it
  (useAgentSession.ts:723-724, 1630-1631, 1718-1719, 3016-3017).
* `get_tools` returns every tool with `active: activeToolNames.has(name)`
  (rpc-manager.ts:1077-1085).

`SystemPromptPanel` (components/SystemPromptPanel.tsx) is a scrolling
`white-space: pre-wrap` monospace block, height `min(600px, 75dvh)`. Empty
string → "System prompt is empty (tools are disabled)"; `null` → "Loading
system prompt…" while loading, else "System prompt has not loaded yet"
(:12-21, en.ts:77-81).

`ToolDefinitionsPanel` (components/ToolDefinitionsPanel.tsx) is a two-column
grid (`clamp(112px,26%,220px)` + rest). It shows **only active tools**
(:137-140); selection defaults to the first and survives list changes when the
name still exists (:143-154). Detail sections: Description, Parameters with a
count, and Prompt guidelines (`tool.promptGuidelines`) when present. Each
parameter row shows name, Required/Optional, a rendered type, description,
`Allowed:` enum list and `Default:` value.

`getToolParameterFields` (:90-130) reads JSON Schema `properties`/`required`;
`formatSchemaType` (:38-88) resolves `anyOf`/`oneOf` (deduplicated, `|`-joined),
`const`, type-less `enum` (typeof of each value), array `items` → `T[]`,
`$ref` → last path segment, array-typed `type`, else `"unknown"`. Values are
stringified with `JSON.stringify` falling back to `String(value)`.

Empty states: "No active tools" once tools are loaded, otherwise "Loading tool
definitions…"/"Tool definitions have not loaded yet" (en.ts:83-96).

---

## 8. Settings dialog

### 8.1 Structure (components/SettingsPanel.tsx)

Sections: `general` (always), `skills` and `plugins` (`requiresProject`, both
need a non-null cwd) (:239-247). Section tabs carry an icon each
(`SettingsSectionIcon`, :26-68) and `aria-current="page"`; disabled tabs get the
title "Open a project to configure this section".

* Opened from the sidebar gear: `setSettingsSection(getLastSettingsSection(projectTrustCwd))`
  (AppShell.tsx:1131-1134); rendered only while `settingsSection !== null`
  (:2953-2969). `cwd` passed is `projectTrustCwd` = selected session cwd or the
  pending new-session cwd.
* Native `<dialog>` + `showModal()`; closes on ×, on Escape (intercepted with
  `preventDefault` so the global Esc cannot abort a running turn) and on
  backdrop click (:285-303). `onClose` clears the section and bumps
  `modelsRefreshKey`; `onSessionReloaded` (from the plugins panel) bumps
  `sessionKey`.
* Sections are mounted lazily and then kept mounted, toggled with the `hidden`
  attribute, so switching tabs does not refetch (:236-238, :272-283).
* If `cwd` becomes null while a project section is active, the dialog falls back
  to `general` and persists that (:265-270).
* `SkillsConfig`/`PluginsConfig` are keyed by `cwd`, so changing the workspace
  remounts them (:373-383).

### 8.2 General settings (:123-220)

Three sections; **no Pi SDK theme selection anywhere** — SDK themes only appear
as counted package resources in the plugins panel.

| Setting | Control | Values | Storage |
|---|---|---|---|
| Appearance | `role="radiogroup"` with three radio buttons | Light / Dark / System | `pi-theme` = `light|dark|auto` |
| Dumb zone → Token threshold | `<input type=number min=1 step=1000>`; only `Number.isSafeInteger(v) && v > 0` is accepted | default 100000 | `pi-web:dumb-zone-tokens` |
| Completion sound | `ConfigSwitch` | on by default | `pi-sound-enabled` = `"true"`/`"false"` |

Strings: en.ts:50-64. The dumb-zone value feeds
`getContextWarningLevel(usage, dumbZoneTokens)` (lib/context-warning.ts:9-26):
`red` at `usage.percent >= 75`, `yellow` at `usage.tokens >= dumbZoneTokens`,
else `none`; it colours the compaction button (AppShell.tsx:2130-ish
`contextWarningLevel`). Read/write helpers reject non-safe-integer and
non-positive values and swallow storage errors (:28-52).

### 8.3 Mobile (app/settings.css)

Desktop surface: 1080 px wide, 84vh tall, capped at `calc(100vw/100dvh - 16px)`
(:648-660). At `max-width: 640px` (:910-948): the surface fills
`calc(100vw-12px) × calc(100dvh-12px)`, `.settings-section-tabs` is hidden and
the `<select>` `.settings-mobile-section-picker` (rendered always, hidden on
desktop) takes over with 16 px font to avoid iOS zoom; `config-split-view`
stacks vertically with the config sidebar becoming a 190 px-tall top strip.
iOS standalone PWAs add safe-area padding with a 59 px fallback, portrait and
landscape variants (:951-975).

### 8.4 Shared config primitives (components/SettingsUi.tsx)

`ConfigPanelShell`, `ConfigSplitView`, `ConfigSidebar[List|GroupLabel|Item|Text]`,
`ConfigDetail*`, `ConfigField`, `ConfigFooter`, `ConfigButton` (variants
primary/secondary/danger, sizes small/default), `ConfigSwitch` (a
`role="switch"` button with `aria-checked`, `disabled` while loading),
`ConfigListAction` (the "+ Add …" footer button), `ConfigStatusDot`,
`ConfigEmptyState`, `ConfigScopePicker` (two `aria-pressed` buttons; project
disabled + explanatory title when untrusted), and `shortenPath()`.

### 8.5 Settings navigation memory (lib/settings-navigation.ts)

* Storage key `pi-web:settings-navigation`, shape
  `{ section?: string, selections?: { [key]: string } }` where a selection key
  is `JSON.stringify([section, cwd])` (:8, :35-40).
* `getLastSettingsSection(cwd)` returns `general` when storage is unavailable,
  the value is not one of `general|skills|plugins`, or the stored section needs
  a project but `cwd` is null (:42-54).
* `setLastSettingsSection` is called on mount with `initialSection` and on every
  tab activation (SettingsPanel.tsx:249-251, :272-276).
* `getLastSettingsSelection(section, cwd)` / `setLastSettingsSelection` require
  a cwd and a non-empty value; skills store a `filePath`, plugins a
  `scope\0source` key. All reads/writes are wrapped in try/catch — memory is
  best-effort.

### 8.6 Theme (hooks/useTheme.ts)

Module-level store + `useSyncExternalStore`; server snapshot is
`{preference:"auto", theme:"light"}` (:15, :116-118).

* Preference read from `pi-theme`; anything other than `light|dark|auto` (or a
  storage error) → `auto` (:34-42).
* Resolution: `auto` → `matchMedia("(prefers-color-scheme: dark)")` (:27-46).
* Applied by toggling the `dark` class on `<html>` (:48-51). A blocking inline
  script in app/layout.tsx:77-79 applies the same rule before hydration to
  avoid a flash.
* System changes are tracked by the media-query `change` event plus
  `window.focus` and `document.visibilitychange`, because some browsers miss
  scheme events while backgrounded (:89-100); the resync only acts while the
  preference is `auto` and never persists (:81-87).
* `setThemePreference` ignores no-op changes and otherwise animates via
  `document.startViewTransition` with a circular clip-path reveal from the
  viewport centre, 450 ms, `cubic-bezier(0.22,0.61,0.36,1)`; it applies
  immediately when View Transitions are unsupported or
  `prefers-reduced-motion: reduce` (:127-173).
* Returns `{theme, preference, setThemePreference, isDark}`. AppShell calls
  `useTheme()` once for its side effects (:104).

### 8.7 Sound (hooks/useAudio.ts)

* Key `pi-sound-enabled`; unset ⇒ enabled (`readSoundEnabled`, :191-194).
* One lazily created `AudioContext` reused and resumed when suspended
  (autoplay policy), recreated when closed (:228-248).
* `playDone` plays two sine tones, 523.25 Hz and 659.25 Hz, the second offset by
  0.18 s: gain 0 → 0.18 over 20 ms, exponential decay to 0.001 at +0.45 s,
  oscillator stopped at +0.45 s (:196-213, :263-282).
* `toggle` unlocks audio first when enabling, updates ref and state, then
  persists — deliberately last so a failed write cannot desync ref from state
  (:250-261).
* Ownership lives in AppShell, not ChatWindow, so the completion tone also fires
  for tasks finishing in a non-active workspace whose ChatWindow is unmounted
  (AppShell.tsx:114-127).

---

## 9. Models cache stamp (lib/agent-config-stamp.ts)

`readAgentConfigStamp(agentDir = getAgentDir())` stats `auth.json` and
`models.json` in the agent dir and joins their `mtimeMs` with `":"`, using `"-"`
for a missing file (e.g. `"1736112345678.9:-"`). It is opaque — only equality
matters.

Rationale (:5-10): credentials and model metadata are edited in the Pi terminal,
never in pi-web, so nothing calls `invalidateModelsCache()` when they change;
without the stamp a terminal login would stay invisible for the whole cache TTL.

`GET /api/models` computes the stamp per request and passes it to
`loadModelsWithCache(cwd, stamp, loader)` (app/api/models/route.ts:131-133).
The cache (lib/models-cache.ts:63-109) is keyed by cwd on `globalThis`, TTL
60 s, max 32 entries, and serves a hit only when `expiresAt > now && stamp ===
entry.stamp`; a differing stamp deletes the entry and reloads. In-flight loads
are deduplicated per cwd, and a `generation` counter (bumped by
`invalidateModelsCache`, e.g. after granting trust) discards results from before
an invalidation.

---

## 10. Client storage keys

| Key | Written by | Shape |
|---|---|---|
| `pi-theme` | hooks/useTheme.ts:14 | `"light"｜"dark"｜"auto"` |
| `pi-sound-enabled` | hooks/useAudio.ts:188 | `"true"｜"false"` |
| `pi-web:dumb-zone-tokens` | lib/context-warning.ts:5 | integer string |
| `pi-web:settings-navigation` | lib/settings-navigation.ts:8 | `{section, selections}` |
| `pi-web:last-open-by-workspace` | lib/workspace-memory.ts:17 | `{workspaceKey: sessionId}` |
| `pi-web:last-custom-cwd` | SessionSidebar.tsx:165 | absolute path |
| `pi-web:unread-session-ids` | SessionSidebar.tsx:164 | string array |
| `pi-web:file-explorer:open` | lib/file-explorer-state.ts:3 | (explorer state) |

Every accessor treats storage as optional and swallows errors.

## 11. Server-side files written

| Path | Writer | Format |
|---|---|---|
| `<agentDir>/web-worktree-projects.json` | lib/worktree.ts:79-95 | compact JSON map, mode 0600, atomic rename |
| `<agentDir>/trust.json` | SDK ProjectTrustStore via lib/project-trust.ts:28 | sorted JSON, 2-space indent + `\n`, dir-locked |
| `<agentDir>/settings.json`, `<cwd>/.pi/settings.json` | SDK SettingsManager via /api/plugins | `packages[]` entries added/removed/rewritten |
| skill `SKILL.md` files | app/api/skills/route.ts:58 | single frontmatter line inserted/updated/removed |
| skills/packages install roots | `npx skills add`, SDK package manager | `<agentDir>/skills`, `<cwd>/.pi/skills`, `<agentDir>/{npm,git}`, `<cwd>/.pi/{npm,git}` |
