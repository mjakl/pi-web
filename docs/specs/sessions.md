# Session Operations Spec — pi-web

> Extracted from /home/mjakl/Projects/pi-web on 2026-09-10; describes pi-web behaviour, not web-pi's design.

Source: `/home/mjakl/Projects/pi-web`. Pi SDK = `@earendil-works/pi-coding-agent` 0.85.1 (resolved from host Pi via `bin/link-host-pi.js`; `node_modules/@earendil-works/pi-coding-agent/index.d.ts` is a generated re-export shim).

Shared plumbing referenced throughout:

- `lib/session-reader.ts:349` `resolveSessionPath(id)` — cache → filename hint `_<id>.jsonl` + bounded header check (`:273`) → full catalogue scan `listAllSessions()`; duplicate ids fall back to the scan (`:317`).
- `lib/session-reader.ts:251` `isValidSessionId` — `/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/`.
- `lib/rpc-manager.ts:1420` `beginRpcSessionOperation(id)` — captures `{generation, priorStop}`; `:1431` `assertRpcSessionOperationCurrent` throws `"Session was stopped"` if a stop intervened.
- `lib/agent-client.ts:32` `sendAgentCommand(sessionId, command)` → `POST /api/agent/[id]`, unwraps `{success,data}` / throws `AgentCommandError`.

---

## 1. Titles and lazy row metadata

### Title derivation

- Server title: `lib/session-metadata.ts:29` `sessionTitleFromFirstMessage(first)` = `skillExpansionToCommand(first) ?? first`, sliced to `SESSION_TITLE_MAX_CHARS` (512, `lib/session-metadata-types.ts:3`), falling back to literal `"(no messages)"`. `skillExpansionToCommand` (`lib/slash-display.ts:17`) collapses a full `<skill name=… location=…>…</skill>` envelope back to `/skill:<name> [args]`.
- First-message text: `lib/session-metadata.ts:11` `extractTextContent` — string content as-is, else `type:"text"` blocks joined with `" "`.
- Sidebar row title: `components/SessionItem.tsx:385-389` — `(session.name ?? "") || firstMessage.slice(0,50) || session.id.slice(0,12)`. The 50-char cut is client-side only.

### Row metadata read

`lib/session-metadata.ts:129` `readSessionRowMetadata(filePath, id, expected?)` runs inside `readStableSessionFile` and streams **the entire file**, line by line (`createReadStream` + `readline`, `:147-149`); unparseable lines are skipped (`:156`). Per line:

- star entries (`parseSessionStar`) add/remove `targetId` in a set (`:161-163`);
- assistant message entries record their `id` into `answers` (`:164-171`);
- `session_info` sets `name` = trimmed non-empty `name`, else `undefined` — **last wins**, and an empty name resets it (`:173-179`);
- any `type:"message"` entry increments `messageCount` (all branches, not the active path) (`:181`);
- the first user message fixes `firstMessage` (`:182-190`).

Result (`:194-201`): `{ id, fileSize, modified, name?, messageCount, starCount, firstMessage }` where `starCount` = stars whose target is an assistant entry in this file.

### Stable read

`lib/session-metadata.ts:97` `readStableSessionFile(filePath, read, expected?)`:

- fingerprint = `{fileSize, modified: mtime.toISOString(), device, inode, changedMs, modifiedMs}` (`:74-89`); `ENOENT` → `null`, other errors rethrown.
- if `expected` given and the pre-fingerprint is missing or `fileSize`/`modified` differ → returns `null` without reading (`:103`).
- callback errors are captured, then the file is re-fingerprinted; identity change or a failing closing `stat` → `null` (the error is swallowed); otherwise the captured error is rethrown (`:107-124`).

### `POST /api/sessions/metadata`

Request `{ sessions: [{ id, fileSize, modified }] }`. Validation (`app/api/sessions/metadata/route.ts:12-38`): array, length 1..`SESSION_METADATA_BATCH_SIZE` (10); each entry needs a valid session id, safe non-negative integer `fileSize`, and a `modified` string parseable by `Date.parse`; duplicate ids are dropped (not an error); any violation → `400 {error:"sessions must contain 1-10 valid inventory entries"}`. Bad JSON → `400 {error:"Invalid JSON body"}`.

Response `200 { metadata: SessionRowMetadata[], staleSessionIds: string[] }`, `Cache-Control: no-store`. A session lands in `staleSessionIds` when its path cannot be resolved, when the fingerprint is stale/changed, or on any thrown error (`:61-74`). Never 404s.

### Inventory route

`GET /api/sessions` (`app/api/sessions/route.ts:12`): `listAllSessions()` (bounded 64 KiB / 1-line header read per file, `lib/session-reader.ts:54,203-238`) merged with live runtime rows (`mergeSessionLists`, `lib/session-reader.ts:131`), then **`name`, `messageCount`, `firstMessage` are deleted from every non-transient row** (`:18-28`) so the sidebar must fetch them lazily. `starCount` is *not* deleted, so a persisted row that also has a live runtime carries a runtime star count. Response `{sessions, activeSessionIds, runningSessionIds}`, `no-store`; errors → 500.

### Client lazy loading (`components/SessionSidebar.tsx`)

- `IntersectionObserver` over `[data-session-inventory-id]` rows, root = list, `rootMargin = 2 × SESSION_ITEM_HEIGHT` px (=108, `:168,1257-1287`); the selected row is always queued (`:1289-1294`).
- Queue drained in batches of 10 (`:452-559`); one in-flight request, single `AbortController` cancelled on unmount.
- Non-OK/exception → re-queue batch + retry after `SESSION_METADATA_RETRY_DELAY_MS` = 1000 ms, once per fingerprint (`:433-450`).
- Returned metadata is applied only if `fileSize`/`modified` still match the row (`:517-522`).
- Any `staleSessionIds` triggers one `loadSessions(false, true)` inventory refresh per id (`:538-547`).
- `hasSessionRowMetadata` = `messageCount` is a number and `firstMessage` a string (`lib/transcript-refresh.ts:51`); fingerprint string = `` `${modified}\0${fileSize}` `` (`:43`).
- Star writes feed `starCount`/`fileSize`/`modified` back into the row without an inventory round trip (`components/SessionSidebar.tsx:403-431`).
- While `messageCount === undefined` the row renders `…` with `role="status"` (`components/SessionItem.tsx:886-889`).

