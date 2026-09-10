# Conversation view — rendering behaviour spec

> Extracted from /home/mjakl/Projects/pi-web on 2026-09-10; describes pi-web behaviour, not web-pi's design.

Paths are absolute; line refs are `file:line`.

---

## 0. Composition & data flow

- Transcript lives in `ChatWindow` → `.chat-window > .chat-body > .chat-scroll > .chat-scroll-content > .chat-transcript` (`/home/mjakl/Projects/pi-web/components/ChatWindow.tsx:1072`, `:1199`, `:1205`). Grid: `.chat-body` is `1fr var(--conversation-rail-width)` (`/home/mjakl/Projects/pi-web/app/globals.css:1348`); transcript is `max-width:820px; margin:0 auto` (`:1379`).
- All state comes from `useAgentSession` (`/home/mjakl/Projects/pi-web/hooks/useAgentSession.ts:311`-`398` destructure; returned shape at `:3132`-`3208`).
- Per-message rendering is `MessageView` (`/home/mjakl/Projects/pi-web/components/MessageView.tsx:203`), memoized with an explicit comparator that only re-renders when the message, its own tool results/activities, or identity props change (`:297`-`326`).
- Server data: `GET /api/sessions/[id]` (snapshot) and `GET /api/sessions/[id]/context` (paging/branching), both built by `buildSessionContext` (`/home/mjakl/Projects/pi-web/lib/session-reader.ts:584`).

### 0.1 SessionContext payload (what an SSR renderer needs)

`buildSessionContext` returns (`/home/mjakl/Projects/pi-web/lib/session-reader.ts:692`-`700`):
`messages: AgentMessage[]`, `entryIds: string[]` (index-aligned), `historyAnchors?`, `starredEntryIds`, `oldestEntryId`, `hasMore`, plus session settings (`thinkingLevel`, `model`, `getSessionSettings` `:529`).

Entry → message mapping (`entryToUiMessage` `:819`):
- `message` → as-is, `normalizeToolCalls` applied; legacy string assistant content wrapped into one text block (`:841`).
- `compaction` → `{role:"custom", customType:"compaction", content: summary, display:true, details:{tokensBefore, firstKeptEntryId}}` (`:859`); `estimatedTokensAfter` added later by re-running Pi's context build at that entry (`:672`-`686`).
- `branch_summary` → synthesized **user** message: `*The conversation briefly explored another branch and returned with this summary:*\n\n{summary}`; entries without a summary are dropped (`:871`-`877`).
- `custom_message` → `{role:"custom", customType, content, display, details}` (`:878`).
- anything else → null (not rendered, id not emitted).

`historyAnchors` (only when not `excludeLeaf`, i.e. not a prepend page) = user messages, starred entries, compactions, branch summaries with text, and visible custom anchors; each `{id, preview?, starred?, compaction?, timestamp}` (`:632`-`663`). `preview` uses `getMessagePreview` (100-char rule, §7.2).

`deferThinking` blanks non-empty thinking blocks to `{thinking:"", deferred:true}` (`:847`-`857`). `deferMedia` rewrites tool-result base64 images: allowed MIME + ≤10 MB → `{type:"image", source:{type:"url", url:"/api/sessions/{id}/entries/{entryId}/tool-result-image?blockIndex=N"}}`; otherwise dropped and replaced by a text note `[N tool result images omitted from initial history payload: mime, ~B bytes]` (`/home/mjakl/Projects/pi-web/lib/session-reader.ts:770`-`815`; limits in `/home/mjakl/Projects/pi-web/lib/tool-result-images.ts:1`-`10`).

---

## 1. Turn grouping (ChatWindow)

- **Group boundary** = `role==="user"` OR `custom` with `customType==="compaction"` (`/home/mjakl/Projects/pi-web/lib/message-display.ts:34`). Hidden compactions (`display===false`) still split turns but are not navigation anchors (`isMessageGroupAnchor` `:24`).
- Hidden custom messages (`display===false`) render nothing (`/home/mjakl/Projects/pi-web/components/MessageView.tsx:269`; predicate `/home/mjakl/Projects/pi-web/lib/message-display.ts:17`).
- `turnGroups` memo (`ChatWindow.tsx:794`-`890`) computes per boundary:
  - `finalAssistantIdx` = last assistant with a non-empty text/image answer, else last assistant (`:139`-`153`).
  - Final assistant is **split**: trailing text/image blocks = `answerBlocks`, everything up to and including the last non-answer block = `processBlocks` (`splitFinalAssistantBlocks` `/home/mjakl/Projects/pi-web/lib/message-display.ts:86`-`104`).
  - `processCount`, `toolCallCount`, `writtenFiles` (§8.1), `defaultExpanded`.
- Render order per turn (`ChatWindow.tsx:1394`-`1448`): boundary message → `ProcessDetailsGroup` (if `processCount>0`) → final answer message (with `writtenFiles`) → any trailing messages up to the next boundary.
- **Live tail exception**: if the session is busy/streaming and this is the last boundary, the turn is rendered flat (no grouping/collapsing) (`:1380`-`1392`).
- `ProcessDetailsGroup` (`:195`-`273`): a disclosure button labelled `Process details · N messages[· M tool calls]`, chevron rotates 90°, collapsed body. Default-expanded when there is no final answer, or when some process message itself contains a text/image block (`shouldExpandProcessDetails` `/home/mjakl/Projects/pi-web/lib/message-display.ts:112`).
- Empty assistant blocks (blank text; blank non-deferred thinking) are filtered out when not streaming (`isEmptyAssistantBlock` `:56`).
- Timestamps: only the last assistant before each user message, plus the last assistant overall, get `showTimestamp`; suppressed on the streaming tail (`ChatWindow.tsx:1222`-`1280`).

---

## 2. Message kinds

### 2.1 User (`UserMessageView`, `MessageView.tsx:329`-`685`)

