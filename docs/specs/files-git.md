# pi-web behaviour spec: file explorer, file viewer, Git changes

Extracted from /home/mjakl/Projects/pi-web on 2026-09-10 (line numbers refer
to that checkout). This describes what pi-web does, not how web-pi must do it;
where pi-web has a gap (noted in §8) web-pi may do better.

## 0. Component/route map

| Concern | pi-web client | pi-web server |
|---|---|---|
| Tree + changes list | components/FileExplorer.tsx | GET /api/files/[...path]?type=list, GET /api/git/status |
| Viewer (text/image/audio/pdf/docx/diff) | components/FileViewer.tsx | GET /api/files/[...path]?type=read\|meta\|preview\|download\|watch, GET /api/git/diff |
| Tabs | components/TabBar.tsx + lib/file-tab-state.ts | — |
| Panel width | hooks/useResizablePanel.ts + lib/panel-layout.ts | — |
| Search / @-mention index | FileExplorer.tsx:538-581, ChatInput | GET /api/file-index, GET /api/file-completion |

## 1. Path security

### 1.1 Allowed roots (lib/file-access.ts:9-26)

`getAllowedFileRoots()` builds a fresh set per request: every `cwd` in a
session header (lib/session-reader.ts:188-199), the project root of each of
those cwds (lib/worktree.ts:107+, lets a linked worktree reach the main repo
root), and an in-memory additional set (lib/allowed-roots.ts, not persisted
across restarts). Roots are added at: POST /api/cwd/validate (user picks a
folder), POST /api/agent/new (new session cwd), GET /api/worktrees (every
git-verified worktree of an already-allowed project; restart recovery path).
`process.cwd()` is not implicitly allowed.

### 1.2 Lexical containment (lib/path-security.ts:10-29)

`isPathWithinRoots(target, roots)`: per root, use win32 semantics with
lowercasing if either side looks Windows-absolute (`/^[a-zA-Z]:[\\/]/`, `\\\\`,
`//`), else posix; resolve both; accept if equal or `target.startsWith(root +
sep)`.

### 1.3 Symlink-safe containment (lib/path-security.ts:31-51)

`isExistingPathWithinRoots`: realpath target (throw ⇒ false), realpath each
root (drop missing), lexical check on the resolved pair. realpath only, no
O_NOFOLLOW; TOCTOU accepted.

### 1.4 Authorization order (app/api/files/[...path]/route.ts:278-307)

1. lexical check before any fs call (no existence probing);
2. stat (404 on miss, except type=watch which tolerates a missing file);
3. realpath check on the file, or on dirname when the file does not exist;
4. escape hatch for non-list types: a path outside all roots is allowed when
   the given `sessionId` transcript literally references it
   (lib/session-file-references-core.ts:19-67: whole-token match with
   path-character boundaries, tolerant of `file://`, percent-encoding, and a
   `:123` suffix). Session-referenced paths skip the realpath re-check.

Listing is strictly root-only. `authorizeDirectory(cwd)`
(lib/file-access.ts:37-61) returns 400 "cwd must be an absolute path", 403
"Access denied" (lexical), 404 "Directory not found", 400 "Not a directory",
403 "Access denied" (post-realpath). Error bodies are `{"error": string}`.

## 2. GET /api/files/[...path]

Path segments URL-decoded and joined with `/`; Windows-absolute kept as is,
else a leading `/` is forced. `type` defaults to `list`; unknown ⇒ 400
"Invalid file request type". GET only.

- **list**: 400 unless directory. readdir with file types, filtered by the
  ignore list, symlink/unknown resolved via stat (entry dropped if stat
  throws). Sort: directories first, then `localeCompare(name, "en")`.
  Response `{ entries: [{ name, isDir, size: 0, modified: "" }], path }` (no
  per-entry stat). Ignore list (lib/file-dirent.ts:5-30): node_modules, .git,
  .next, dist, build, __pycache__, .turbo, .cache, coverage, .pytest_cache,
  .mypy_cache, target, vendor, .DS_Store, suffix .pyc. `.gitignore` is not
  consulted for listing; other dotfiles are shown.
- **read**: 400 "Not a file" unless regular file. Image (by extension,
  lib/file-types.ts:7-17): 413 "Image too large (>10MB)" above 10 MiB, else
  streamed with image MIME. Audio (file-types.ts:19-30): streamed, no cap.
  Document (pdf, docx): streamed raw. Otherwise text: 413 "File too large for
  preview (>256KB)" above 256 KiB, else `{ content, language, size }`. No
  truncation: over the limit is an error.