---

## 2. Rename

### `PATCH /api/sessions/[id]`

`app/api/sessions/[id]/route.ts:137-157`. Body `{ name: string }`. Only check: `typeof name === "string"` → else `400 {error:"name is required"}` (empty string is accepted and persisted). Unknown id → 404. Success → `{ok:true}`; any throw → 500.

Handler: `setRpcSessionName(operation, filePath, name)` (`lib/rpc-manager.ts:1523`) — waits out any in-flight start lock, re-asserts the operation, then:

- live wrapper alive → `AgentSessionWrapper.setSessionName(name)` (`:471`) → **`AgentSession.setSessionName(name)`**; refuses with `"Session history is being changed"` when inactive or a replacement is running.
- otherwise → **`SessionManager.open(filePath).appendSessionInfo(name)`** — appends a `session_info` entry without starting an agent.

### `set_session_name` command

`lib/rpc-manager.ts:1030-1035`: trims; empty → `Error("Session name cannot be empty")`; then the same `setSessionName` path. Reached from the `/name <args>` slash command (`hooks/useAgentSession.ts:2688-2705`), which then reloads the session and reports `"Session renamed to {name}"`; `/name` with no args → `"Usage: /name <name>"`.

### UI

Sidebar row menu item **Rename** (`components/SessionItem.tsx:983-991`, label `sidebar.rename` = "Rename"). Selecting it swaps the row for an inline `<input>` seeded with the current title (`:392-406`), `aria-label` "Rename session {title}". Enter commits and returns focus to the trigger; Escape cancels; blur commits unless focus went to the menu trigger (`:688-695`, `:680-687`). `commitRename` (`:408`) sends the PATCH only if the value differs from both the displayed title and the stored name — so an untouched rename never persists the first-message fallback. Failures are silently ignored; success calls `onRenamed` → sidebar `loadSessions()`. Rename is hidden for `transient` sessions.

---

## 3. Delete + `reparentChildSessions`

### `DELETE /api/sessions/[id]`

`app/api/sessions/[id]/route.ts:160-180`, in order:

1. `resolveSessionPath(id)`; missing → `404 {error:"Session not found"}`.
2. `await stopRpcSession(id)` — stop first so no runtime can append during the rewrite.
3. `reparentChildSessions(filePath)`.
4. `unlinkSync(filePath)`.
5. `invalidateSessionPathCache(id)` (drops both forward and reverse cache entries, `lib/session-reader.ts:413`).

Returns `{ok:true}`; any throw → 500. No trash/undo.

### `reparentChildSessions(filePath)` — `lib/session-reader.ts:475-522`

- `newParentPath` = the doomed file's own `header.parentSession`; if reading that parent throws (missing/moved) it becomes `undefined`, promoting children to roots (`:476-484`).
- Scans **only the same directory** (`readdirSync(dirname(filePath))`), `*.jsonl`, excluding the target by `pathIdentityKey` (`:486-497`). A read failure aborts the whole operation silently.
- For each sibling whose bounded header `parentSession` identity-matches the target:
  - reads the whole child file; if any line after the first is `{type:"custom", customType:"pi-web:subagent"}` the file is **left byte-for-byte unchanged** (legacy built-in subagent transcripts, `:452-466,506`).
  - otherwise: `JSON.parse` the first line, set `header.parentSession = newParentPath` (key disappears when `undefined`), and write `JSON.stringify(header) + contents.slice(newlineIndex)` — i.e. **only the header line is rewritten** (re-serialised, so its whitespace is normalised); every entry line is preserved verbatim, including a file with no trailing newline (`:508-517`).
  - `writeFileSync`, not atomic; per-file errors are swallowed (`:518-520`).

Grandchildren are untouched: only one level is re-attached.

### UI

Sidebar row menu item **Delete** (`components/SessionItem.tsx:1003-1011`, class `menu-item menu-item-danger`, label `sidebar.delete` = "Delete"). **No confirmation dialog anywhere** (no `confirm()` in the app). The row dims to `opacity: 0.5` while pending (`:666`); on failure the menu trigger regains focus. Success → `onDeleted` → `AppShell.handleSessionDeleted` (`components/AppShell.tsx:944`): refresh inventory; if the deleted session was selected, clear selection, start a new draft in the same cwd, and `router.replace("/")`. Delete is hidden for `transient` sessions.

---

## 4. Export to HTML

`GET /api/sessions/[id]/export?inline=1` — `app/api/sessions/[id]/export/route.ts:180`.

- Resolve path, else `404 {error:"Session not found"}`.
- Temp dir `os.tmpdir()/pi-web-export` (`mkdirSync recursive`), output `<randomUUID>.html`, always `rmSync(..., {force:true})` in `finally` (`:193-221`).
- CLI invocation (`:160-178`): `execFile(process.execPath, [piCli, "--export", filePath, outputPath], { cwd: process.cwd(), timeout: 30_000, maxBuffer: 1 MiB, env: {...process.env, PI_OFFLINE:"1", PI_SKIP_VERSION_CHECK:"1"} })`. `piCli` = `JSON.parse(process.env.PI_WEB_HOST_PI).cli`; missing → `Error("Validated host Pi runtime is missing")`. Note it runs the CLI script under the current Node binary, not `pi` from PATH; `AgentSession.exportToHtml()` is **not** used.
- `patchExportHtml` (`:61-158`): normalises CRLF→LF on both haystack and needles, then performs three literal replacements, each of which **must match exactly once** or throws `Failed to patch exported HTML: <name> expected 1 match, found <n>` → 500:
  - `sortChildren` recursion → explicit DFS stack (children pushed in reverse);
  - `mapNodes` recursion (+ its `tree.forEach(mapNodes)` call) → explicit DFS stack over `[...tree].reverse()`;
  - `markActive` recursion → two-stack post-order using `containsActive.get(child)`.
  These exist because deep linear trees (5000+ entries) overflow the exported page's call stack.