- Full-bleed band: `.user-message-band` (100cqw tinted stripe) with an 820px-max inner row, content right-aligned, `max-width:85%` (`:436`-`450`; CSS `/home/mjakl/Projects/pi-web/app/globals.css:1387`-`1401`).
- Content = concat of text blocks joined by `\n`; images = `image` blocks (`:350`-`361`).
- Images render first, max 240×240, `object-fit:contain`, wrapped in `ImagePreview` (click → modal `<dialog>` lightbox, `/home/mjakl/Projects/pi-web/components/ImagePreview.tsx:14`-`50`). Source: `{source:{base64|url}}` or flat `{data,mimeType}` (`imageSource` `MessageView.tsx:2332`).
- **Skill-command collapse**: if the text matches Pi's skill-expansion envelope, show `/skill:name` as a toggle button plus the args inline; expanded reveals the full expansion via `MarkdownBody` (`:363`-`373`, `:457`-`549`; regex `/home/mjakl/Projects/pi-web/lib/slash-display.ts:5`).
- Otherwise body renders via `SafeMarkdownBody fullHeight` (`:555`).
- Footer row (right-aligned, `:571`-`682`): Copy button (copies the command form if any, else the raw text; label flips to “Copied” for 1500 ms), optional **Rewind** button, `HistoryActionButtons` (New branch / New session), then timestamp (10px).
- No file-reference chip UI for user messages: file links only exist through markdown link/image resolution (§3.3).

### 2.2 Assistant (`AssistantMessageView`, `:687`-`1063`)

Header row (`:849`-`926`), grid columns `1fr 9ch 10ch` while streaming, `auto 1fr` when a star toggle exists, else `1fr`:
- star toggle (only when `onStar && entryId && !isStreaming`), `aria-pressed`, disabled while `starPending` (`:864`-`878`);
- model label = `modelNames["provider:model"] ?? modelNames[model] ?? model`, only when `message.provider` set (`:839`);
- while streaming: live estimated token counter with a down-arrow glyph (`:890`-`922`) and `StreamingSpeed` `"{x.x} t/s"` (`:1162`-`1193`).

Body: one `BlockView` per non-empty block, `gap:8` column (`:928`-`950`, dispatcher `:1065`-`1160`).

Provider error: when `stopReason==="error"` and not streaming, a red `role="alert"` box `Error: {errorMessage || "Unknown provider error"}` (`:952`-`971`; source `/home/mjakl/Projects/pi-web/lib/message-display.ts:74`).

Footer (`:977`-`1060`): usage line `12,345 in · 678 out · N cache R · N cache W` (zero fields omitted; **cost is not shown**) (`formatUsage` `:2389`); Copy button (only when not streaming and at least one text block; copies text blocks joined by `\n`); timestamp pushed right.

Return `null` when there are no blocks, no streaming and no provider error (`:837`).

#### Text block (`:1195`-`1223`)
`SafeMarkdownBody` with `className="markdown-assistant-message"`; while streaming the text goes through `useDeferredValue` so React can drop intermediate parses.

#### Thinking block (`:1249`-`1382`)
- Always **collapsed initially** (`useState(false)` `:1269`); there is **no `hideThinkingBlock` setting anywhere in this repo** (grep-verified) — the only related knobs are server-side `deferThinking` and the bridge's `setHiddenThinkingLabel`, a no-op (`/home/mjakl/Projects/pi-web/lib/extension-ui-bridge.ts:668`).
- Header button: label “Thinking”, optional duration `Ns` right-aligned, chevron rotates 180° when open.
- Duration = streaming-measured block duration if known, else `message.timestamp - prevTimestamp` in whole seconds when >0 (`:773`-`777`, `:938`-`941`; streaming durations measured at block boundaries `:813`-`835`).
- Deferred fetch: on first expand of a `deferred` block, `GET /api/sessions/{id}/entries/{entryId}/thinking?blockIndex=N`, shows `Loading thinking...`, then the text via the markdown text-block path; errors show in `--danger`. LRU cache of 100 promises keyed `sessionId:entryId:blockIndex`, failures evicted (`:112`-`150`, `:1274`-`1292`). Missing session/entry id → “Thinking content unavailable”. Route: `/home/mjakl/Projects/pi-web/app/api/sessions/[id]/entries/[entryId]/thinking/route.ts:3`.

#### Assistant image block (`:1225`-`1247`)
`max-width:min(100%,720px)`, `max-height:520`, `loading="lazy"`, wrapped in `ImagePreview`.

### 2.3 Tool calls (`ToolCallBlock`, `:1384`-`1543`)

- Card border/background is green tinted, red when `result.isError` (`:1414`-`1424`).
- Header button (collapsed by default, `useState(false)` `:1394`): tool name (mono, 11px, green/red), one-line preview, optional `Ns` duration, chevron.
- Preview (`getToolPreview` `:2364`): first of `command`, `path`, `file_path`, `pattern`, `query`, else the first input key; objects JSON-stringified with whitespace collapsed; **truncated to 120 chars**. While the input is still streaming (`rawInput !== undefined`) the preview is replaced by “Generating parameters...” (`:1470`).
- Expanded input `<pre>`: shown when the input is still streaming **or** the tool is not an edit tool (`isEditToolName`, `/home/mjakl/Projects/pi-web/lib/tool-names.ts:19`) — i.e. edit tools suppress the raw args and rely on the diff (`:1507`). Text = `rawInput ?? JSON.stringify(input, null, 2)` (`:2349`).
- **Result renders only when expanded** (`:1529`).
- Duration = `toolResult.timestamp - assistantMessage.timestamp` in whole seconds, >0 only (`:782`-`794`).

#### Diff rendering (read/write/edit)
- If the result has `details.patch` or `details.diff` (string) and is not an error, the result pane is a diff instead of text (`getResultDiff` `:1817`).
- `parseUnifiedPatch` (`/home/mjakl/Projects/pi-web/lib/patch.ts:24`) builds split-diff files: file headers only recognised outside hunk bodies, `@@` counts tracked, removed/added lines paired row-wise with `empty` padding cells, `\ No newline` and unknown lines become `hunk` rows; returns `null` when no line rows exist.
- `SplitPatchView` (`MessageView.tsx:1562`): 2-column grid, `max-height:560` scroll, per-file sticky headers only when >1 file (`Before`/`After` fallback labels), `hunk` rows are **not** rendered. Cell = 42px line-number gutter, 18px `+`/`-`/space marker, wrapped text; tints `rgba(34,197,94,.12)` / `rgba(248,113,113,.13)` / `--bg-subtle` for `empty` (`:1660`-`1734`).
- Fallback when parsing fails: `PatchTextView` — flat line list, `max-height:520`, per-line classification by leading `@@` / `+` / `-`, coloured left border 3px, running line numbers (`:1736`-`1815`).