- **download**: MIME = image ?? audio ?? document ?? application/octet-stream,
  streamed as attachment.
- **meta**: `{ size, language, mime (fallback text/plain), previewKind: "pdf" | "docx" | null }`.
- **preview**: docx only (400 otherwise); 413 above 10 MiB; mammoth
  `convertToHtml({path}, {externalFileAccess:false, convertImage: images.dataUri})`
  wrapped in a fixed HTML document, served as text/html with CSP
  `default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`,
  `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`.
- **watch** (SSE): fs.watch on dirname, events filtered by `samePath(join(dir,
  changedName), filePath)` (survives atomic rename). Deduplication, not
  debounce: suppress when mtimeMs, ctimeMs, ino, size all unchanged. Events:
  `connected {filePath}` (emitted after the watcher is installed), `change
  {mtime, size}` (deletion sends `{mtime: now, size: 0}` once), `error
  {message:"Failed to watch file"}` then close. No heartbeat.

Streaming/range (route.ts:105-200): `Accept-Ranges: bytes`, `Cache-Control:
no-cache`, nosniff, Content-Disposition with ASCII-sanitised filename plus RFC
5987 `filename*` (fallback `download`). Range grammar `^bytes=(\d*)-(\d*)$`
only; suffix form supported; malformed/unsatisfiable ⇒ 416 with
`Content-Range: bytes */size`; else 206. `image/svg+xml` gets the locked-down
CSP too (an SVG opened directly would run script in the app origin).

Language detection (route.ts:35-92): dockerfile*, .env*, makefile specials,
then an extension table on the lowercased last dot-segment, else "text"; pdf
→ "pdf", docx → "word".

## 3. Explorer (components/FileExplorer.tsx)

- Lazy per-directory loading; root children fetched on mount and on cwd or
  refreshKey change; each node fetches on first expand; refresh re-fetches
  only open, loaded nodes. Rows 24 px, indent 8 + depth×14 px. An expanded
  empty directory shows the text "empty". No virtualisation.
- Sorting/ignores come from the server.
- Icons: Catppuccin SVGs under public/icons/catppuccin/{latte|mocha} used as
  CSS masks over `--text-dim` (app colour, not language colours). Mapping in
  components/FileIcons.tsx:91-177 (special filenames first, then extension,
  else `_file`; folders `_folder`/`_folder_open`).
- No keyboard navigation, no ARIA tree; only Escape closes the search box.
  Expanded state not persisted; only the explorer section open flag
  (`localStorage["pi-web:file-explorer:open"]`).
- Refresh triggers: manual button (2 s green check), agent turn end
  (AppShell.tsx:872), explicit refresh; the same key re-fetches the active
  viewer's diff. Git status re-fetched on cwd/refreshKey only. No polling.
- Search panel: 150 ms debounce + AbortController, GET
  /api/file-index?cwd&q; directories dropped; results folded into a tree
  (lib/search-tree.ts) with ancestors auto-expanded; states searching /
  network error (role=alert) / no matches; normal tree hidden while
  searching.
- Git changes section: rendered above the tree when expanded and non-empty;
  collapsed by default; toggle only when count > 0; while expanded the tree
  is hidden. Header `<n> changed`, `+additions`, `-deletions`. One flat list
  in porcelain order (no staged/unstaged grouping). Row: status letter, icon,
  cwd-relative path, title = absolute; click opens the file with modeHint
  "diff". Letters/colours: M warning, A success, D danger, R #60a5fa, U
  success (untracked), C danger (conflict). Tree files with a status show the
  letter; directories containing changes show a 6 px warning dot; both hidden
  on hover.
- Hover actions: `@` button inserts `@rel/path ` (files), `@rel/dir/ `
  (dirs), quoted `@"rel path" ` when the path has a space
  (lib/file-fuzzy.ts:188-191); on mobile both panels close after insertion.
  Download link (files only). Line ranges come from the viewer:
  `@path:12 ` or `@path:12-20 ` (quoted form with spaces), clamped ≥ 1 and
  reordered (file-fuzzy.ts:194-208). lib/file-links.ts strips a trailing
  `:line[:col]` when resolving a reference back to a path.