- Response: patched HTML with `Content-Type: text/html; charset=utf-8`, `Cache-Control: no-cache`, `Content-Security-Policy: frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Content-Disposition` from `lib/content-disposition.ts:13` with disposition `inline` when `?inline=1` else `attachment`, filename **`pi-session-<basename(filePath,".jsonl")>.html`** (the on-disk basename, i.e. `<timestamp>_<sessionId>`), ASCII fallback `session.html`.

UI: header toolbar button **"Full history"** (`components/AppShell.tsx:1222-1240`), disabled without a selected session with title `"Full history is available after the session is saved"`; opens `…/export?inline=1` via `window.open(url, "_blank", "noopener,noreferrer")` (`:1015-1021`). No download-file variant is wired up.

---

## 5. Fork / branch / navigate / clone / rewind

### Shared targeting: "entryIds parallel to messages"

`buildSessionContext` (`lib/session-reader.ts:584-701`) builds `messages: AgentMessage[]` and `entryIds: string[]` in one loop, pushing to both only when an entry maps to a UI message (`:666-690`). `entryIds[i]` is therefore the session-entry id of `messages[i]` (`lib/types.ts:382`). Every per-message action passes `entryIds[idx]` (`components/ChatWindow.tsx:1292`) so fork/branch/rewind/star target the exact tree node, independent of pagination, compaction filtering, or rendering. `historyAnchors` and `starredEntryIds` use the same ids for rail navigation.

Target resolution helper `messageActionTarget(manager, entryId, behavior)` (`lib/rpc-manager.ts:75-101`), using **`SessionManager.getEntry(id)`**:

- `behavior:"edit"` requires the entry type to be one of `message | custom_message | compaction | branch_summary`, else `Error("Select an existing conversation message")`; `behavior:"navigate"` accepts any existing entry.
- returns `{entryId, leafId, message}` where `leafId = entry.parentId` when the target is an *edit* on a **user** message (so history reopens *before* it) and `entry.id` otherwise; `message` is that user message.

Concurrency gates (`lib/rpc-manager.ts:127-141, 546-558`): `clone|rewind|branch_from_message|navigate_tree` refuse while another mutating command runs (`Cannot <type> while another session command is running`); while a replacement runs, only `get_state, get_session_stats, get_last_assistant_text, get_tools, get_commands, extension_ui_response, extension_ui_input` are allowed, everything else throws `"Session history is being changed"`.

### `fork` — `lib/rpc-manager.ts:807-844`

- No-op `{cancelled:true}` when `sessionManager.isPersisted()` is false or there is no session file.
- `messageActionTarget(manager, command.entryId)` (edit semantics).
- Creates **`SessionManager.create(cwd, sessionDir, { parentSession: sourceFile })`** → child.
- Snapshots the source into **`SessionManager.inMemory(cwd, undefined, [header, ...manager.getEntries()])`**, and if `target.leafId !== null` calls **`snapshot.createBranchedSession(target.leafId)`** on the snapshot (never on the live manager, which `createBranchedSession` would repoint at the new file).
- `persistSessionManager(child, leafId === null ? [] : snapshot.getEntries())` (`:56-73`) writes `header + entries` as JSONL with `flag:"wx"` and force-sets the SDK's private `flushed = true` so Pi's deferred first flush doesn't rewrite it.
- Reopens with **`SessionManager.open(file, sessionDir)`**, then `copySessionStars(manager.getEntries(), child)` and `cacheSessionPath`.
- Returns `{cancelled:false, newSessionId, message}`.
- **Live runtime is untouched**: no replacement lock, no shutdown; a running turn keeps appending to the source file.
- JSONL effect: a brand-new file containing the root→target path (labels re-chained by the SDK), header `parentSession` = source file path.

UI: per-message **"New session"** button, `HistoryActionButtons` (`components/MessageHistoryActions.tsx:50-73`), title *"New session — copy history to this point into a separate session"*, disabled while another message action is pending. Rendered on user messages and assistant/anchor rows via `historyActions` (`components/ChatWindow.tsx:405-424`); suppressed when `readOnly` (`cwdAvailable === false`). On success (`hooks/useAgentSession.ts:2229-2256`) the returned user message becomes the new session's composer draft and `onSessionForked` switches selection + `?session=` (`components/AppShell.tsx:914-937`). Failure → notice `"Could not create session: {error}"`.

### `branch_from_message` / `navigate_tree` — `lib/rpc-manager.ts:846-914`

- Busy guard → `Error("Wait for the current operation to finish before branching")`.
- `withSessionReplacement("branch", …)`; waits for extension binding; re-checks `isActive()` (`"Session is stopped"`).
- Target: `navigate_tree` uses `command.targetId` with navigate semantics; `branch_from_message` uses `command.entryId` with edit semantics. `navigate_tree` returns `{cancelled:false, leafId}` immediately when the leaf is unchanged.
- Emits extension event **`session_before_tree`** with `preparation:{targetId, oldLeafId, commonAncestorId, entriesToSummarize, userWantsSummary:false}` computed by **`collectEntriesForBranchSummary(manager, oldLeafId, target.entryId)`**, plus an `AbortController.signal` held in `branchAbortController` (aborted by `destroy()`/`shutdown()`). `result.cancel`, abort, or inactivity → `{cancelled:true}`.
- Applies **`SessionManager.resetLeaf()`** when `target.leafId === null`, else **`SessionManager.branch(target.leafId)`**; optional **`SessionManager.appendLabelChange(target.entryId, result.label)`** when an extension supplied a label.
- Rebuilds runtime context: `state.messages = manager.buildSessionContext().messages`, then emits **`session_tree`** `{oldLeafId, newLeafId}`.
- Returns `{cancelled, leafId, message?}`.
- JSONL effect: nothing is deleted; at most one `label` entry is appended. The leaf pointer is in-memory — the branch only materialises when the next entry is appended as a child of the new leaf. (`AgentSession.navigateTree()` itself is used only for the extension command-context action, `:1312-1317`.)