#### Plain result (`PairedResult`, `:1830`-`1914`)
- Images first (same 720×520 lazy `ImagePreview` treatment), then text `<pre>`: `max-height:400`, scroll, `white-space:pre-wrap`, `word-break:break-all`.
- Empty result (`""` or `"(no output)"`) renders italic dimmed `(no output)`, and is hidden entirely when images exist (`:1408`-`1412`, `:1842`).
- Errors use `--danger` text and red borders.

### 2.4 Subagent tool calls — §4.

### 2.5 Tool result messages
`role==="toolResult"` renders `null` standalone; they are paired into their tool call through `toolResultsMap` (`MessageView.tsx:264`; map built in `ChatWindow.tsx:702`-`710`).

### 2.6 Compaction card (`CompactionMessageView`, `:1916`-`2022`)

- Rendered as `.compaction-marker`: a full-width rule–label–rule header button (`:1949`-`1991`), collapsed by default.
- Numbers: `tokensBefore` and `estimatedTokensAfter` from `details`, each required to be a finite number ≥0, rendered with `formatCompactCount` (1.2M / 12k / 999, `/home/mjakl/Projects/pi-web/lib/i18n/format.ts:36`). Label variants: `{before} → ~{after} tokens`, `{before} tokens before`, `~{after} tokens after` (`en.ts:468`-`470`). The `~after` value carries a title explaining it is an estimate.
- Time appended after `·`; `aria-label` = `Conversation compacted: {tokens}` or `Conversation compacted`.
- Expanded body: fixed description line, then the summary body via `MarkdownBody className="markdown-compaction-message"`, or `No summary`.
- File metadata: `parseCompactionSummary` strips trailing `<read-files>` / `<modified-files>` sections from the body and lists them (`/home/mjakl/Projects/pi-web/lib/compaction-summary.ts:11`). Rendered as `<details>` summary `File context ({n} read, {m} modified)` with two lists (`MessageView.tsx:2024`-`2072`).

### 2.7 Custom (extension) messages (`CustomMessageView`, `:2074`-`2317`)

- Bordered card, collapsed by default. Header: `customType` (or literal `extension`), a one-line preview of the text (**140 chars**, whitespace collapsed, `previewText` `:2357`) or “Show extension message”, time, chevron.
- Expanded: images (240×240) then `MarkdownBody className="markdown-custom-message"` or “No message”; action bar with Copy (text, else the JSON details) and a `Show details`/`Hide details` toggle; details `<pre>` is `JSON.stringify(value,null,2)`, `max-height:360` scroll (`:2292`-`2311`).

### 2.8 Bash execution blocks (`BashExecutionView`, `:2406`-`2520`)

- Synthesizes a `ToolCallContent` + `ToolResultMessage` pair so user-run bash looks identical to an agent bash call; tool name is `bash` or `bash (local)` when `excludeFromContext` (`:2456`-`2472`).
- Pending = no output, no exit code, not cancelled → no result pane. Error = cancelled or non-zero exit.
- When `truncated` and `fullOutputPath` present: `view full output` link fetching `/api/agent/{id}/bash-output?path=…` (button disappears once loaded, shows `loading…`), plus a `download full output` anchor (`&download=1`), plus an inline `(error)` note (`:2477`-`2517`).
- Output is plain `<pre>` text via `PairedResult`; ANSI is **not** converted here — `AnsiText` is used only for extension widgets/status and the extension custom panel (`ChatWindow.tsx:2096`, `ExtensionStatusBar.tsx:53`, `ExtensionWidgets.tsx:159`).

### 2.9 Message actions

- `HistoryActionFrame` wraps assistant, custom, compaction, bash-execution messages and each tool-call block; hover/`focus-within` fades in the action row (`/home/mjakl/Projects/pi-web/components/MessageHistoryActions.tsx:78`; CSS `globals.css:2915`-`2928`).
- Buttons (`MessageHistoryActions.tsx:13`-`76`): **New branch** (`onBranch`, disabled while pending or while `branchDisabledReason` is set — reason is “session busy/compacting”, `ChatWindow.tsx:417`) and **New session** (`onFork`). "New branch" is the "edit and resend" entry point: it truncates to that entry and refills the composer with the original message text+images (`useAgentSession.ts:2331`, draft restore at `:2306`-`2325`).
- **Rewind** appears on user messages only, and only when not readOnly / busy / compacting / new session / another action pending (`ChatWindow.tsx:1305`-`1315`); it calls `rewind` and reloads the session with the message restored as a draft (`useAgentSession.ts:2378`).
- **Star**: `onStar` is supplied only for a turn's final answer message (or already-starred messages), and never when readOnly or `session.transient` (`ChatWindow.tsx:1294`-`1302`). PATCH `/api/sessions/{id}/stars` `{targetId, starred}` returns the new `starredEntryIds`/`starCount` (`useAgentSession.ts:1146`-`1180`).
- **Copy** on user and assistant messages, 1500 ms “Copied” state (`MessageView.tsx:413`, `:796`).

---

## 3. Markdown pipeline

### 3.1 Plugins & sanitize (`/home/mjakl/Projects/pi-web/lib/markdown.ts`)
- remark: `remarkFrontmatter(["yaml"])` then `remarkGfm({singleTilde:false})` (`:20`-`23`). Frontmatter is parsed to a `yaml` node so it never renders; `singleTilde:false` protects CJK `~` ranges.
- rehype: `rehypeRaw` then `rehypeSanitize` with `defaultSchema` extended by `strip: [...default, "iframe","object","style","form"]` (`:7`-`10`, `:24`-`27`). Sanitizer prefixes heading ids with `user-content-`.

### 3.2 Guard (`SafeMarkdownBody`, `/home/mjakl/Projects/pi-web/components/SafeMarkdownBody.tsx`)
- `MAX_MARKDOWN_CHARS = 100_000` (`:10`). Over the limit: renders a click-to-reveal button `⚠ {size}` (bytes formatted `MB`/`KB`/`B`, `:12`-`16`); revealing shows a plain `<pre>` (`max-height:420` scroll unless `fullHeight`) — the markdown pipeline never runs (`:31`-`88`).