- lib/file-links.ts `resolveLocalFileHref(href, baseDir, relativeRoot)`
  rejects `#`/`?`, /api/*, /_next/*, protocol-relative, any scheme other than
  file: (a drive `C:/` is not a scheme); accepts file: URLs (incl. UNC),
  drive-absolute, root-absolute, and relative hrefs that look like files;
  relative results must stay inside relativeRoot (case-insensitive on
  Windows).

## 4. File viewer (components/FileViewer.tsx)

- Dispatch by extension only: image, audio, pdf/docx (document), else text.
  Binary non-media files are not detected (they hit the 256 KB limit or
  render as mojibake).
- Toolbar: relative path (title = absolute), metadata `language · N lines ·
  size` (B / KB / MB one decimal), live indicator dot (green when the SSE is
  connected), mode switch (aria-pressed group), mention button, wrap toggle
  (source mode), download. No copy-path button.
- Modes: `source | preview | diff`. preview available for markdown and html;
  diff when /api/git/diff returned a supported patch; a deleted file only has
  diff. Default is preview for markdown/html on first open with no restored
  state or hint. If a diff request resolves with no patch while diff is
  active, fall back to source.
- Source: above 1000 lines no highlighting (plain lines). Highlighting via
  prism-light with hand-registered grammars (components/SyntaxHighlighter.ts),
  themes vs / vsc-dark-plus, each row `.file-source-line[data-line-number]`.
  Gutter 48 px, right-aligned, tabular-nums, user-select none. Line-range
  selection is native text selection mapped to the nearest lines on
  selectionchange (trimming boundary lines not actually selected). Mention
  button emits the range when one exists (tooltip `(L12-L20)`), else a
  whole-file mention; pointerdown prevented so the selection survives. Wrap
  toggle switches `pre` ⇄ `pre-wrap`; part of per-tab state.
- Markdown preview: frontmatter card + rendered markdown with baseDir so
  links open new tabs and images get the lightbox. HTML preview: `<iframe
  srcDoc sandbox="allow-scripts">`. Frontmatter (lib/frontmatter.ts): `---`
  on line 1, closing `^---[ \t]*$`, js-yaml, non-array object only, failures
  silent. Card: `title` promoted to heading; first array among tags,
  categories, keywords, tag, category becomes chips; the rest a `<dl>`;
  http(s)/mailto strings become `target=_blank rel=noopener` links.
- Diff: GET /api/git/diff?cwd&path; fetched on mount, on refresh key, on
  every watch event. lib/patch.ts parses unified patches (headers recognised
  only between hunks; omitted hunk counts mean 1; `\ No newline` and unknown
  lines are hunk rows; timestamp suffix stripped from paths). Rendered
  unified: 3 lines context, longer unchanged runs collapse to `... N
  unchanged lines ...`; added rgba(0,200,80,.12) + success border `+`;
  removed rgba(240,60,60,.14) + danger `-`; old number for removals, new
  otherwise; "no changes" message when empty. Always worktree vs HEAD; no
  staged parameter.
- Live watch: EventSource opened only while the panel is visible; on
  `connected` and `change` re-read content and re-fetch diff; `error` only
  flips the indicator; stale responses discarded by a monotonic request
  counter. Media viewers re-fetch meta and bump a `?v=n` cache-buster.
- Media: image on checkerboard, object-fit contain, `w × h` from natural
  size plus meta size; audio native controls preload=metadata, `m:ss`
  duration; pdf `<iframe src=read>`; docx `<iframe src=preview
  sandbox="allow-same-origin">`.
- Per-tab viewer state `{ displayMode, wrapLines, scrollTop, scrollLeft }`;
  scroll recorded on scroll into a ref, flushed on unmount; restore deferred
  until content (and, for diff, the patch) is loaded. Precedence: restored
  state → hint → source.

## 5. Tabs, panel, layout

- Tab id `file:${filePath}` (no duplicates). Reopening is a no-op unless the
  source session changed or a mode hint ("diff") was given; a hint resets
  viewer state (keeps wrap), zeroes scroll, bumps a revision that remounts
  the viewer; saving state is ignored when the revision changed. Opening
  activates the tab and opens the panel (mobile closes the sidebar); closing
  the last tab closes the panel; fallback to the last remaining tab. Tabs are
  in-memory only.
- TabBar: horizontal scroller, 36 px, tabs 80–180 px, icon + ellipsised label
  + close, title = absolute path; middle click closes. No reorder, no
  keyboard.
- Resizable panel: pointer-capture drag writing a CSS variable during drag,
  persisted on release; keyboard on `role=separator` handle: arrows ±12 px
  (±32 with Shift), Home/End min/max, Enter/double-click reset; drag
  cancelled on blur/hidden. File panel min 300, max 1200, fallback 560,
  default clamp(viewport×0.42, 360, 640), key `pi-right-panel-width`; sidebar
  180/260/480, key `pi-sidebar-width`. Max widths keep chat ≥ 420 px desktop,
  ≥ 320 px compact; split layout below 960 px. ≥ 960 px the panel is a
  column; 641–959 px a fixed overlay with backdrop; ≤ 640 px full screen.

## 6. Git

- Invocation: `execFile("git", ["-C", cwd, ...args], { timeout: 10_000,
  maxBuffer 8 MiB (diff: 1 MiB), env: {...process.env, LC_ALL: "C"} })`. Repo
  root via `git rev-parse --show-toplevel`, null on failure.
- GET /api/git/status?cwd: `git status --porcelain=v1 -z
  --untracked-files=all`. Parser (lib/git-status.ts:21-42): split on NUL;
  record valid if length ≥ 4 and char 2 is a space; chars 0/1 index/worktree
  status; for R/C the next record is the original path. Classification, first
  match: `??` → untracked U; conflict set (DD AU UD UA DU AA UU or any U) →
  C; contains D → D; contains R/C → R; contains A → A; else M. Entries
  filtered to those under cwd. Response `{ isGitRepository, repositoryRoot,
  files: [{ filePath (absolute), status, code, indexStatus, worktreeStatus }],
  additions, deletions }`; non-repo returns the empty shape. Counts: `git
  diff --no-color --no-ext-diff --numstat HEAD -- <pathspec or ".">` summed
  (binary rows skipped, failures 0/0); untracked counted by reading files
  (skip non-regular, > 256 KB, empty, NUL-containing) and counting newlines.
- GET /api/git/diff?cwd&path: both absolute; both lexical-checked; cwd
  realpath-checked (not the file, since a deleted file has no realpath). File
  must be inside the repo root and present in status, else `{supported:false}`.
  Deleted: `git diff --no-color --no-ext-diff --unified=3 HEAD --
  [originalPath] <path>`. Otherwise regular file ≤ 256 KB without NUL (the
  binary check). Untracked: synthetic patch (`diff --git`, `new file mode
  100644`, `--- /dev/null`, `+++ b/…`, one hunk, `\ No newline at end of
  file`); same fallback when git diff fails on an added file. Final guard:
  patch must contain `"\n@@ "`. Response `{ supported, status?, patch? }`.
  Paths converted to forward slashes for git.

## 7. Adjacent routes

- GET /api/file-index?cwd[&q]: authorizeDirectory; `git ls-files --cached
  --others --exclude-standard -z` (respects .gitignore, cap 200 000) with a
  BFS readdir fallback (depth ≤ 8, 50 000 files, ignore list). Per-cwd cache
  10 s TTL, ≤ 20 entries. Without q: `{ files (cwd-relative, ≤ 5000),
  truncated }`. With q (≤ 500 chars): `{ matches: [{ path, isDir }] }` ranked
  by lib/file-fuzzy.ts:129-149 and cut to 20 (ties: depth then name). This is
  the only place .gitignore matters.
- GET /api/file-completion?q&cwd: names only, not root-gated. Query must be
  path-shaped (`~`, `.`, `..`, `/`, `X:\`, `\\`) and cwd absolute for relative
  ones, else 400. Lists immediate children of the query's directory,
  case-insensitive prefix, dirs first, cap 20, hidden included; ENOENT/
  ENOTDIR 404, EACCES/EPERM 403, else 500, message "Cannot list directory";
  `Cache-Control: no-store`.
- Directory browser (Phase 5): GET /api/cwd/browse?path returns `{ path,
  parentPath, directories: [{name, path}] }` or a Windows drive list; empty
  path = home; `~` expands; realpath'd (404 "Directory does not exist"); must
  be a directory; hidden dirs and dir-symlinks included, files excluded,
  sorted localeCompare("en"); not root-gated. POST /api/cwd/validate {cwd}
  normalises, checks existence/directory (400 with the raw input in the
  message), then allowFileRoot, returning `{success, cwd, projectRoot,
  projectKey}`.

## 8. Gaps in pi-web (a re-implementation may do better)

No keyboard navigation or ARIA tree in the explorer; no create/rename/delete/
upload; no copy-path; no expand persistence; no staged/unstaged grouping; no
truncation of large files (413 instead); no polling; runtime-added roots are
in memory only.