UI: per-message **"New branch"** button (`components/MessageHistoryActions.tsx:22-49`), title *"New branch — continue from this point within the current session"*; disabled while the session is busy or compacting with title *"Wait for the current operation to finish before branching"* (`chat.branchBusy`, `components/ChatWindow.tsx:416-418`). `navigate_tree` is issued by the conversation rail/minimap branch buttons (`components/ChatMinimap.tsx:650` → `handleLeafChange`, `hooks/useAgentSession.ts:2434-2470`), also blocked while an agent/bash/compaction runs. Both then reload the branch context and either restore the user message into the composer (branch) or scroll to the target entry (navigate) (`hooks/useAgentSession.ts:2270-2329`). No confirmation. Errors: `"Could not create branch: {error}"` / `"Could not switch branch: {error}"`.

### `clone` — `lib/rpc-manager.ts:916-960`

- Busy guard → `Error("Cannot clone while the session is running")`.
- `leafId = command.leafId ?? sessionManager.getLeafId()`; requires the branch (**`SessionManager.getBranch(leafId)`**) to contain an assistant message, `isPersisted()`, and the current file to exist — otherwise `{cancelled:true}`.
- Inside `withSessionReplacement("clone", …)`: opens a **separate** `SessionManager.open(currentSessionFile, sessionDir)` and calls **`createBranchedSession(leafId)`** on it (the call repoints its manager at the new file, hence the throwaway instance). Missing output → `Error("Failed to clone current session branch")`.
- `SessionManager.open(clonedPath, sessionDir)` → `copySessionStars(...)` → `cacheSessionPath` → `{cancelled:false, newSessionId}`.
- JSONL effect: a new `<timestamp>_<newId>.jsonl` in the same session dir containing the root→leaf path with labels re-chained, header `parentSession` = the source file (SDK behaviour, `session-manager.js:1128-1134`). The current session's file is unchanged; the live runtime keeps running (only replacement admission is held for the duration).

UI: the built-in slash command **`/clone`** (`components/ChatInput.tsx:248`, `hooks/useAgentSession.ts:2746-2775`). Errors surfaced as command results: `"No active session to clone"`, `"Cannot clone while the session is running"`, `"Cannot clone an empty or unsaved session"`; success message `"Cloned current session branch"`, then `onSessionForked(newSessionId)` switches the UI to the clone. No per-message button, no confirmation.

### `rewind` — `lib/rpc-manager.ts:962-1000` + `lib/session-rewind.ts`

Preconditions, in order:

1. `isActive()` → `"Session is stopped"`.
2. not running (bash/streaming/compacting/pending prompt) → `"Cannot rewind while the session is running"`.
3. no deferred queued input → `"Cannot rewind while queued input is pending. Use Recall first to recover it."`.
4. `SessionManager.getEntry(entryId)` must be a `message` with `role === "user"` → `"Rewind requires an existing user message"`.
5. `sessionFile` must exist → `"Rewind requires a saved session"`.

Then `withSessionReplacement("rewind", …)` calls `this.shutdown({ afterDispose: () => rewindSessionFile(file, sessionId, entryId) })` — i.e. **the runtime is shut down first** (extension `session_shutdown` reason `"quit"`, `AgentSession.dispose()`), the file is rewritten synchronously *after* disposal and *before* the registry entry is released (`:1206-1250`), so no writer can race. `shutdown()` here is not `manual`, so no `session_stopped` event and no `cancelActiveWork`. Returns `{ message }` (the removed user message).

`rewindSessionFile(filePath, sessionId, entryId)` — `lib/session-rewind.ts:8-75`:

- Reads the whole file, drops blank lines, `JSON.parse` every line (a malformed line throws).
- Header must be `type:"session"` with matching `id` → `"Session file identity changed"`.
- Locates the target by id; index must be `> 0` and the entry a user message → `"Rewind requires an existing user message"`.
- If the target has a `parentId` not present among entries before it → `"Rewind target has no earlier parent"`.
- Retains **verbatim** all raw lines before the target (`lines.slice(0, index)`).
- From entries *after* the target it re-appends only preferences: `session_info`, `model_change`, `thinking_level_change`, and star entries whose `targetId` is a retained entry; each is re-serialised with `parentId` re-chained sequentially starting from the target's `parentId` (`:42-56`).
- Appends a synthetic leaf `{type:"custom", customType:"pi-web-rewind", data:{}, id: randomUUID(), parentId, timestamp}` so the reopened session's leaf is the target's parent without resurrecting removed content (`:60-67`).
- Writes with `writePrivateFileAtomicSync` (`lib/atomic-file.ts:9`: temp file `flag:"wx"`, `mode:0o600`, `flush:true`, then `renameSync`).
- Returns the removed user message.

Net JSONL effect: the target user message **and every later conversation entry are physically removed** (unlike branch/navigate). Other branches after the target are lost; earlier branches survive.

UI: **"Rewind"** button on each user message (`components/MessageView.tsx:652-680`), title *"Rewind — remove this message and later history, then edit it again"*. Hidden when `readOnly`, session busy, compacting, a new/unsaved session, or another message action is pending (`components/ChatWindow.tsx:1305-1315`). **No confirmation dialog.** On success (`hooks/useAgentSession.ts:2379-2425`) the removed message text (skill-expansion collapsed) and its images become the composer draft, the SSE stream is closed, and the session is reloaded. Failure → notice `"Could not rewind: {error}"`.

---

## 6. Stars

### Storage format

`lib/session-stars.ts:6` — SDK custom entries, `type:"custom"`, `customType: "pi-web:star"` (`SESSION_STAR_TYPE`), `data: { targetId: string, starred: boolean }`, written with **`SessionManager.appendCustomEntry(SESSION_STAR_TYPE, {targetId, starred})`**. Append-only: unstarring writes `starred:false`, it never edits. `type:"custom"` entries do not participate in LLM context.