### 3.3 Component overrides (`MarkdownBody.tsx:36`-`153`)
- `code`: block when the class has `language-` or the text contains a newline. `mermaid` → `MermaidBlock`; else `CodeBlock`. Inline code → `<code class="markdown-inline-code">` (`:38`-`71`). `pre` unwrapped (`:72`).
- `a`: `#anchor` hrefs get rewritten to `#user-content-anchor` (`:80`); local file hrefs resolved by `resolveLocalFileHref(href, baseDir ?? cwd, cwd)` open in the app's file pane via `onOpenFile` (plain left click only, modifier clicks fall through) (`:87`-`122`); only `https?:`/`mailto:` get `target="_blank" rel="noopener noreferrer"` (`:94`).
- `img`: local paths rewritten to `getFileApiUrl(filePath,"read",sessionId)`; a sanitized-away src falls back to rendering the alt text; images wrapped in `ImagePreview` and lazy-loaded (`:124`-`143`).
- `table` wrapped in `.markdown-table-wrap` (`:144`).
- File-link resolution rules (`/home/mjakl/Projects/pi-web/lib/file-links.ts:70`-`123`): rejects `/api/`, `/_next/`, protocol-relative and non-`file:` schemes; supports `file:` URLs, Windows drives, UNC, absolute and relative paths; strips `:line[:col]` suffixes; relative paths must stay inside `relativeRoot`.

### 3.4 Code blocks (`CodeBlock`, `/home/mjakl/Projects/pi-web/components/MermaidBlock.tsx:335`-`406`)
- Header: language label (`lang || "text"`) + optional extra action + **Copy** button (“Copied” for 1500 ms).
- While the owning message streams, the body is plain monospace `<pre>` (no tokenization); once settled, Prism with `showLineNumbers`, theme `vs` (light) / `vsc-dark-plus` (dark), 12.5px/1.62 (`:369`-`403`). Memoized on `code`.

### 3.5 Syntax highlighting (`/home/mjakl/Projects/pi-web/components/SyntaxHighlighter.ts`)
Deep-imports `prism-light` and registers exactly: bash, c, cpp, csharp, css, docker, go, graphql, hcl, java, javascript, json, kotlin, makefile, markdown, markup, python, ruby, rust, sql, swift, toml, typescript, yaml (file-viewer set) + dart, diff, elixir, git, haskell, ini, jsx, less, lua, nginx, objectivec, perl, php, powershell, protobuf, r, regex, scala, scss, tsx (chat-only) (`:10`-`104`); `markup` aliased to `html`,`xml` (`:107`). Grammar aliases (`ts`, `yml`) come from refractor.

### 3.6 Mermaid (`MermaidBlock`, `:34`-`161`)
- Default view is the **source** (`defaultPreview` defaults false); toggle button label flips `Preview` ⇄ `Source`, disabled while streaming with the title “preview after streaming” (`:81`-`104`, `:41`, `:45`).
- Preview path dynamically imports `mermaid`, `initialize({startOnLoad:false, securityLevel:"strict", suppressErrorRendering:true, theme: dark?"dark":"default"})`, `parse` then `render` with a random id; render key is `theme\ncode`, so a theme change re-renders (`:44`-`79`). States: loading placeholder, `Invalid Mermaid diagram` on failure, or the SVG injected via `dangerouslySetInnerHTML` inside a button.
- Clicking the rendered diagram opens `MermaidZoomDialog`: native modal `<dialog>`, body scroll locked, toolbar with −/+ stepper (`ZOOM_STEP 0.25`, `ZOOM_MIN 0.5`, `ZOOM_MAX 3`), percentage readout, fit-to-width (reset to 1), close; Escape and backdrop click close it; zoom applied as canvas `width: {zoom*100}%` (`:163`-`316`, constants `:25`-`27`).

---

## 4. Subagent tool rendering

Recognition (`/home/mjakl/Projects/pi-web/lib/subagent-display.ts:33`-`60`): `toolName === "subagent"`, input not still streaming (`rawInput === undefined`), `input.calls` a non-empty array where **every** element has a non-blank string `agent` and a string `prompt`. Optional per call: `model`, `cwd`, `initialContext`, `session`. Anything else falls back to the generic `ToolCallBlock` (`MessageView.tsx:1126`).

Results pairing (`:87`-`139`): only accepted when `result.details.kind === "pi-subagent"`, `details.results` is an array of the **same length** as `calls`, every item has a matching `agent`, an array `messages`, and a finite numeric `exitCode`; `callIndex` (default: position) must be unique and in range. Any deviation → `rows = null` (generic raw-output rendering). Status mapping: `stopReason==="aborted"` → `cancelled`; `processError===true || exitCode>0` → `failed`; `exitCode===0` → `completed`; else `unknown`. Output = the last assistant message's text parts joined by `\n\n` (`:62`-`84`). `error` (failed/cancelled only) = `errorMessage || stderr`. Flags `captureTruncated`, `handledWithoutAgent`. `subagentResultFailed` also honours `result.isError` and `details.failed` (`:141`).

Rendering (`/home/mjakl/Projects/pi-web/components/SubagentToolCall.tsx:73`-`307`) — everything is a native `<details>`/`<summary>` `Disclosure` whose children are lazily built only when open (`:16`-`53`):
- Card summary: `Subagent · {agent}` for one call, `Subagent · {n} agents` for many; then either a per-status **counts** line (`{n} completed · {n} failed · …`, only for multi-call with rows) or a single `Status` chip; then duration (`formatDuration`: `1h 2m 3s`/`2m 3s`/`3s`), then live progress text when running (`:222`-`249`).
- Status glyphs: `✓` completed, `!` failed, `◌` running, `—` cancelled/unknown; running = no result yet and an `activity` entry exists (`:55`-`71`, `:102`).
- Body per call (`:133`-`220`): meta line (model, last cwd segment with full path as title); `Result` section with the output through `SafeMarkdownBody` (cwd/onOpenFile/sessionId threaded), `subagent-error` paragraph, or `Prompt handled without an agent response.` / `No output.`; `captureTruncated` notice; then disclosures **Prompt** (raw `<pre>`) and **Run details** (`<dl>` of Agent, Model, Working directory, Requested initial context, Session).
- Multi-call: each call is its own nested disclosure labelled `agent` + status (`:269`-`282`).
- When a result exists but pairing failed, a single top `Result` section renders the raw text (`:253`-`266`).
- Tool-result images are passed in from `MessageView` as pre-rendered nodes and inserted after the calls (`:283`; producer `MessageView.tsx:1142`).
- Bottom `subagent-raw` block: **Raw input** (`JSON.stringify(block.input,null,2)`) and, when a result exists, **Raw output** (`:284`-`303`).