- `parseSessionStar(entry)` (`:8`) validates the shape strictly.
- `readSessionStars(entries)` (`:31`) replays all entries in file order (last write wins per target, across every branch) and **returns only targets that are assistant `message` entries in the same file** (`:51`).
- `setSessionStar(manager, targetId, starred)` (`:54`) — throws `"Star target must be an assistant answer"` unless the target entry is an assistant message; appends only when the value actually changes; returns the recomputed list.
- `clearSessionStars(manager)` (`:69`) — appends `starred:false` for every currently-starred target; returns `[]`. Messages are untouched.
- `copySessionStars(source, target)` (`:77`) — used by fork and clone; for every assistant entry in the copy whose star state differs from the source's current state, appends a corrective entry (fixes both stale copied stars and stars added after the branch point).
- Stars are also filtered out of the paged transcript window so they do not consume the page (`lib/session-reader.ts:618-623`).

### `PATCH /api/sessions/[id]/stars`

`app/api/sessions/[id]/stars/route.ts:5-34`. Body `{ targetId: string, starred: boolean }`; either wrong type → `400 {error:"targetId and starred are required"}`. Unknown session → 404. Handler `setRpcSessionStar` (`lib/rpc-manager.ts:1539-1563`): waits for any in-flight startup, then either `AgentSessionWrapper.setStar` on the live wrapper (refuses with `"Session history is being changed"` when inactive/replacing) or `setSessionStar(SessionManager.open(filePath), …)` **without starting an agent**. Response `{ starredEntryIds, starCount, fileSize, modified }` (fresh `statSync`). All errors → `400 {error}` (`lib/error-message.ts`).

### `DELETE /api/sessions/[id]/stars`

Same route `:36-52` — `setRpcSessionStar(operation, filePath, null, false)` → `clearSessionStars`; response shape identical with `starredEntryIds: []`, `starCount: 0`.

### UI

- Per-answer star toggle in `components/MessageView.tsx:864-877`: only on assistant messages, only when not streaming, `aria-pressed`, labels `"Star answer"` / `"Unstar answer"`. Enabled only for final answers (or already-starred rows), never in read-only or transient sessions (`components/ChatWindow.tsx:1295-1302`).
- `handleStar` (`hooks/useAgentSession.ts:1146-1210`) is single-flight (`starPending`), PATCHes, then splices `starredEntryIds`, recomputed `historyAnchors` via `updateStarAnchors` (`lib/session-stars.ts:95`), and the new `starCount/fileSize/modified` into the session info — which the sidebar consumes directly (`components/SessionSidebar.tsx:403-431`). Failure → notice `"Could not update star: {error}"`.
- Sidebar star count: `components/SessionItem.tsx:892-905` — rendered only when `starCount` is truthy, as `<count><StarIcon filled/>`, title/aria `"{count} starred answers"`.
- Sidebar menu item **"Clear all stars"** (`:992-1002`), shown only for non-transient sessions with `starCount > 0`; issues the DELETE, then reloads the inventory and refreshes the selected session (`components/SessionSidebar.tsx:1125-1135`). Failure → sidebar error `"Could not clear stars: {error}"`. No confirmation.
- Rail markers (`components/ChatMinimap.tsx`): starred entries render a filled `StarIcon` in the branch rail (`:630-668`, class `minimap-star`, aria `"Jump to starred answer"` / `"Switch to starred path"`), and starred nodes on the linear rail become clickable jump buttons (`:717-730`). Starred entries are kept as rail anchors even when not loaded, and paging back to a starred anchor expands the whole turn (`lib/session-reader.ts:598-613`).

---

## 7. Session families and project grouping

### `parentSession`

- Header field, validated in `readSessionHeader` (`lib/session-reader.ts:424-450`): optional, must be a string **absolute path** or the header is rejected outright.
- Written by fork (`SessionManager.create(..., {parentSession: sourceFile})`, `lib/rpc-manager.ts:817`) and by the SDK's `createBranchedSession` for clone.
- `listAllSessions` maps parent *paths* to parent *ids* using a path→id map built from the same scan (`:227-236`), exposing `SessionInfo.parentSessionId` (`lib/types.ts:350`).
- `GET /api/sessions/[id]` resolves it per session via `resolveSessionIdByPath(header.parentSession)` (`app/api/sessions/[id]/route.ts:83-85`).
- **No UI consumes `parentSessionId`**: `components/SessionItem.tsx` renders a flat, fixed-height row (`SESSION_ITEM_HEIGHT = 54`, `paddingLeft: 14`) with no indentation, no child grouping, and no parent link. The only behavioural use of the parent chain is `reparentChildSessions` on delete (§3).

### Grouping in the sidebar

Grouping is by **project**, not by family:

- `lib/workspace-memory.ts:81` `workspaceKeyOf(session)` = `projectKey ?? projectRoot ?? cwd`.
- `lib/project-groups.ts:14` `getRecentProjects(sessions)` — dedupe by workspace key, keep the row with the newest `modified`, entry path = `projectEntryPath ?? cwd`, sorted newest first.
- `lib/project-groups.ts:39` `getProjectActivity(sessions, runningIds, unreadIds)` → per key `{running, unread}` counts.
- `lib/project-groups.ts:59` `sessionsForProject(sessions, projectKey)` — filter used for the visible list.
- Sidebar: project dropdown lists `getRecentProjects`, with a filter input shown only when there are more than 8 projects (`components/SessionSidebar.tsx:1166-1171`); the current project is unshifted if absent (`:1155-1165`). Per-project activity badges (spinner + count, dot + count) come from `getProjectActivity` (`:1886-1969`); a dot on the collapsed selector marks activity in *other* workspaces (`:1187-1194, 1504-1517`). Each project row is a `ProjectFolderGroup` that fetches `/api/worktrees?cwd=…` and expands to the repo's worktrees, collapsing to a direct click when there is exactly one folder (`components/ProjectFolderGroup.tsx:66-129`).