---

## 5. Extension widgets & status shelf

### 5.1 Event flow
Server bridge `/home/mjakl/Projects/pi-web/lib/extension-ui-bridge.ts`:
- `setStatus(key, text)` → keeps a `Map<key,text>` and emits `extension_ui_request {method:"setStatus", statusKey, statusText}`; `undefined` deletes (`:654`-`667`).
- `setWidget(key, content, {placement})` → array content stored as `{key, lines, placement: placement ?? "aboveEditor"}` and emitted as `{method:"setWidget", widgetKey, widgetLines, widgetPlacement}`; `undefined` clears (emits `widgetLines: undefined`) (`:669`-`701`, clear `:198`-`206`). Function content becomes a rendered widget component whose `render(width)` must return `string[]` (`:305`-`330`).
- `setFooter` and `setHeader` are **no-ops** (`:702`-`703`).
- Snapshots replayed via `statuses()` / `widgets()` (`:166`-`172`) and applied on `agent_end`, reconcile, and state load (`useAgentSession.ts:1718`-`1722`, `:1631`-`1636`, `:724`-`728`).

Client reduction (`useAgentSession.ts:1309`-`1329`): status/widget lists are key-replace-or-remove; `session_stopped` clears both (`:1779`-`1782`).

### 5.2 Placement
`ExtensionStatusBar` renders inside the composer footer, below `ChatInput` (`ChatWindow.tsx:1561`-`1564`), and again inside the mobile controls menu with `announce={false}` (`ChatInput.tsx:2488`-`2497`). It returns null when both lists are empty (`ExtensionStatusBar.tsx:35`).

### 5.3 Status line (`/home/mjakl/Projects/pi-web/components/ExtensionStatusBar.tsx`)
Statuses sorted by key, each sanitized (CRLF→LF, tabs→space, runs of spaces collapsed, per-line trim) and joined with a single space (`:8`-`24`). Rendered via `AnsiText`; `role="status"` (when `announce`) with an ANSI-stripped `aria-label`/`title` (`:40`-`56`). On ≤640px the line becomes visually-hidden but stays a live region (`globals.css:2258`-`2272`).

### 5.4 Widgets (`/home/mjakl/Projects/pi-web/components/ExtensionWidgets.tsx`)
- Trigger chips row (horizontally scrollable), one per widget: a placement triangle (up = `aboveEditor`, down = `belowEditor`), the widget key, and an update pulse dot. Widgets with lines are buttons with `aria-expanded`/`aria-controls`; empty ones are inert `<div>`s (`:171`-`244`).
- Only one panel is expanded at a time; clicking the expanded one collapses it (`getNextExpandedWidgetKey` `:48`). Initial expansion: the first widget with 2..3 lines (`DEFAULT_EXPANDED_WIDGET_LINES = 3`, `:8`, `:37`-`46`).
- Panel: heading = widget key, body = `<pre>` of lines joined by `\n` through `AnsiText` (`:149`-`161`).
- “Updating” pulse: keys whose line arrays changed get `is-updating` for `WIDGET_UPDATE_IDLE_MS = 1100` after the last change; removed keys drop out immediately (`:9`, `:73`-`116`; CSS `globals.css:224`-`239`).

### 5.5 ANSI (`/home/mjakl/Projects/pi-web/components/AnsiText.tsx`)
`new AnsiUp().ansi_to_html(text)` injected as HTML into a `<span>`; `ansi_up` HTML-escapes, so widget text cannot inject markup (`:17`-`19`). Stripping and TUI-frame normalization live in `/home/mjakl/Projects/pi-web/lib/ansi.ts`: `stripAnsi` removes `\x1B_pi:c\x07` cursor markers and SGR/OSC sequences (`:11`); `normalizeCustomPanelLines` drops horizontal box-frame lines, strips `│`/`┃` borders (ANSI-aware, by visible character position), trims trailing visible spaces, and clips leading/trailing blank lines (`:63`-`98`) — used by the extension custom panel (`ChatWindow.tsx:1959`, `:2096`).

---

## 6. Lazy loading, scroll, jump-to-latest

### 6.1 API params — `GET /api/sessions/[id]/context` (`/home/mjakl/Projects/pi-web/app/api/sessions/[id]/context/route.ts`)
| param | meaning |
|---|---|
| `tail` | ancestor cap; default 50, clamped to 1000 (`:18`-`22`) |
| `before` | oldest entry already on the client; the walk starts at its **parent** (`excludeLeaf`) so the page does not duplicate it (`:23`, `:56`) |
| `through` | expand the page back to this entry (rail navigation); **400 without `before`** (`:24`-`30`); RangeError → 400 if the target is not on the page's branch (`session-reader.ts:596`) |
| `leafId` | branch to view; falls back to `sm.getLeafId()` (`:47`) |
| `root` | view the empty pre-first-entry branch; also implied when no `leafId` and the session leaf is null (`:50`-`52`) |
| `deferThinking` | presence flag → blank thinking blocks (§0.1) |
| `deferMedia` | presence flag → tool-result images become lazy URLs (§0.1) |

Response: `{context, tail, before}`. `GET /api/sessions/[id]` takes the same `tail`/`deferThinking`/`deferMedia` and adds `info/tree/stats/leafId/totalActiveMs` (`/home/mjakl/Projects/pi-web/app/api/sessions/[id]/route.ts:48`-`115`).

Slicing: `sliceActiveBranch` walks parents iteratively from the leaf, capped at `tail`, then reverses (`session-reader.ts:710`-`733`). With `tail`, star-marker custom entries are filtered before the tail slice (`:618`-`623`). With `through`, and when the target is a **starred** entry, the page is extended back to the enclosing turn boundary (previous user/compaction/branch_summary) so the answer arrives with its prompt (`:600`-`613`). `hasMore = Boolean(sliced[0].parentId)` (`:625`).

### 6.2 Page sizes (`/home/mjakl/Projects/pi-web/lib/chat-lazy-load.ts`)
`SESSION_TAIL_DEFAULT = 50`, `SESSION_TAIL_MAX = 1000` (`:6`-`7`). Snapshot reloads request `getSnapshotTail(loadedCount)` = `null` when ≤50, else `min(loadedCount, 1000)`, so a reload after a turn keeps everything already paged in (`:13`-`16`; used at `useAgentSession.ts:592`, `:670`, `:1250`).