### `web-worktree-projects.json`

`lib/worktree.ts`:

- Stored at `join(getAgentDir(), "web-worktree-projects.json")` as `{ [pathIdentityKey]: projectRoot }`, written atomically via `writePrivateFileAtomicSync` and only when something changed (`:65-95`).
- Populated by `rememberProjects` from `resolveProject` for top-level checkouts (both raw and realpath forms, `:152`) and from `listWorktrees` for every worktree in `git worktree list --porcelain -z`, keyed to `records[0].path` (`:183-187`).
- Read by `removedProject(cwd)` (`:97-105`) when a cwd no longer exists: the remembered root becomes `projectRoot`, `isWorktree = root && root !== cwd`, `isTopLevel = Boolean(root)`. This keeps sessions of deleted worktrees grouped under their repository.
- `resolveProject(cwd, refresh=false)` (`:107-163`): 60 s in-process cache keyed `${agentDir}:${pathIdentityKey(cwd)}`, bypassed whenever the directory is unavailable; uses `git rev-parse --path-format=absolute --git-common-dir --git-dir`, `--is-bare-repository`, `--show-toplevel`, `symbolic-ref --quiet --short HEAD`; non-git or failing → `{projectRoot: cwd, branch:null, isWorktree:false, isTopLevel:false}`.

`attachSessionProjectInfo(sessions)` — **`lib/session-reader.ts:101-129`** (not `lib/worktree.ts`): resolves each distinct `cwd` once in parallel, then per session sets `cwdAvailable` (`statSync().isDirectory()`), `projectRoot` (`project.projectRoot ?? cwd`), `projectEntryPath` (only when the worktree cwd is gone and differs from the root), `projectKey = pathIdentityKey(projectRoot)`, plus optional `branch` and `isWorktree`. Applied to both persisted and runtime session lists (`app/api/sessions/route.ts:14-17`) and to the single-session info payload.

---

## 8. Sidebar behaviour

`components/SessionSidebar.tsx` / `components/SessionItem.tsx`.

**Search/filter.** There is **no session text search**. The only filter is the project filter inside the workspace dropdown, rendered when `recentProjects.length > 8`, matching `project.root.toLowerCase().includes(filter)`, Escape clears it and closes the menu, empty result shows `"No matching projects"` (`:1166-1171, 1537-1594`). The visible session list is `sessionsForProject(allSessions, selectedProjectKey)` (all of them when no project is selected), sorted **running first, then active, then `modified` descending** (`:1196-1210`).

**Inventory refresh.** Initial load on mount, then on `refreshKey` changes with `force=1` (`:735-740`); opening the workspace dropdown refreshes inventory + selected session (`:1524-1531`); the header refresh button refreshes both and flashes a green check for 2 s (`:592-599, 706-726, 1372-1436`).

**Unread tracking.** `unreadSessionIds` state, persisted in `localStorage` under `pi-web:unread-session-ids` as a JSON array (`:164, 193-217, 750-752`; storage access is wrapped, failures ignored). Marking (`:835-873`): a session becomes unread when it **was running, is no longer running, is still active, and is not the selected session** ("completed in background"); ids that are currently running are removed. Any background completion also triggers an inventory refresh and `onBackgroundTaskDone()` (cross-workspace completion tone). Selecting a session clears its marker (`:875-883`), and markers for sessions absent from the inventory are dropped (`:680-690`). Unread is rendered by tinting the status indicator to `var(--info)` with class `session-indicator-unread` and title `"{status} · New activity"` (`components/SessionItem.tsx:150-185`).

**Running indicator.** `SessionIndicator` picks one of three states (`components/SessionItem.tsx:76-148, 747-750`): `running` (animated rotating arc, accent, `"Agent running…"`), `active` (filled dot, success, `"Session active"`), `stopped` (hollow circle, dim, `"Session stopped"`). Sets come from `/api/agent/running` polling (§9) with `/api/sessions` only as an initial fallback (`components/SessionSidebar.tsx:676-679, 786`).

**Row content.** Title line; second line = indicator, relative `modified` time (`title` = raw ISO), worktree branch chip when `isWorktree && branch` (`components/SessionItem.tsx:766-804`); right column = `⋯` menu trigger (or the shortcut `kbd`) over star count + `"{count} msgs"`.

**Context menu.** Native `popover="auto"`, fixed-positioned by `menuPositionFor` (width 144, row height 34, or 44 for coarse pointers; opens downward when it fits, else upward; clamped to the viewport) (`components/SessionItem.tsx:49-74`). Item order (`:959-1013`):

1. **Stop** — only when `isActive`.
2. **Activate** — only when not active and not transient.
3. **Rename** — non-transient.
4. **Clear all stars** — non-transient and `starCount > 0`.
5. **Delete** — non-transient, danger styling.

The trigger only exists when `actionsAvailable && (isActive || !transient)` (`:246-247`). Escape closes and restores focus to the trigger; Tab out of either end closes it and moves focus to the trigger or the next tabbable element (`:365-383, 517-545`); a press on the trigger that itself dismissed the popover does not reopen it (`:547-562`); resize repositions rather than unmounting (`:315-345`). While an action is pending the whole row dims and the menu is inert.

**Keyboard shortcuts.** `Ctrl/Cmd+1…9,0` selects the 1st–10th session of the *filtered* list (0 = 10th); ignores repeats and Alt/Shift (`components/SessionSidebar.tsx:1212-1248`). While Ctrl/Cmd is held, rows 1–10 show their `⌘n` / `Ctrl+n` badge instead of the menu trigger, and the new-session button shows `⌘K` (`:1347-1355, 1674-1678`). Global: `Ctrl/Cmd+K` = new session in the active cwd, `Esc` = abort the running turn (`hooks/useKeyboardShortcuts.ts:60-102`).