### 6.3 Trigger & scroll preservation
- Sentinel `<div class="chat-load-earlier">Scroll up to load earlier messages</div>` rendered above the list only when `hasEarlierMessages` (`ChatWindow.tsx:1453`-`1457`).
- `IntersectionObserver({root: scrollContainer, threshold: 0})` on the sentinel; on intersection, if not already loading and a `historyCursor` exists, it records `{id, distance: scrollHeight - scrollTop, firstEntryId}` and calls `loadEarlierMessages()` (`:568`-`606`).
- After the prepend commits, a `useLayoutEffect` restores `scrollTop = max(0, scrollHeight - savedDistance)` — but only if the first entry id actually changed (`didPrependHistory`) (`:927`-`940`; helpers `chat-lazy-load.ts:20`-`39`).
- `loadEarlierMessages` serializes concurrent calls, aborts if the session or leaf changed, short-circuits when the `through` target is already loaded, and returns false when there is nothing older (`useAgentSession.ts:838`-`876`). Pages are prepended to `messages`/`entryIds` (`:800`-`820`).

### 6.4 Follow / jump-to-latest
- `getLiveFollowAttached`: re-attaches whenever the view is at the tail; detaches on any upward scroll; otherwise sticks (`chat-lazy-load.ts:50`-`60`). `isScrollAtTail` tolerance = **8px** (`:18`, `:41`).
- Layout effect priority each render (`ChatWindow.tsx:898`-`961`): branch-scroll anchor → leaf change (jump to latest or anchor, restoring rail focus) → pending prepend restore → first-ever render (jump to latest) → rAF-scheduled `alignBranchScrollAnchor` / follow-tail / sync.
- A `ResizeObserver` on the scroll container and its first child re-runs the same scheduler (`:963`-`973`).
- `ChatJumpToLatest` shows **only when `!atTail`** (`:1509`; component `/home/mjakl/Projects/pi-web/components/ChatJumpToLatest.tsx:13`); click releases the branch anchor and scrolls smooth unless `prefers-reduced-motion` (`:499`-`505`). Positioned bottom-right clear of the rail; on ≤640px it moves to `right:14px` (`globals.css:2193`-`2196`, `:2287`-`2290`).
- Branch scroll anchoring places the target element at 30% of the viewport height and keeps follow detached; any pointer/wheel/touch/key interaction in `.chat-body` releases the anchor (`:726`-`757`, `:1177`-`1197`).

---

## 7. Conversation rail / minimap

`/home/mjakl/Projects/pi-web/components/ChatMinimap.tsx`, remounted per `session:leaf` key (`ChatWindow.tsx:1512`).

### 7.1 Marks
Node set = `historyAnchors` ids ∪ loaded anchors (group anchors and starred entries), deduped and order-preserving (`:134`-`151`). Three visual forms (`:680`-`769`):
- **compaction** → 18×2px horizontal separator, `role="separator"`, `aria-label="Conversation compacted"` (`:704`-`716`);
- **star** → filled star button, `Jump to starred answer` (`:717`-`733`);
- **prompt** → 8×8 rounded square, grey; active node is opaque with a panel-coloured ring; hovered node scales 1.25× (`:734`-`765`).

### 7.2 Hover preview
Preview text comes from `historyAnchors[].preview` or, for loaded user messages, `getMessagePreview(content)` (`:152`-`165`). **100-char rule** (`/home/mjakl/Projects/pi-web/lib/message-preview.ts:4`-`28`): text blocks only, whitespace collapsed to single spaces, and once the accumulated characters exceed 100 it returns the first 99 + `…`. Compaction and star nodes get no preview (`:503`-`508`). The popover appears after a **180 ms** delay, is portalled to `document.body`, positioned left of the anchor, clamped to the viewport with an arrow aligned to the anchor centre, and repositions on resize/scroll (`/home/mjakl/Projects/pi-web/components/MessagePreviewPopover.tsx:23`-`66`).

### 7.3 Click / drag
- `mousedown` anywhere in the first 36px column starts a drag: pointer ratio → nearest node → scroll (`smooth` on press, `auto` while dragging) (`:460`-`496`). When the rail is not filled to full height, a hit radius of `max(10, gap/2)` rejects far clicks (`:452`-`457`).
- `scrollToNode` scrolls the target to 30% of the viewport height and locks the active dot for `NAVIGATION_ACTIVE_LOCK_MS = 1600` (`:417`-`434`, `:52`, `:239`-`245`).
- Unmeasured target (not loaded yet) → sets a pending navigation id and loops `onLoadThrough(id)` (→ `loadEarlierMessages(entryId)`), re-measuring until the node has an offset, then scrolls (`:399`-`415`, retry inside `measureNodes` `:338`-`348`).
- Branch markers are buttons calling `onLeafChange(targetLeafId, scrollEntryId)`; disabled while loading/busy/compacting/pending (`:649`-`650`, gating `ChatWindow.tsx:1518`-`1524`).

### 7.4 Scroll sync & measurement
- `scroll` listener (passive) → rAF-scheduled `updateScroll`: rail becomes visible when the container is scrollable by >20px or there is more than one anchor; active node = measured node whose offset is nearest `scrollTop + clientHeight*0.3`, unless the navigation lock is live (`:247`-`284`).
- `measureNodes` is throttled by a 150 ms timeout; it reads each anchor's DOM offset from `answerRefs` (starred answers) or `messageRefs` (prompt anchors), skips the state update when nothing moved, and updates the rail height (`:286`-`356`). Re-measure is also triggered by a `ResizeObserver` on the scroll container/first child (`:367`-`387`) and a 50 ms debounce whenever the anchor list changes (`:389`-`397`).

### 7.5 Linear vs branched rail (latest commits)
- `hasSessionBranches(tree)` — iterative walk; true as soon as two nodes share a parent (`/home/mjakl/Projects/pi-web/lib/conversation-rail.ts:19`-`39`).
- Since `aabbc27` ("Align linear and branched conversation rails") **both modes use the same layout**: `buildConversationRail` is always called — with the real tree when branched, with `[]` when linear (so anchors form one active path) — and node vertical positions always come from the graph's `row`, not from an index-based layout. The old `layoutNodes` helper was deleted (`ChatMinimap.tsx:183`-`235`; diff: `git show aabbc27 -- components/ChatMinimap.tsx`).
- `buildConversationRail` (`conversation-rail.ts:44`-`156`): builds parent links (expanding `compressedEntryIds`), marks the active path from `activeLeafId` (or the last anchor present) back to the root, keeps tree representatives + anchors + stars + the active leaf, re-parents kept nodes to their nearest kept ancestor, appends live anchors the persisted tree has not caught up with onto the active tail, sorts siblings active-first, assigns lane 0 to the first child and a fresh lane to each other child, rows = visible depth, and finally sets each node's `targetLeafId` to the deepest node in its lane. `scrollEntryId` is set only for stars and for user-message representatives (`:93`-`98`).
- Geometry: `MINIMAP_WIDTH 36`, `BRANCH_LANE_GAP 36`, `GRAPH_NODE_CLEARANCE 5`, `MAX_NODE_GAP 50`, `MINIMAP_PADDING 12`, `MINIMAP_FOOTER 30` (reserved for the jump button) (`ChatMinimap.tsx:46`-`55`). `graphGap = min(50, (height - 30 - 24) / rows)`; `graphWidth = max over nodes of lane*36 + 36` and is published upward as `--expanded-conversation-rail-width` (`:199`-`214`; consumed `ChatWindow.tsx:1077`, CSS `globals.css:1309`-`1314`, capped at 50% width).
- Collapsed: only active-path nodes are drawn. Expanded (hover or keyboard focus on a branched rail): the whole graph, with cubic Bézier connectors (`stroke-width` 2/opacity .8 active, 1/.55 inactive) and square markers per branch node; junction nodes on the active path are inert spans (`:178`-`214`, `:583`-`679`). Leaving collapses and resets `scrollLeft` (`:180`-`182`, `:566`-`570`). Pointer press inside the rail explicitly clears the focus-pin so a click does not keep it expanded (`:534`-`540`).
- **Mobile**: `.chat-minimap { display:none !important }` and `.chat-body` becomes a single column below 640px (`globals.css:2227`-`2236`).

---

## 8. Turn summaries, retry, compaction, errors, notices

### 8.1 Turn written files
- `extractTurnWrittenFiles(turnBlocks, toolResults, cwd)` (`/home/mjakl/Projects/pi-web/lib/turn-written-files.ts:32`-`61`): only `write`/`edit`-named tool calls (`isWriteToolName`/`isEditToolName`, which also accept `write_*`, `*.write`, `*_write`, `edit_*`, `*_edit`, `*str_replace*`, `*replace_editor*` — `/home/mjakl/Projects/pi-web/lib/tool-names.ts`), only when a **non-error result exists**, path from `file_path ?? path`, resolved with `resolveLocalFilePath` (filesystem semantics, not URL), deduped, first-seen order. Prose paths are never scanned.
- Collected per turn over all assistant blocks up to and including the final assistant message (`ChatWindow.tsx:863`-`869`), attached to the final answer only (`:1434`).
- `TurnWrittenFiles` (`/home/mjakl/Projects/pi-web/components/TurnWrittenFiles.tsx`): wrapping row of chips (file-type icon + basename, `title` = full path), `aria-label="Files changed"`, each button calls `onOpenFile(filePath)`.

### 8.2 Retry (`auto_retry_*`)
`auto_retry_start` → `retryInfo = {attempt, maxAttempts, errorMessage}`; `auto_retry_end`, `agent_end` and settlement clear it (`useAgentSession.ts:1919`-`1928`, `:1697`, `:1351`). Rendered above the composer as an amber banner `Retrying ({attempt}/{max})…` plus a dimmed `— {errorMessage}` (`ChatInput.tsx:1904`-`1942`).

### 8.3 Compaction status
- `compaction_start` → `isCompacting=true`, clears previous error/result; `compaction_end` → clears the flag, sets `compactError` or `compactResult` (skipped when aborted) and refreshes context usage + transcript (`useAgentSession.ts:1929`-`1955`).
- Green success banner text: `{Reason|Compacted} {before} -> {after} tokens ({saved} saved)` (`ChatInput.tsx:1725`-`1732`, rendered `:1944`-`1974`); error banner is a red `role="alert"` mono block (`:1975`-`1993`).
- `CompactButton` (`/home/mjakl/Projects/pi-web/components/CompactButton.tsx`) lives in the AppShell top bar (`AppShell.tsx:2061`, `:2099`); it renders nothing without a control, shows a stop-square while compacting, carries `data-compacting`/`data-warning` attributes, and is disabled while loading/error/readOnly/busy (`ChatWindow.tsx:507`-`530`).
- Reconciliation mirrors `isCompacting` from `/api/agent/{id}` so a missed `compaction_end` cannot strand the Stop button (`useAgentSession.ts:1612`-`1614`).

### 8.4 `prompt_error` / `extension_error`
Both become error notices: `prompt_error` uses `event.errorMessage` or “command failed”; `extension_error` uses `event.error` or “extension command failed” (`useAgentSession.ts:1790`-`1804`).

### 8.5 Notice/toast queue
- Reducer `/home/mjakl/Projects/pi-web/lib/notice-queue.ts`: `MAX_NOTICES = 5`; adding while full (or while one is exiting) queues into `pending` and marks the oldest non-exiting notice `exiting`; `remove` drains `pending` into `visible` and, if items remain queued, immediately marks the next oldest exiting (`:20`-`72`).
- Timing (`useAgentSession.ts:3074`-`3120`): visible 5000 ms, exit animation 180 ms; a true pause/resume — hovering or focusing a toast (`setNoticePaused`) freezes the countdown and the remaining time is carried over, not reset.
- `NoticeShelf` (`ChatWindow.tsx:1574`-`1689`) renders inside `.chat-notices` (absolute, top 12px, right of the rail, `pointer-events:none` wrapper; `globals.css:1639`-`1649`). Each toast: right-anchored, `width:fit-content`, `max-width:min(100%,620px)`, min height 60, `max-height:500` with the text area capped at 470 and scrolling, `white-space:pre-line`, a 7px type dot (`error→--danger`, `warning→--warning`, `success→--success`, else `--accent`), `role="alert"` for errors else `status`, and in/out keyframe animations.

### 8.6 Branch sync notice
While a branch/navigate action is pending, the composer shows `Loading branch history. Sending is paused.`; on failure it becomes an `alert` with a **Retry** button calling `retryBranchContext` (`ChatWindow.tsx:1535`-`1559`; handler `useAgentSession.ts:2268`-`2327`). Submission is disabled while `branchStatus !== null` (`:1023`).