**Drag.** No session drag-and-drop and no reordering. The only drag in this area is the sidebar width resize handle (`components/AppShell.tsx:1883-1885`, `hooks/useResizablePanel.ts`), pointer-driven with keyboard support, clamped by `SIDEBAR_MIN_WIDTH 180` / `SIDEBAR_MAX_WIDTH 480` / default 260 (`lib/panel-layout.ts:4-6`) and persisted to storage.

**Folder picker entry points** (picker internals out of scope):

- **"Custom path…"** button at the bottom of the workspace dropdown (`components/SessionSidebar.tsx:1598-1619`, label `sidebar.customPath` = "Custom path…") → `handleCustomPathClick` → renders `<DirectoryPicker>` seeded with `pi-web:last-custom-cwd` (`:1305-1316, 177-191`). Selection is validated by `POST /api/cwd/validate` before it becomes the active cwd; the resolved `{cwd, projectRoot, projectKey}` is stored as `validatedProject`, saved to `pi-web:last-custom-cwd`, and the dropdown closes (`:1044-1090`).
- **Project / worktree rows** in the same dropdown (`ProjectFolderGroup.onSelect`) set the cwd directly without the picker (`:1574-1582`).
- A `window.piDesktop.selectDirectory` global is declared (`:42-48`) but never called.

Other sidebar sections: header (title, new session, refresh, settings), workspace selector, session list, and the collapsible **Explorer** panel with changed-files toggle, file search toggle and refresh (state `pi-web:` explorer-open via `lib/file-explorer-state.ts`).

---

## 9. Running list, stop, idle shutdown, admission control

### `GET /api/agent/running`

`app/api/agent/running/route.ts:7` — synchronous, no session start: `{ activeSessionIds: getActiveRpcSessionIds(), runningSessionIds: getRunningRpcSessionIds() }`, `Cache-Control: no-store`.

- `getActiveRpcSessionIds` (`lib/rpc-manager.ts:1652`) = registry entries with `isActive()` = alive && !stopping (`:211`).
- `getRunningRpcSessionIds` (`:1660`) = `isRunning()` = active && (`pendingPromptCount > 0 || inner.isStreaming || inner.isCompacting || inner.isBashRunning`) (`:215-223`).

Client polling (`components/SessionSidebar.tsx:754-821`): every `RUNNING_SESSIONS_POLL_MS` = 2500 ms, only while `document.visibilityState === "visible"`; each poll aborts the previous; hiding the tab cancels the timer and the in-flight request, showing it polls immediately. After the first success `runningPollAuthoritativeRef` makes the poll authoritative — a late `/api/sessions` response can no longer overwrite the sets. `sameSessionIds` (`:173`) keeps object identity when nothing changed so idle sidebars don't re-render.

`getRpcSessionInfos()` (`lib/rpc-manager.ts:1581-1632`) supplies the *rows* for live sessions: skips wrappers that are neither persisted nor (running with a first user message) — so an `ensure_session` runtime never leaks into history; `modified` is the max of header timestamp and message activity timestamps; `transient: !persisted`.

### `DELETE /api/agent/[id]` (stop runtime)

`app/api/agent/[id]/route.ts:79-96`: `Promise.all([stopRpcSession(id), resolveSessionPath(id)])`; if neither a runtime existed nor a file resolves → `404 {error:"Session not found"}`; else `{stopped: boolean}`. The transcript is never removed.

`stopRpcSession(sessionId)` (`lib/rpc-manager.ts:1668-1694`): records `hadRuntime` (alive registry entry or an in-flight start lock), **increments `lifecycle.generation`** (invalidating every outstanding `RpcSessionOperation`), publishes `lifecycle.stopping` so later operations await it, awaits any prior stop and any in-flight startup, then `session.shutdown({manual:true})`.

`shutdown({manual})` (`:1252-1305`): sets `_stopping`, aborts the branch controller, clears `agentRunNeedsCompletion`; `manual` also runs `cancelActiveWork()` (`abortBash`, `abortCompaction`, `AgentSession.abort()`) and emits **`session_stopped`** exactly once. Then emits extension `session_shutdown` `{reason:"quit"}`, racing a `SESSION_SHUTDOWN_TIMEOUT_MS` = 5000 ms timeout (`:125`), and finally `destroy(afterDispose)` → `AgentSession.dispose()` → registry removal (`:1387-1397`).

Client: the SSE stream stops retrying and closes on `session_stopped` (`lib/agent-event-connection.ts:176-181`); the session hook clears streaming/bash/compaction/queue/extension UI state and reloads the persisted session (`hooks/useAgentSession.ts:1769-1789`). Sidebar removes the id from both active and running sets (`components/SessionSidebar.tsx:1112-1123`).

### Idle shutdown

`resetIdleTimer()` (`lib/rpc-manager.ts:440-462`):

- Arms a timer **only for sessions with no persisted transcript** (`hasPersistedTranscript()`, `:434-438`) — i.e. abandoned drafts. A persisted session is never idle-shutdown.
- Timeout: `10 * 60 * 1000` ms (hard-coded, `:460`).
- If not running, `forceShutdownOnIdle` is cleared on each reset.
- On fire: bail if now inactive or persisted; if still running and `!forceShutdownOnIdle`, re-arm; otherwise `shutdown()` (non-manual), logging `"[pi-web] failed to shut down abandoned draft"` on error.
- `forceShutdownOnIdle` is set by the `abort` (`:733`) and `abort_bash` (`:1176`) commands so an explicitly stopped draft is not kept alive by a straggling run; `abort` clears it again when the session is no longer running.
- Timer resets: on `agent_end`, `agent_settled`, `compaction_end` (`IDLE_RESET_EVENT_TYPES`, `:120-124, 228`); at the start of every command **except `get_state`** (`:565`); after each prompt settles (`:662`), after `abort`/`compact` (`withFinalIdleReset`, `:324-330`), and after `bash` (`:1171`).
- Process exit hooks (`:1367-1385`): `exit` → synchronous `destroy()` for all sessions; `SIGINT`/`SIGTERM` → `shutdown()` for all.

### Admission control

- **No maximum concurrent session count anywhere.** The registry is an unbounded `Map` in `globalThis.__piSessions`.
- Per-key start lock `globalThis.__piStartLocks` (`:1399-1405`): a concurrent `startRpcSession` for the same key returns the in-flight promise (`:1729-1730`). New sessions therefore use a unique key `__new__<randomUUID>` (`app/api/agent/new/route.ts:63-72`) so two simultaneous "new session" requests do not collapse into one.
- Existing session states (`lib/rpc-manager.ts:1722-1727`): active → reused after `assertWorkingDirectoryAvailable`; alive but `_stopping` → **`Error("Session is stopping")`**.
- Generation checks throw `"Session was stopped"` (operation stale), `"Session was stopped before startup"`, `"Session was stopped during startup"` (`:1439, 1717, 1846`).
- `trackStartingSession(cwd)` (`:1457-1466`) maintains a **per-cwd counter** in `globalThis.__piStartingSessionCwds`, incremented before startup and decremented in the `finally`. It is *not* a limiter: its only reader is `hasBusyRpcSessionForCwd(cwd)` (`:1634-1641`), which also checks for running sessions in that cwd, and is used by `app/api/project-trust/route.ts:48` to refuse a trust change while the project is busy (`destroyRpcSessionsForCwd` then tears the sessions down at `:60`).
- Command-level admission inside a session: prompt admission is serialised through `promptAdmissionTail` with a compaction escape hatch and a deferred-input queue (`:345-432, 572-729`); working-directory availability is asserted for every command except the read-only/abort set (`:530-545`); session-replacement gates as in §5.
- Other "stopped" surfaces: `POST /api/agent/[id]` returns `404 {error:"Session not found"}` (with `code:"prompt_rejected", accepted:false` for prompts) when there is neither an active runtime nor a file; `GET /api/agent/[id]` returns `{active:false, running:false}` for a missing/inactive runtime; `GET /api/agent/[id]/events` returns `409 {error:"Session is stopped"}` unless `?activate` is present (`app/api/agent/[id]/events/route.ts:28-31`).

---

## 10. Session stats

### Sources

- **`get_session_stats`** (`lib/rpc-manager.ts:1037-1042`): `{ ...AgentSession.getSessionStats(), sessionName: SessionManager.getSessionName() }`. SDK `SessionStats` = `{sessionFile, sessionId, userMessages, assistantMessages, toolCalls, toolResults, totalMessages, tokens:{input,output,cacheRead,cacheWrite,total}, cost, contextUsage?}`. Allowed during session replacement.
- **`GET /api/sessions/[id]`** returns `stats` = `computeSessionStats(entries)` and `totalActiveMs` = `computeSessionTotalActiveMs(entries)` (`app/api/sessions/[id]/route.ts:71-75`) — computed from the file, no runtime needed.
- `lib/session-stats.ts:130` `computeSessionStats(entries)` mirrors the SDK aggregation over **all** entries (including compacted-away history, so totals are monotonic): `compaction` and `branch_summary` entries contribute their `usage` only; `message` entries are counted by role — user → `userMessages`; `toolResult` → `toolResults` + usage; `assistant` → `assistantMessages` + count of `type:"toolCall"` content blocks + usage. `tokens.total` = input + output + cacheRead + cacheWrite; `cost` accumulates `usage.cost.total`.
- `lib/session-stats.ts:75` `mergeSessionStats(fileStats, loadedMessages, currentMessages)` keeps live counters monotonic: file totals plus `max(0, current − loaded)` per field, recomputing `tokens.total`.
- `lib/session-timing.ts:15` `computeSessionTotalActiveMs(entries)`: considers entries of type `message | compaction | branch_summary | custom_message` with a parseable `timestamp`; a `user` or `bashExecution` message **resets** the previous timestamp without adding (those gaps are human idle / unknown start time); otherwise adds the positive delta from the previous timestamp.
- Assembly for the UI: `hooks/useAgentSession.ts:487-517` — a `/session` slash-command override (raw `get_session_stats` result) wins, otherwise `mergeSessionStats` over `data.stats` plus the live message list, always carrying `data.totalActiveMs` and the current `contextUsage`; returns `null` when there is nothing at all.

### Where it is shown

The **session info popover**, opened from the top-bar stats button (`components/AppShell.tsx:1428-1500`, `toggleTopPanel("session")`, `aria-label` "Session info"). Its hover tooltip is `in: … | out: … | cache read: … | cache write: … | Context: {size} ({percent})`. The `/session` slash command also opens it (`hooks/useAgentSession.ts:2707-2719`). Panel body (`components/AppShell.tsx:2135-2400+`):

- **Session Info** — *Name* (only when set), *Session File* (or "In-memory"), *ID*, *Active Time* (only when `totalActiveMs > 0`; formatted `Xh Ym` / `Xm Ys` / `Xs`). Copy buttons for file / id / project dir / branch / worktree, showing a check for the copied field.
- **Project** rows (from the selected session): *Project Dir* (`projectRoot ?? cwd`), *Git Branch* (when set), *Worktree* (`cwd`, when `isWorktree`).
- **Messages** — *User*, *Assistant*, *Tool Calls*, *Tool Results*, *Total*, each `toLocaleString("en")`.
- **Tokens** — *Input*, *Output*, *Cache Read* and *Cache Write* (each only when `> 0`), *Total*; plus *Context window* and *Context usage* when `contextStats` exists, and *Avg cache hit rate* = `cacheRead / (cacheRead + cacheWrite + input)` as `X.Y%` when there is any cache activity.
- **`cost` is computed and propagated end-to-end but is never rendered** — the only reference in components is the change-detection key `components/ChatWindow.tsx:624`.

Related but separate: the compact top-bar context-usage readout and warning colours (`contextWarningLevel`, `lib/context-warning.ts`), fed by `get_state.contextUsage`, which `lib/rpc-manager.ts:741-759` reconstructs by re-estimating tokens after a compaction returns `tokens: null` (marking the result `estimated: true`).