---

## 9. Streaming display

- Stream state is a reducer over `message_start`/`message_update` deltas (`/home/mjakl/Projects/pi-web/lib/streaming-message.ts:129`), published at most every **50 ms** for `*_delta` events; starts, snapshots, block ends and settlement flush immediately (`/home/mjakl/Projects/pi-web/hooks/useStreamingState.ts:170`-`192`).
- The in-progress message renders as an extra `MessageView isStreaming` **after** the whole transcript, only when there is streaming content (`ChatWindow.tsx:1462`-`1474`). It has no entryId, so no star, actions, timestamp or copy button.
- Header during a turn shows the model name, the **estimated token count** and **tokens/sec**:
  - estimate = 1 token per CJK char + ¼ token per other char, incrementally extended per delta with a surrogate-pair correction (`MessageView.tsx:54`-`110`, `:744`-`763`);
  - `StreamingSpeed` samples every 300 ms and only reports after 0.5 s of elapsed time, formatted `x.x t/s` (`:1162`-`1193`).
- While no content has streamed yet, a pulsing activity line renders instead (`ChatWindow.tsx:1476`-`1485`; `.chat-activity-label` pulses, `globals.css:1666`-`1668`). Labels from `phaseLabel` (`ChatWindow.tsx:114`-`137`): `Running {name}... {progress}` for the latest tool with progress, `Running {name}...` for one tool, `Running a, b, c...` for ≤3, `Running a, b (+N)...` beyond that, `Running command...` for shell phases, and nothing for `waiting_model`.
- Tool progress text comes from `getToolExecutionProgress` (`/home/mjakl/Projects/pi-web/lib/tool-execution-progress.ts`): last non-blank line of the partial result's text blocks, whitespace collapsed, capped at **500 chars** with a leading `...` when truncated.
- Phases: `agent_start`/`connected` → `waiting_model`; `tool_execution_start/update/end` maintain a `running_tools` list; `message_end` returns to `waiting_model` (`useAgentSession.ts:1859`-`1911`, `:1863`).
- Local bash: `bashRunning && !pendingBash` shows `Running command...`; `pendingBash` renders a live `bashExecution` message with empty output (`ChatWindow.tsx:1487`-`1505`).
- Steer / follow-up queue: rendered **in the composer, not the transcript** — a bordered `Queued · N` panel with one row per message tagged `steer` (accent border) or `follow-up`, single-line ellipsised with the full text as `title`, plus a **Recall** button that pulls them all back into the input (`ChatInput.tsx:1809`-`1902`, row component `:486`-`529`). Queue state comes from `queue_update` events and agent-state reads (`useAgentSession.ts:1913`-`1918`).
- Streamed tool calls show `Generating parameters...` and the raw partial JSON until `toolcall_end` (`streaming-message.ts:87`-`123`; `normalizeStreamingToolCalls` also accepts `partialJson`/`partialArgs`/`customInput.property` shapes, `/home/mjakl/Projects/pi-web/lib/normalize.ts:4`-`20`).
- During streaming, code fences render unhighlighted, mermaid preview is disabled, and text goes through `useDeferredValue` (§2.2, §3.4, §3.6).

---

## 10. Constant reference

| Constant | Value | Location |
|---|---|---|
| Markdown guard | 100 000 chars | `SafeMarkdownBody.tsx:10` |
| Tool preview | 120 chars | `MessageView.tsx:2376` |
| Custom-message preview | 140 chars | `MessageView.tsx:2359` |
| Rail preview | 100 chars (99 + `…`) | `message-preview.ts:23` |
| Tool progress | 500 chars | `tool-execution-progress.ts:3` |
| Result `<pre>` height | 400 px | `MessageView.tsx:1901` |
| Split diff / flat patch height | 560 / 520 px | `MessageView.tsx:1573`, `:1742` |
| Custom details height | 360 px | `MessageView.tsx:2304` |
| Thinking cache | 100 entries | `MessageView.tsx:112` |
| Copy “Copied” state | 1500 ms | `MessageView.tsx:418`, `MermaidBlock.tsx:350` |
| Stream publish interval | 50 ms | `useStreamingState.ts:184` |
| t/s sample / min elapsed | 300 ms / 0.5 s | `MessageView.tsx:1168`, `:1173` |
| Tail default / max | 50 / 1000 | `chat-lazy-load.ts:6`-`7` |
| Tail tolerance | 8 px | `chat-lazy-load.ts:18` |
| Rail measure throttle / anchor debounce | 150 ms / 50 ms | `ChatMinimap.tsx:289`, `:390` |
| Rail active lock | 1600 ms | `ChatMinimap.tsx:52` |
| Rail geometry | 36 / 36 / 5 / 50 / 12 / 30 | `ChatMinimap.tsx:46`-`55` |
| Popover delay | 180 ms | `MessagePreviewPopover.tsx:25` |
| Notices | 5 visible, 5000 ms, 180 ms exit | `notice-queue.ts:20`, `useAgentSession.ts:204`, `:208` |
| Notice sizes | 500 / 470 px, ≤620 px wide | `ChatWindow.tsx:1571`-`1572`, `:1638` |
| Widget default expand / pulse | ≤3 lines / 1100 ms | `ExtensionWidgets.tsx:8`-`9` |
| Mermaid zoom | 0.25 step, 0.5–3 | `MermaidBlock.tsx:25`-`27` |
| Tool-result image limit | 10 MB, 6 MIMEs | `tool-result-images.ts:1`-`10` |
| Input history | last 50 distinct user texts | `ChatWindow.tsx:711`-`723` |

---

## 11. Gaps vs the brief

- **`hideThinkingBlock` does not exist** in this repo (no setting, no prop, no storage key). Thinking blocks are always collapsed-by-default and expandable; the only related mechanisms are server-side `deferThinking` and the no-op `setHiddenThinkingLabel` bridge method.
- **`setFooter` is a no-op** (`extension-ui-bridge.ts:702`); there is no footer widget channel. Widget placement is only `aboveEditor` / `belowEditor`, and both currently render in the same shelf below the composer — placement only changes the chip's triangle glyph and label.
- **"Edit and resend"** is not a separate action: it is the "New branch" history action, which truncates at the entry and restores its text + images into the composer.
- Tool-call ANSI: bash output is rendered as plain preformatted text; ANSI conversion is confined to extension widgets, the extension status line and the extension custom panel.