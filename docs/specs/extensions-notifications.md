# Extension UI Bridge, Web Push, and Runtime Spec — pi-web

> Extracted from /home/mjakl/Projects/pi-web on 2026-09-10; describes pi-web behaviour, not web-pi's design.

Source: `/home/mjakl/Projects/pi-web`. Read-only research; no files in either repository were modified while compiling this document.

---

## 1. Extension UI bridge

### 1.1 Architecture / transport

- `lib/extension-ui-bridge.ts` — `ExtensionUiBridge` class (one instance per live session, constructed in `lib/rpc-manager.ts:155` as `new ExtensionUiBridge((event) => this.emit(event))`) implements the SDK's `ExtensionUiContextLike` (`lib/pi-types.ts:107-159`) headlessly — no real terminal exists; every UI call becomes an `extension_ui_request` event routed to the browser.
- Server→browser transport: SSE stream `GET /api/agent/[id]/events` (`app/api/agent/[id]/events/route.ts:11-44`), built by `createAgentEventStream` (`lib/agent-event-stream.ts`), wrapping `AgentSessionWrapper.onEvent`. Every `AgentEvent` the bridge emits (`extension_ui_request`, `extension_error`) rides this stream verbatim.
- Browser→server transport: `POST /api/agent/[id]` (`app/api/agent/[id]/route.ts:12-56`) with JSON body `{type, ...}`, routed into `AgentSessionWrapper.sendCommand` via `sendRpcSessionCommand`. Two command types matter here: `extension_ui_response` (`lib/rpc-manager.ts:1130-1133`) and `extension_ui_input` (`lib/rpc-manager.ts:1135-1141`). Both are allow-listed during session replacement (`lib/rpc-manager.ts:139-140`), so they still work mid clone/rewind/branch.
- Reconnect replay: `AgentSessionWrapper.onEvent` replays all still-pending UI requests to a newly-attached SSE listener: `for (const event of this.extensionUi.pendingRequests()) listener(event);` (`lib/rpc-manager.ts:487`). `pendingRequests()` returns `[...this.pendingUiRequests.values()]` (`lib/extension-ui-bridge.ts:139-141`). This is how a dialog or custom-UI panel survives a browser reload / tab reattach.

### 1.2 Event shapes (`lib/types.ts:144-242`)

`ExtensionUiRequest` (server→browser) is a discriminated union on `method`, always carrying `type: "extension_ui_request"` and an `id: string` (fresh `randomUUID()` per request):

| method | fields |
|---|---|
| `select` | `title: string; options: string[]; timeout?; expiresAt?` |
| `confirm` | `title: string; message: string; timeout?; expiresAt?` |
| `input` | `title: string; placeholder?: string; timeout?; expiresAt?` |
| `editor` | `title: string; prefill?: string; timeout?; expiresAt?` |
| `notify` | `message: string; notifyType?: "info"\|"warning"\|"error"` |
| `setStatus` | `statusKey: string; statusText?: string` |
| `setWidget` | `widgetKey: string; widgetLines?: string[]; widgetPlacement?: "aboveEditor"\|"belowEditor"` |
| `setTitle` | `title: string` |
| `set_editor_text` | `text: string` (used by both `setEditorText` and `pasteToEditor`) |
| `custom` | `lines: string[]; closed?: boolean` |

`BlockingExtensionUiRequest` = the subset `select|confirm|input|editor|custom` (`lib/types.ts:223-226`) — these are the ones that can trigger an attention notification (§2.9).

`ExtensionUiResponse` (browser→server, `lib/types.ts:228-231`): `{type:"extension_ui_response", id, value:string} | {..., confirmed:boolean} | {..., cancelled:true}` — a 3-way union with no explicit "method" field; the bridge infers meaning from which key is present (`"value" in response`, `"confirmed" in response`).

`extension_ui_input` command body (browser→server, ad hoc, not a typed union in `types.ts`): `{type:"extension_ui_input", id: string, data: string}` (`lib/rpc-manager.ts:1136-1139`, sent by the client at `hooks/useAgentSession.ts:1111-1115`).

### 1.3 Blocking dialogs: select / confirm / input / editor

All four share one implementation, `ExtensionUiBridge.requestExtensionUi` (`lib/extension-ui-bridge.ts:538-588`), wired per-method in `createUiContext()` (`lib/extension-ui-bridge.ts:590-643`):

- A new `id = randomUUID()` is minted per call. The full request (method + title + method-specific fields + `timeout`/`expiresAt` if the extension passed a timeout) is stored in `pendingUiRequests`, and a resolver/canceller pair in `pendingUiResponses`, then emitted.
- **Timeout**: only applied if the extension passed `opts.timeout` (SDK-level `DialogOptionsLike`, `lib/pi-types.ts:98-101`) — pi-web sets no default timeout. If set, `expiresAt = Date.now() + timeout` is included in the emitted event and a `setTimeout` resolves the promise with the method's default value (`undefined` for select/input/editor, `false` for confirm) when it fires (`lib/extension-ui-bridge.ts:571-574`).
- **Abort signal**: if the extension passed an `AbortSignal` and it's already aborted, the promise resolves immediately with the default, no event emitted (`:545`); otherwise an `abort` listener settles it the same way later (`:567-569, 575`).
- **Session stop**: `ExtensionUiBridge.dispose()` (`:150-158`), called from `AgentSessionWrapper.destroy()` (`lib/rpc-manager.ts:1218`, itself invoked from `shutdown()`), calls `pending.cancel()` for every still-pending response, settling each with its method's default value. No explicit event tells the browser the dialog is gone — it only learns via `session_stopped`/connection teardown.
- **A second dialog arrives before the first is answered**: server-side there is no collision — both stay independently pending in the `Map`s, keyed by distinct `id`s. Client-side there is exactly one state slot: `hooks/useAgentSession.ts:1290-1300` (`handleExtensionUiRequest`) does `setExtensionDialog(request)` unconditionally for `select|confirm|input|editor`, so a second request **silently replaces** the on-screen dialog for the first. The first request's server-side promise is **not** cancelled — it stays pending and only resolves via its own timeout, session stop, or (no longer possible from the UI) a late response with its `id`. Only the most recently emitted blocking dialog is ever shown; earlier ones are effectively stuck until timeout/dispose.
- **Cancellation**: Escape or the dialog's Cancel button both call `onRespond(request, {cancelled:true})` (`components/ChatWindow.tsx:1741-1747, 1896-1899`), POSTed as `extension_ui_response` with `cancelled:true`. The bridge's parser for select/input/editor is `"value" in response ? response.value : undefined`; a cancelled response has no `value` key so it resolves `undefined`. Confirm's parser is `"confirmed" in response ? response.confirmed : false`, so cancel resolves `false`. There is no separate "cancelled" signal surfaced to the extension — cancel and "closed with no answer" are indistinguishable from an empty response.
- **Answering resets the dialog slot** only if its `id` still matches the one being answered (`hooks/useAgentSession.ts:1089-1091`), guarding a stale close racing a newer dialog.
- Native `<dialog>` via `showModal()` gives backdrop/focus-trap/top-layer/focus-restoration for free (`components/ChatWindow.tsx:1719-1726`); its native `cancel` event is preempted with `event.preventDefault()` so only the explicit key handler drives cancellation (`:1748-1750`).
- **select**: `options: string[]` rendered as one full-width button per option (`:1807-1831`); clicking sends `{value: option}` directly — no confirm step, no default/initial highlighted option.
- **confirm**: renders `message` as pre-wrapped text; only choices are Confirm (`{confirmed:true}`) or Cancel (`{cancelled:true}` → resolves `false`); Enter is not wired to confirm.
- **input**: single-line `<input>`, `placeholder` from the request, autofocused, Enter submits `{value}` (`:1833-1854`). No validation of any kind — any string (including empty) is sent as-is.
- **editor**: multi-line `<textarea>` seeded from `prefill` (`useState` initialized from `request.prefill ?? ""`, reset via `useEffect` keyed on `request`, `:1708-1714`); Ctrl/Cmd+Enter submits `{value}` (`:1863-1866`). This is an in-page textarea, not a real external editor — no file is opened or written.

### 1.4 `notify`

`createUiContext().notify` (`lib/extension-ui-bridge.ts:644-652`) fires-and-forgets an `extension_ui_request` with `method:"notify", message, notifyType`. No response is awaited (not tracked in `pendingUiRequests`/`pendingUiResponses` — the one request type not replayed on reconnect). Client (`hooks/useAgentSession.ts:1301-1308`): mapped into the app's notice/toast system via `addNotice({id: request.id, message, type: request.notifyType ?? "info"})`. `notifyType` (`"info"|"warning"|"error"`, optional) becomes the notice's `type` — no separate "success" level. Notices are ephemeral UI state, not persisted to the session transcript or any file; display lifetime/dismissal is owned by the generic notice component, not this bridge.

### 1.5 `setStatus`

`lib/extension-ui-bridge.ts:654-664`. Server keeps authoritative state in `extensionStatuses: Map<key,text>` (cleared entirely by `resetForReload()`, `:144-147`); `text === undefined` deletes the key, otherwise sets it. Every call also emits `{method:"setStatus", statusKey, statusText}` regardless of add/remove. Snapshot getter `statuses()` returns `ExtensionStatusItem[]` (`{key,text}`, `lib/types.ts:233-236`) and is also embedded directly in the `get_state` RPC response (`extensionStatuses: this.extensionUi.statuses()`, `lib/rpc-manager.ts:785`) for cold-load without waiting on SSE replay. Client keeps a parallel array, filtering out the old entry for that key then re-adding if `statusText !== undefined` (`hooks/useAgentSession.ts:1309-1316`).

Rendering (`components/ExtensionStatusBar.tsx`): all active statuses sorted by key (`localeCompare`, `en` locale) and joined with a single space into one line (`formatExtensionStatusLine`, lines 17-24), rendered through `AnsiText` (ANSI SGR → HTML via the `ansi_up` library, which also HTML-escapes so status text can't inject markup, `components/AnsiText.tsx:17-19`), with `role="status"` (screen-reader announcement) and a plain-text `title`/`aria-label` fallback (`sanitizeExtensionStatusText` collapses whitespace/tabs first). Not auto-cleared by any timer — only explicit `setStatus(key, undefined)` or `resetForReload()`/session dispose removes it.

### 1.6 `setWidget`

Two distinct APIs share one method, both keyed by `widgetKey` and with `placement: "aboveEditor"|"belowEditor"` (default `"aboveEditor"`):

1. **Static**: `content` is a `string[]` (or `undefined` to clear). Handled directly in `createUiContext().setWidget` (`lib/extension-ui-bridge.ts:669-701`): stores into `extensionWidgets` and emits `setWidget` with `widgetLines: content`.
2. **Factory (reactive) widgets**: `content` is a function. Routed to `setExtensionWidgetFactory` (`:333-385`), which builds a private headless `pi-tui` terminal (`createHeadlessCustomUiTui`, width fixed at `DEFAULT_CUSTOM_UI_COLUMNS = 92`, `lib/custom-ui-terminal.ts:1`) whose `requestRender` callback re-renders the component and re-emits `setWidget` whenever the factory's component calls it. Rendering pulls `component.render(92)`, which must return `string[]` or the widget is torn down with an `extension_error` (`event:"setWidget"`, `extensionPath: "extension-widget:<key>"`) plus a `setWidget` clear (`failExtensionWidget`, lines 249-277). A **generation counter per key** (`extensionWidgetGenerations`) guards against races: replacing a widget bumps the generation so any async render/error from a superseded factory instance is a no-op (checked at lines 213, 256, 270, 280-284, 310-314, 341, 354).

Lifecycle: `resetForReload()` disposes all active factory-widget components and clears the static-widget snapshot map (`resetExtensionWidgetsForReload`, `:227-238`), invoked from the `"reload"` RPC command (`lib/rpc-manager.ts:1117`) and from `commandContextActions.reload` (`:1320`). `dispose()` (session stop) clears everything, calling component `dispose()` hooks without re-emitting individual clears per widget (`:157, 219-225`, `emitClear=false`). Snapshot getter `widgets()` → `ExtensionWidgetItem[]` (`{key, lines, placement}`), also embedded in `get_state`'s `extensionWidgets` (`lib/rpc-manager.ts:786`).

Client mirrors the same replace-by-key pattern (`hooks/useAgentSession.ts:1317-1331`): a `setWidget` with truthy `widgetLines` upserts, falsy removes.

Rendering (`components/ExtensionWidgets.tsx`): widgets render as a row of small pill "triggers" (icon shows ▲/▼ for above/below-editor placement, lines 190-213); clicking toggles one widget's content open in an `expandedWidgetKey`-controlled panel above the trigger row (only one widget expanded at a time, `getNextExpandedWidgetKey`, lines 48-53). A widget auto-opens by default only if it has 2–3 lines (`DEFAULT_EXPANDED_WIDGET_LINES = 3`, `getDefaultExpandedWidgetKey`, lines 37-46) — computed once from initial state, not re-applied on later updates. Widget content changes pulse the trigger (`is-updating` class) for `WIDGET_UPDATE_IDLE_MS = 1100` ms after any line changes (`getUpdatedExtensionWidgetKeys`, lines 21-34), then the pulse clears via `setTimeout`. Content is `lines.join("\n")` through `AnsiText` inside a `<pre>` (raw ANSI rendered, HTML-escaped).

### 1.7 `custom()` — headless pi-tui terminal

Implementation: `requestExtensionCustomUi` (`lib/extension-ui-bridge.ts:459-536`), invoked from `createUiContext().custom` (`:712-713`).

- **Width**: resolved once per call via `getCustomUiWidth` (`:387-402`) from the SDK options' `overlayOptions` (function or object) `.width`, clamped to `[40,140]` if numeric, else falls back to a literal `92` (differs from the `DEFAULT_CUSTOM_UI_COLUMNS` constant used for widgets, but coincides at the same value). Height is fixed at `DEFAULT_CUSTOM_UI_ROWS = 40` inside `createHeadlessCustomUiTui` (`lib/custom-ui-terminal.ts:1-2, 15-27`), though pi-web's client never uses `rows` — no scroll-region/paging logic client-side, it just renders whatever `lines` array comes back.
- **Startup**: the SDK's `factory` function is called as `factory(tui, PLAIN_TEXT_THEME, CUSTOM_UI_KEYBINDINGS, done)` (`:487-495`) — a headless `HeadlessCustomUiTui` (`{terminal:{columns,rows,kittyProtocolActive:false}, requestRender}`), a no-op-styled `Theme` subclass (`PlainTextTheme`, `:67-114` — every `fg/bg/bold/italic/underline/inverse/strikethrough` returns the input text unchanged; `getFgAnsi/getBgAnsi` return `""`), the app's real `TuiKeybindingsManager` built from `TUI_KEYBINDINGS` defaults (so key-chord semantics match a normal Pi terminal UI), and a `done(value)` callback the component can call itself to finish.
- If the factory doesn't return an object with a `render` function, the call resolves immediately with `undefined` — no event ever emitted (`:506-512`).
- **Frame format sent to the browser**: an `extension_ui_request` with `method:"custom", lines: string[]` — the entire rendered frame every time, produced by `component.render(width)` (`emitCustomUiRender`, `:404-419`). If `render` throws, `lines` becomes a single-element array with the error text (`Extension custom UI render failed: <message>`) rather than failing the request. Frames are plain strings that may contain ANSI SGR escapes and Pi's own cursor marker (`\x1B_pi:c\x07`, stripped client-side) — not HTML, not a diff, always a full re-render.
- **Re-render trigger**: the component calls `tui.requestRender()`, which re-invokes `emitCustomUiRender` for the still-active custom UI (`:470-473`).
- **Keyboard input forwarding**: browser keystrokes go through `toTerminalKeyData` (`lib/terminal-input.ts:39-59`), converting a DOM `KeyboardEvent`-like `{key, altKey, ctrlKey, metaKey, shiftKey}` into a raw terminal byte sequence: arrow keys/Home/End/Insert/Delete/PageUp/PageDown/Escape/Backspace map to their VT sequences (`SPECIAL_KEY_SEQUENCES`); Ctrl+letter (A–_) maps to the legacy control byte (`code & 0x1f`), Ctrl+`?`→DEL; Alt+key maps to ESC-prefixed sequences (`ALT_ARROW_SEQUENCES` for arrows, `\x1b\x7f` for Alt+Backspace, else `\x1b<key>` for single chars); Enter→`\r` (or `\n` with Shift); Tab→`\t` (or `\x1b[Z` with Shift); Cmd/Meta-held keys and Ctrl+V are suppressed (return `null`, so browser paste/OS shortcuts pass through natively). Plain typed characters arrive through the hidden `<textarea>`'s native `onInput` event instead (not `onKeyDown`), so they never go through `toTerminalKeyData` — raw typed text is sent verbatim as `data`. IME composition is buffered until `compositionend` before being sent (`components/ChatWindow.tsx:2019-2036`). Paste is intercepted and wrapped in a bracketed-paste sequence `\x1b[200~<text>\x1b[201~` (`lib/terminal-input.ts:62-64`, used at `components/ChatWindow.tsx:2037-2041`) so multi-char pastes are distinguishable from typed input at the terminal-parser level.
- Every keystroke/paste is its own `extension_ui_input` POST: `{type:"extension_ui_input", id: request.id, data}` (`sendExtensionCustomInput`, `hooks/useAgentSession.ts:1106-1121`) → server `ExtensionUiBridge.handleInput(id, data)` (`lib/extension-ui-bridge.ts:442-457`): looks up the active custom UI by `id`, calls `component.handleInput?.(data)`, and if still active afterward, immediately re-renders and emits a fresh frame. If `handleInput` throws, the custom UI is closed (resolved `undefined`) and an `extension_error` (`event:"custom_ui_input"`) is emitted.
- **Client-side display**: `<textarea>` is visually hidden (1×1px, `opacity:0`, `pointer-events:none`) — the actual display is a `<pre>` showing `normalizeCustomPanelLines(request.lines).join("\n")` through `AnsiText` (`components/ChatWindow.tsx:2082-2097`). `normalizeCustomPanelLines` (`lib/ansi.ts:63-99`) strips ANSI only for structural detection, not display: drops full-width box-drawing frame border lines (`┌─...─┐` style), trims a single leading/trailing `│`/`┃` column border plus one adjacent space from each remaining line, trims trailing spaces, and trims leading/trailing fully-blank lines — i.e. unwraps a bordered TUI panel into borderless plain content so the browser's own `<dialog>` chrome supplies the border. Falls back to raw `lines` unchanged if nothing looks like content.
- **Close button**: sends synthetic input `\x03` (Ctrl+C) rather than any special "close" command — relies on the extension's own component reacting to Ctrl+C and calling `done()` (`components/ChatWindow.tsx:2065-2080`).
- **End of custom UI**: `closeCustomUi(id, value)` (`:421-440`) — called either when the component's own `done()` callback fires, or from `dispose()` on session stop (`value: undefined`). Disposes the component (`component.dispose?.()`), removes it from tracking maps, and emits one final `extension_ui_request` with `method:"custom", lines: [], closed: true`. Client clears `extensionCustomUi` only if the id still matches the currently-shown one (`hooks/useAgentSession.ts:1338-1344`) — same stale-close guard as dialogs.
- **Collision behaviour**: identical to blocking dialogs — one client-side `extensionCustomUi` state slot; a new non-closed `custom` request unconditionally replaces whatever was shown (`:1339-1343`). Multiple concurrent custom UIs can exist server-side (keyed by `id` in `activeCustomUis`); only the latest is visible.

### 1.8 `setTitle`

`lib/extension-ui-bridge.ts:704-711` emits `{method:"setTitle", title}`. Client: `if (request.title) document.title = request.title;` (`hooks/useAgentSession.ts:1332-1334`) — directly sets the browser tab title; an empty/falsy title is ignored and the prior title stays (no explicit reset behavior).

### 1.9 `setEditorText` / `getEditorText` / `pasteToEditor`

Both `setEditorText(text)` and `pasteToEditor(text)` emit the **same** event: `{method:"set_editor_text", text}` (`lib/extension-ui-bridge.ts:714-729`) — pi-web does not distinguish "replace" from "paste-at-cursor" at the protocol level. Client: `opts.chatInputRef?.current?.insertText(request.text)` (`hooks/useAgentSession.ts:1335-1336`) → `ChatInput.insertText` (`components/ChatInput.tsx:889-909`): inserts at the current cursor selection (`selectionStart`/`selectionEnd`), replacing any selected text, prefixing a single space separator if the text before the cursor is non-empty and doesn't already end in a space, then moves the caret to just after the inserted text and refocuses. If the textarea ref isn't mounted, falls back to appending to internal `value` state with a space separator. This is always an *insert*, never a full replace, despite the SDK method name `setEditorText`. `getEditorText()` is a hard stub returning `""` unconditionally (`:730`) — extensions can never read back the browser's current input box content.

### 1.10 `addAutocompleteProvider`

Hard no-op: `addAutocompleteProvider: () => {}` (`:731`). Extensions calling this get no error, but no autocomplete is ever registered or triggered — no request/response shape exists because nothing is wired.

### 1.11 Theme (`theme` / `getAllThemes` / `getTheme` / `setTheme`)

All stubbed, not connected to pi-web's real CSS theming:
- `theme` getter always returns the single `PLAIN_TEXT_THEME` instance (`:734-736`).
- `getAllThemes()` → `[]` (`:737`).
- `getTheme(name)` → `undefined` (`:738`).
- `setTheme(theme)` → always `{success: false, error: "Theme switching is not supported in Pi Web extension UI yet"}` (`:739-742`) — a literal rejection, not silently ignored.

### 1.12 `setToolsExpanded` / `getToolsExpanded`

Both stubs: `getToolsExpanded: () => false`, `setToolsExpanded: () => {}` (`:743-744`) — extensions cannot control or observe any "tools expanded" UI state in pi-web.

### 1.13 `resetForReload()`

`lib/extension-ui-bridge.ts:144-147`: clears `extensionStatuses` entirely and calls `resetExtensionWidgetsForReload()` (disposes active factory widgets, clears the static-widget snapshot map — §1.6). Does **not** touch `pendingUiRequests`/`pendingUiResponses` (in-flight dialogs) or `activeCustomUis` — those survive a reload. Called from the `"reload"` RPC command handler (`lib/rpc-manager.ts:1115-1122`, before `this.inner.reload()`) and from `commandContextActions.reload` (`:1319-1330`, used when an extension itself triggers a reload — this path also re-registers a fresh `uiContext` via `beforeSessionStart`, since the reload rebuilds the extension runner).

### 1.14 Other stubs on the interface

`onTerminalInput()` returns a no-op unsubscribe function and never forwards raw terminal input to a listener (`:653`) — keystroke delivery to extensions only happens through the `custom()` UI's `handleInput`, not this hook. `setWorkingMessage`, `setWorkingVisible`, `setWorkingIndicator`, `setHiddenThinkingLabel`, `setFooter`, `setHeader`, `setEditorComponent`, `getEditorComponent` are all no-ops / stub returns (`:665-668, 702-703, 732-733`) — none ever emit an event or affect the browser UI.

### 1.15 `bindExtensions` and its bindings (`lib/rpc-manager.ts:261-332, 1307-1332`)

Called once per session lazily, on first need (`ensureExtensionsBound`, memoized via `extensionBindingPromise`), with:

```
uiContext: this.extensionUi.createUiContext(),
mode: "rpc",
commandContextActions: this.createExtensionCommandContextActions(),
shutdownHandler: () => { ...emits a warning notify... },
onError: (error) => { ...emits extension_error... },
```

- **`mode: "rpc"`** — the SDK's dispatch/formatting mode; pi-web is not `"tui"`, `"json"`, or `"print"`.
- **`commandContextActions`** (`createExtensionCommandContextActions`, `lib/rpc-manager.ts:1307-1332`), each action is what an extension-registered slash command's execution context can call:
  - `waitForIdle()` → `this.inner.agent.waitForIdle()` — passthrough to the SDK agent's own idle-wait.
  - `newSession()` → always `Promise.resolve({cancelled:true})` — extensions cannot create a new session from within pi-web's RPC mode.
  - `fork()` → same, always `{cancelled:true}` — forking via this path is unsupported (pi-web has its own fork UI/endpoint outside the extension bridge).
  - `navigateTree(targetId, options)` → real implementation: calls `this.inner.navigateTree(targetId, {summarize: options?.summarize})` and returns `{cancelled: result.cancelled}` — the one command-context action that actually does something.
  - `switchSession()` → always `Promise.resolve({cancelled:true})` — stubbed.
  - `reload()` → real: calls `this.extensionUi.resetForReload()`, syncs project trust (`syncProjectTrust()`), then `this.inner.reload({beforeSessionStart: () => this.inner.extensionRunner.setUIContext(this.extensionUi.createUiContext(), "rpc")})` — rebuilds the UI context fresh so a reload doesn't leave the extension pointed at a stale bridge instance.
- **`shutdownHandler`** — invoked if an extension calls the SDK's session-shutdown request. pi-web does not support this: it emits a `notify`-style warning (`extension_ui_request`, `method:"notify", notifyType:"warning", message:"Extension requested shutdown, but shutdown is not supported in Pi Web."`) — the session is **not** actually shut down.
- **`onError`** — any error the SDK's extension runner reports (e.g. an extension command/hook throwing) is forwarded verbatim as an `extension_error` event: `{type:"extension_error", extensionPath: error.extensionPath, event: error.event, error: error.error}` (`lib/rpc-manager.ts:294-301`). Client display (`hooks/useAgentSession.ts:1798-1804`): added as an error-type notice, `message: event.error ?? t("chat.extensionCommandFailed")` (localized fallback if the error message is empty). The same `extension_error` shape is also used internally by the bridge for widget/custom-UI failures (`extensionPath` values like `"extension-widget:<key>"` or `"custom-ui:<id>"`, `event` values like `"setWidget"`, `"custom_ui"`, `"custom_ui_input"`) — synthetic, not from the SDK's real extension runner, but delivered and displayed identically.

### 1.16 Cross-cutting: "attention needed" notification hook-in

Not part of the bridge itself, but the one place it's consumed for notifications: `isBlockingExtensionUiRequest` (`lib/browser-notifications.ts:45-59`, true for `select|confirm|input|editor` and for `custom` when not `closed`) gates `hooks/useAgentSession.ts:1290-1292`'s call to `onAttentionNeeded?.(request)`, wired in `components/AppShell.tsx:886-908` (`handleAttentionNeeded`): fires only when the tab isn't visible/focused (`shouldShowBrowserNotification()`, §2.7), deduped per request id via `claimExtensionAttentionNotification`/`notifiedAttentionRequestIdsRef`, delivering a notification titled `i18n.attentionNeeded` with body = the dialog's `title` (or `i18n.extensionInputNeeded` for `custom`), tagged `pi-extension-ui:<request.id>`. (Full push/notification delivery mechanics are §2.) Separately, opening any blocking dialog (first time its `id` is seen) plays the app's "done" sound once per dialog id (`soundedExtensionDialogIdRef`, `components/ChatWindow.tsx:532-540`) — the same sound used for task-completion (§2.8/§2.9).

### 1.17 File map for this section

`lib/extension-ui-bridge.ts` (747 lines, full bridge implementation), `lib/custom-ui-terminal.ts` (27 lines, headless TUI shim + size constants), `lib/terminal-input.ts` (64 lines, key-event→VT-sequence mapping), `lib/ansi.ts` (ANSI stripping + panel-border normalization), `components/AnsiText.tsx` (ANSI→HTML via `ansi_up`), `components/ExtensionStatusBar.tsx`, `components/ExtensionWidgets.tsx`, `components/ChatWindow.tsx` (dialog/custom-panel rendering, ~1690-2100), `hooks/useAgentSession.ts` (client-side event handling, ~100-125, 1080-1350, 1790-1804, 1953-1963, 3174-3178), `lib/rpc-manager.ts` (`AgentSessionWrapper`: bridge wiring 153-332, command dispatch 1130-1141, destroy/dispose 1206-1250, `commandContextActions` 1307-1332), `lib/pi-types.ts:98-159` (`ExtensionUiContextLike` interface as pi-web must satisfy it), `lib/types.ts:144-242` (wire-level event/response types), `app/api/agent/[id]/route.ts` (command POST), `app/api/agent/[id]/events/route.ts` (SSE GET), `lib/browser-notifications.ts` (attention-notification gating consumed by this bridge's blocking requests).

---

## 2. Web push and notifications

### 2.1 `lib/web-push.ts` — state file

`stateFilePath()` (`:39-41`): `join(getAgentDir(), "web-push.json")` — lives in the Pi agent state dir (`~/.pi/agent` or `PI_CODING_AGENT_DIR`), not the repo. Written via `writePrivateFileAtomicSync` (`lib/atomic-file.ts:9-37`): temp file `writeFileSync` with `flag: "wx", mode: 0o600`, then `renameSync` — atomic, owner-only-readable.

Shape (`PushStateFile`, `:16-19`):

```json
{
  "vapidKeys": { "publicKey": "...", "privateKey": "..." },
  "subscriptions": [
    { "endpoint": "https://...", "keys": { "p256dh": "...", "auth": "..." }, "locale": "optional, legacy, unused" }
  ]
}
```

`PushSubscriptionRecord.locale` (`:13`) is optional and legacy. Git history (commit `4c79281`, "Make Pi Web English-only") shows it used to be required and a `localeText(locale, key)` helper picked `zh-CN` vs `en` message strings; that helper and the `zh-CN` import were deleted, `locale` was demoted to optional but the field itself was **not removed** from the type or from stored/incoming subscriptions — it is simply never read anywhere anymore (confirmed: no other reference to `.locale` in the codebase).

### 2.2 VAPID keys

Generated lazily on first use inside `createWebPushNotifier` (`:96-101`) — if `loadState()` returns null or missing key fields, calls `environment.generateVapidKeys()` → `webpush.generateVAPIDKeys()` (from the `web-push` npm package, `:72`). The notifier is a lazy singleton via `globalThis.__piWebPushNotifier` (`:152-161`), created once per process. `getVapidPublicKey()` (`:107-110`) **saves state on every call** (persisting newly-generated keys to disk the first time it's read) and returns only the public key; the private key never leaves the server.

### 2.3 Subscription upsert / removal rules

`addSubscription` (`:111-119`): filters out any existing subscription with the same `endpoint`, then appends the new one — dedup/upsert keyed solely on `endpoint` string equality. **No explicit removal/unsubscribe API exists** — the only removal path is `notifySessionComplete`'s failure handling (§2.4).

### 2.4 `notifySessionComplete(sessionId)` (`:120-148`)

- No-op if `state.subscriptions.length === 0`.
- Looks up a session display name via `environment.getSessionName(sessionId)` → `resolveSessionPath` + `readSessionRowMetadata` (best-effort, swallows errors, falls back to `undefined`).
- Payload sent to every subscription (identical payload, JSON-stringified once, `:123-131`):

```json
{
  "title": "<sessionName, or enMessages['i18n.sessionComplete'] ?? 'Session complete'>",
  "body": "<enMessages['i18n.taskFinished'] ?? 'Task finished.'>",
  "url": "/?session=<encodeURIComponent(sessionId)>",
  "tag": "pi-session-complete:<sessionId>"
}
```

- Sends via `webpush.sendNotification({endpoint, keys}, payload, {vapidDetails: {subject: "mailto:pi-web@localhost", publicKey, privateKey}})` (`:45-56`) to each subscription in turn (sequential loop, not `Promise.all`).
- **410/404 handling** (`:133-146`): on send failure, extracts `error.statusCode` (`:86-91`); if `404` or `410`, that subscription is filtered out of `state.subscriptions` and `pruned = true`. Any other error status is silently ignored (subscription kept, no retry, no logging at this layer). State is saved once at the end only if something was pruned.
- Caller (`lib/rpc-manager.ts:1833`) wraps the call in `.catch()` and only `console.error`s failures — never throws up to the SDK.

### 2.5 Server-side trigger (traced to source)

`AgentSessionWrapper` (`lib/rpc-manager.ts`) is constructed with `onAgentRunComplete: (completedSessionId) => void notifySessionComplete(completedSessionId).catch(...)` (`:1830-1839`). Internally:

- On SDK event `agent_start`, sets `this.agentRunNeedsCompletion = true` (`:228`).
- On SDK event `agent_settled`, calls `this.notifyAgentRunCompleteIfIdle()` (`:242`).
- `notifyAgentRunCompleteIfIdle()` (`:247-256`): bails if the wrapper is `_stopping`, if `agentRunNeedsCompletion` is false, or if `this.isRunning()` is still true (`isRunning()` = active AND (pending prompt count > 0 OR streaming OR compacting OR bash running), `:219-225`). Otherwise clears the flag and invokes `onAgentRunComplete(sessionId)`.

Exactly one push per agent run, fired on `agent_settled` only once the session is fully idle (no queued prompt, no stream, no compaction, no bash). This is a **server-side** SDK-event trigger, independent of any browser being connected — it's what lets push work for a fully backgrounded/killed tab (notably iOS PWAs).

### 2.6 Routes

**`GET /api/push/config`** (`app/api/push/config/route.ts:1-10`): no params. Response: `{ "publicKey": "<base64url VAPID public key>" }` (`PushConfigResponse` from `lib/api-types`). No POST handler on this route.

**`POST /api/push/subscribe`** (`app/api/push/subscribe/route.ts:1-47`):
- Request body: `{ "subscription": { "endpoint": "https://...", "keys": { "p256dh": "...", "auth": "..." } } }`.
- Validation (`isValidSubscription`, `:5-22`): `endpoint` must be a string matching `/^https:\/\//`; `keys.p256dh` and `keys.auth` must both be non-empty strings. Fails → `400 { "error": "Invalid push subscription" }`. Malformed JSON body → `400 { "error": "Invalid JSON body" }`.
- On success: strips any extra fields (only `endpoint`/`keys` passed to `addSubscription`; `locale` is never accepted from the client despite being in the type) and upserts (§2.3). Response: `200 { "ok": true }`.
- **No DELETE/unsubscribe route exists** anywhere under `app/api/push/` (only `config/route.ts` and `subscribe/route.ts`). Cleanup is exclusively the 404/410-on-send pruning in `web-push.ts`.

### 2.7 `lib/push-client.ts` (71 lines, full file)

`setupPushSubscription()` (`:31-71`), memoized via a module-level `activeSubscriptionPromise` so concurrent callers share one in-flight attempt:

1. `isPushSupported()` (`:22-29`) checks `serviceWorker in navigator`, `PushManager in window`, `Notification in window`. If unsupported, or `Notification.permission !== "granted"`, returns `false` immediately, no side effects (`:32`).
2. `fetch("/api/push/config")`; if not `.ok` or no `publicKey` in response, returns `false`.
3. `navigator.serviceWorker.getRegistration()` — deliberately not `.ready` (comment `:44-46`: `.ready` never settles if no worker is registered, which would hang the promise forever and "poison every later call"). If no registration or `!registration.active`, returns `false`.
4. Reuses an existing `pushManager.getSubscription()` if present; otherwise calls `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) })` (`:49-53`). `urlBase64ToUint8Array` (`:11-20`) does standard base64url→bytes decoding of the VAPID key.
5. POSTs `{ subscription: subscription.toJSON() }` to `/api/push/subscribe`; returns `response.ok`.
6. On any thrown error anywhere in the flow, returns `false` (`:61-63`).
7. If the overall result is `false`, resets `activeSubscriptionPromise = null` (`:69`) so a later trigger (e.g. next permission grant) retries instead of caching a permanent failure; a `true` result stays cached for the page's lifetime.

Callers (`components/AppShell.tsx`): on mount, if `Notification.permission === "granted"` already (`:104-112`); and again after successfully showing a browser notification when permission was already granted (`:855`) or just newly granted (`:861-862`) — i.e. it opportunistically re-subscribes every time a notification actually fires, not just on load.

### 2.8 `public/sw.js` (159 lines, full file)

**Cache naming**: `STATIC_CACHE = "pi-web-static-<v>"` where `<v>` comes from the `?v=` query param on the SW URL (defaults `"dev"`) — this is how `PwaRegistration.tsx` busts the cache on deploy (§2.9).

**Precache list** (`PRECACHE_URLS`, `:6-12`), added independently (not atomic `addAll` — each `.catch()`'d individually so one failing asset doesn't brick install, `:18-24`):

```
/offline.html
/manifest.webmanifest
/icons/icon-192.png
/icons/icon-512.png
/icons/apple-touch-icon.png
```

`install` calls `self.skipWaiting()` after caching (`:25`). `activate` deletes any `pi-web-*` cache that isn't the current `STATIC_CACHE`, then `self.clients.claim()` (`:29-45`).

**Fetch strategy** (`:47-74`):
- Only handles `GET`; non-GET passes through untouched.
- Cross-origin requests pass through untouched.
- `/api/*` and `/sw.js` itself are **always excluded** — "session data and live agent traffic must always come from the local server" (`:54-55`) — never served from cache.
- Navigation requests (`request.mode === "navigate"`): network-first, falling back to the cached `/offline.html` (or `Response.error()` if missing) on fetch failure (`:57-65`).
- Static assets — `/_next/static/*` or anything literally in `PRECACHE_URLS` — use `cacheFirst` (`:67-73`): serve from cache if present; otherwise `fetch`, and if the response is `ok` and `type === "basic"` (same-origin, not opaque), store a clone in the cache before returning it (`:149-159`).
- Everything else (plain API-adjacent GETs not under `/api/`, other page assets) is not intercepted at all — falls through to normal browser handling.

**`push` event handler** (`:76-103`):
- Parses `event.data.json()` in a try/catch; malformed/missing payload → empty object, handled gracefully.
- Requires `title` and `body` both non-empty strings, else silently returns — no notification shown (`:83-85`).
- **Visibility rule** (`:87-101`): calls `self.clients.matchAll({ type: "window", includeUncontrolled: true })`; if **any** matching window client has `visibilityState === "visible"`, the push handler shows **no system notification at all** — it assumes the in-page notification path (SSE-driven, `browser-notifications.ts`) already handled it and will also play the completion chime. Only when no window is visible (e.g. fully backgrounded iOS PWA) does it call `self.registration.showNotification(title, { body, data: { url: url ?? "/" }, ...(tag && {tag}) })`.

**`notificationclick`** (`:105-147`): closes the notification; parses `event.notification.data.url` (falls back to `/`), constructs an absolute `URL` against `self.location.origin`, and **discards the target if it isn't same-origin** (falls back to `/`, `:108-118`). Then `focusOrOpenWindow(targetUrl)`:
- Lists all window clients; if one's `.url` exactly matches `targetUrl`, tries it first, otherwise tries all clients in `matchAll` order.
- For each candidate: if the URL already matches, just `.focus()`; otherwise `client.navigate(targetUrl)` then `.focus()` on the result (falling back to the original client if `navigate()` resolves falsy). Any per-client error (e.g. window closed between `matchAll` and `focus`) is swallowed and the loop tries the next candidate.
- If no window client could be focused/navigated, calls `self.clients.openWindow(targetUrl)` to open a brand-new window/tab.

### 2.9 `components/PwaRegistration.tsx` (40 lines, full file)

Client component, registers on mount only in production (`process.env.NODE_ENV !== "production"` → no-op, `:7-12`) and only if `serviceWorker in navigator`. Builds `scriptUrl = /sw.js?v=${NEXT_PUBLIC_APP_VERSION ?? "dev"}` (`:15-16`) — this is the cache-busting version query the SW reads for `CACHE_VERSION`/`STATIC_CACHE`. Registers with `{ scope: "/", updateViaCache: "none" }` (`:19-22`, disables browser HTTP caching of the SW script itself so updates are picked up reliably). Registration is deferred to `window.addEventListener("load", register, {once:true})` unless `document.readyState === "complete"` already, in which case it registers immediately (`:28-36`). No explicit update-checking/polling logic beyond the browser's normal SW update lifecycle; component renders nothing (`return null`).

### 2.10 `app/manifest.ts` (31 lines, full file, exact fields)

```
id: "/"
name: "Pi Web"
short_name: "Pi Web"
description: "Local web interface for the pi coding agent"
start_url: "/"
scope: "/"
display: "standalone"
background_color: "#1a1a1a"
theme_color: "#1a1a1a"
categories: ["developer", "productivity"]
lang: "en"
icons:
  - { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" }
  - { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" }
```

(Next.js `MetadataRoute.Manifest`, served at the conventional `/manifest.webmanifest` route that `sw.js` precaches.)

### 2.11 `lib/browser-notifications.ts` (123 lines, full file)

`shouldShowBrowserNotification(attentionState = document)` (`:37-43`): returns `true` ("go ahead and notify") when `document.visibilityState !== "visible"` **or** `!document.hasFocus()` — a visible-but-unfocused tab still notifies. This in-page gate is separate from and complementary to the service worker's window-visible gate (SW only checks `visibilityState`, not focus).

`isBlockingExtensionUiRequest(request)` (`:45-59`): `true` for `select`/`confirm`/`input`/`editor` always; for `custom` only if `request.closed !== true`; `false` otherwise (the shared classifier used by both the extension-UI attention path, §1.16, and this section).

`claimExtensionAttentionNotification(request, notifiedRequestIds)` (`:61-72`): dedups by `request.id` in a `Set` so the same blocking dialog never fires more than one attention notification.

`showBrowserNotification(options, environment)` (`:85-123`): prefers **service-worker-backed** notifications first — `registration.showNotification(title, {body, tag, data: {url: sessionUrl}})` — returning `"service-worker"` on success. Falls back to the raw `new Notification(title, {body, tag})` constructor with `notification.onclick = () => { notification.close(); options.onClick(); }`, returning `"window"`. Returns `null` if neither path works (e.g. mobile browsers that expose `Notification` but require SW delivery and throw on direct construction).

**In-page trigger paths** (`components/AppShell.tsx`):
- `handleAgentEnd` (`:870-884`): on every agent-end, always bumps refresh counters; only proceeds to notify if `shouldShowBrowserNotification()`. Builds `title = selectedSession?.name ?? translate("i18n.sessionComplete")`, `body = translate("i18n.taskFinished")`, `tag = pi-session-complete:<id>` (or bare `pi-session-complete` with no session). Calls `deliverSessionNotification(...)`.
- `deliverSessionNotification` (`:823-865`): if `Notification.permission === "granted"`, fires immediately and also calls `setupPushSubscription()` (opportunistic re-subscribe). If `"default"`, calls `Notification.requestPermission()` and fires + subscribes only if the user grants it in that moment. If `"denied"`, does nothing.
- `handleAttentionNeeded` (`:886-908`): same gating (`shouldShowBrowserNotification`) plus per-request dedup (§1.16); title = `translate("i18n.attentionNeeded")`, body = `translate("i18n.extensionInputNeeded")` for `custom` requests or `request.title` otherwise, tag = `pi-extension-ui:<request.id>`.

### 2.12 `hooks/useAudio.ts` (110 lines, full file)

**No sound file** — the "completion sound" is synthesized in-browser via Web Audio (`playTone`, `:15-32`): two sine oscillators at 523.25 Hz and 659.25 Hz (C5, E5), staggered 0.18s apart, each with a short attack/decay gain envelope (linear ramp to 0.18 over 20ms, exponential decay to 0.001 over 450ms), `osc.start`/`osc.stop` at 0.45s duration. A single `AudioContext` is created lazily and reused/resumed (autoplay-policy workaround, `:44-57`).

Preference key: `localStorage` key `"pi-sound-enabled"` (`SOUND_ENABLED_KEY`, `:7`), read via a `StorageLike` abstraction (`getBrowserStorage()`). `readSoundEnabled` (`:10-13`): **default is `true`** when nothing is stored or storage is unavailable; only the literal string `"true"`/anything-else-as-false once a value exists.

`playDoneSound` (`:82-101`) checks `enabledRef.current` and no-ops if sound is off — internal to the hook, so every external call site is safe even without its own gate, though some call sites also gate redundantly.

**Trigger sites for the chime** (`components/ChatWindow.tsx`):
- `wrappedOnAgentEnd` (`:304-308`): plays on the same `onAgentEnd` callback as the browser notification (i.e. the `agent_settled`/idle transition, §2.13).
- A separate effect (`:531-539`) plays the chime whenever a **new extension dialog appears** (`extensionDialog.id` changes), deduped via `soundedExtensionDialogIdRef` so re-renders of the same dialog don't replay it — fires independently of `onAgentEnd`/notifications, purely on dialog-open.

### 2.13 "Task finished" — exact trigger, both paths traced to source

Both the server-side web-push trigger and the client-side in-page/notification+sound trigger key off the **same underlying SDK event: `agent_settled`**, but via two independent code paths that never call each other:

- **Server-side (push)**: `AgentSessionWrapper` in `lib/rpc-manager.ts` subscribes to the inner SDK session (`:226-244`); on `agent_settled` it calls `notifyAgentRunCompleteIfIdle()` (`:242`, §2.5), which fires only if the run had actually started (`agent_start` seen) and the session is now fully idle (not streaming/compacting/bash-running/pending-prompt). This calls the `onAgentRunComplete` callback wired at session construction (`:1830-1839`) into `notifySessionComplete()`.
- **Client-side (in-page notification + sound)**: `hooks/useAgentSession.ts`, in its SSE event switch, case `"agent_settled"` (`:1732-1747`): if the agent was previously active and no RPC prompt is still pending, it settles UI stage, reloads the session, and — if it "was running" — calls `onAgentEnd?.()` (`:1746`). Two other call sites of `onAgentEnd?.()`/`notifyPromptStage()` exist (`:1390` inside `notifyPromptStage`, called from `finishPromptWithoutStream` at `:1503`, and directly at `:1746`), covering the non-streaming completion path and the streamed-then-settled path — all ultimately correspond to the run reaching an idle/settled state, mirroring the server-side idle check. `onAgentEnd` is wired in `AppShell.tsx:2645` to `handleAgentEnd`, which triggers both the browser notification (`deliverSessionNotification`) and (via `ChatWindow.tsx`'s `wrappedOnAgentEnd`) the completion chime.

Both paths independently derive from the same SDK idle/settle semantics but are computed separately (once server-side inside `AgentSessionWrapper`, once client-side inside `useAgentSession`) — there is no single shared "task finished" event object; each side reconstructs "idle" from its own view of the event stream.

---

## 3. Project command environment isolation (recap)

`lib/project-command-env.ts` sanitizes the environment given to pi-web's built-in project shell/bash tool: it strips `PORT`, `NODE_ENV`, and any `NEXT_*` variable (case-insensitive match on Windows) from the base environment before running project commands (`sanitizeProjectCommandEnvironment`; `isHostRuntimeVariable`), while keeping the SDK-managed `PATH`, Pi session metadata, and everything else. Per `docs/adr/0001-isolate-project-command-environments.md`, this prevents the Next.js host's own runtime env from leaking into agent-run shell commands, while explicit env vars set by a project command still take effect and third-party extensions keep control of their own subprocess env (unaffected/not intercepted). Full detail lives in `docs/adr/0001-isolate-project-command-environments.md` and `docs/agent-runtime.md`.

---

## 4. Instrumentation and startup

### 4.1 `instrumentation.ts` (repo root, 1-6)

Next.js `register()` hook. Guards on `process.env["NEXT_RUNTIME"] !== "nodejs"` (skips on edge runtime), then dynamically imports and calls `configureHttpDispatcher()` from `lib/http-dispatcher.ts` with no arguments (uses the default timeout).

### 4.2 `lib/http-dispatcher.ts`

Configures a global undici HTTP dispatcher, idempotently:

- `DEFAULT_HTTP_IDLE_TIMEOUT_MS = 300_000` (5 min, `:4`).
- `configureHttpDispatcher(timeoutMs = DEFAULT_HTTP_IDLE_TIMEOUT_MS)` (`:70-98`) is a no-op if `globalThis.__piWebHttpDispatcherConfigured` is already true (`:73`).
- Timeout parsing (`parseHttpIdleTimeoutMs`, `:14-26`): accepts a number ≥0 (floored), or a string — `"disabled"` → `0`, empty string → `undefined` (invalid), otherwise parsed as a number recursively. An invalid value throws `Invalid HTTP idle timeout: <value>` (`:77`). No env var reads this directly — the function takes a plain argument and is only ever called with none from `instrumentation.ts`, so in practice it's always the 300s default. `lib/http-dispatcher.test.mjs` exercises the parameterized values directly.
- Builds an `undici.EnvHttpProxyAgent` (`:80-88`) with `allowH2: false`, `bodyTimeout`/`headersTimeout` = the resolved idle timeout, and custom `clientFactory`/`factory` hooks (`createUndiciClient`, `createUndiciOriginDispatcher`, `:44-68`) that wrap every created `Client`/`Pool` with an error listener (`withUndiciErrorListener`, `:31-42`) — swallows an internal undici `Client` "error" event during response-body teardown so it can't crash the Node process (the body stream still rejects for the caller, comment `:28-30`).
- `EnvHttpProxyAgent` is undici's built-in proxy-from-environment agent — it reads `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` (and lowercase variants) from `process.env` itself; pi-web does not re-implement that logic.
- `undici.Pool` vs `undici.Client`: `createUndiciOriginDispatcher` (`:53-68`) uses a bare `Client` when `connections === 1`, otherwise a `Pool`.
- Sets itself as the global dispatcher via `undici.setGlobalDispatcher(dispatcher)` (`:89`).
- Calls `undici.install()` (`:94`) to make the global `fetch` use the same undici implementation, but only if `globalThis.fetch` is still the original fetch captured at module load (`:11`) — won't clobber a fetch override installed after this module loaded.
- Sets `__piWebHttpDispatcherConfigured = true` (`:97`) to guard re-entry.

### 4.3 `bin/pi-web.js` (1-56) — CLI entry point (`pi-web` bin)

- Checks Node version via `./node-version` (`isNodeVersionSupported`); exits 1 with a message if unsupported.
- Delegates flag parsing to `./pi-web-options` (`parseLaunchOptions`). On a parse error, writes the message to stderr and exits 1.
- `--help`/`-h`: prints help text to stdout, exits 0.
- Resolves `{ port, hostname }` from `launchOptions`.
- If `hostname` is not one of `127.0.0.1`, `localhost`, `::1`, `[::1]` (`:38`), prints a stderr warning: `Warning: pi-web is listening on ${hostname} without built-in authentication. Only use this on a trusted network or behind an external security layer.` (`:40-44`) — pi-web's only LAN-exposure warning; no separate "LAN mode" flag exists, it's just non-loopback hostname detection.
- Calls `runNext("start", ["-p", port, "-H", hostname], { pkgDir, requireBuild: true })` from `bin/run-next.js`. `pkgDir` is the package root (`path.join(__dirname, "..")`).
- On thrown error, prints `[pi-web] <message>` to stderr, exits 1.

**`bin/pi-web-options.js` (1-74)** — flag/env parsing used by `pi-web.js`:

- Flags (via Node's `util.parseArgs`, `strict: true`): `-p, --port <port>`, `-H, --hostname <host>`, `-h, --help`. No positional args allowed (throws `Unexpected argument(s): ...` otherwise).
- Port: must match `/^\d+$/`, must be a safe integer ≤ 65535, else throws `Port must be a non-negative integer.` / `Port must be between 0 and 65535.` (`:11-22`).
- Defaults/env (`:69-70`): `port` = `--port` ?? `env.PORT` ?? `"30141"`; `hostname` = `--hostname` ?? `env.PI_WEB_HOSTNAME` ?? `"127.0.0.1"`.
- Help text (`:24-38`) documents exactly this: `-p/--port` (default 30141 or `PORT`), `-H/--hostname` (default 127.0.0.1 or `PI_WEB_HOSTNAME`), `-h/--help`.
- A parse error from `parseArgs` is rewrapped with `\nUse --help to see available options.` appended and `err.code = "ERR_PARSE_ARGS_UNKNOWN_OPTION"`.

### 4.4 `bin/run-next.js` (1-62)

Used by both `pi-web.js` (mode `"start"`) and directly as a dev/build CLI (`run-next.js <dev|start|build> [Next.js options]`):

- `runNext(mode, args, { pkgDir, env = process.env, requireBuild = false })`.
- Resolves the host Pi runtime via `resolveHostPi({ env, checkoutDir: pkgDir })` (from `bin/host-pi.js`).
- For `mode !== "start"` (dev/build), calls `writeHostPiShims(runtime, pkgDir)` — comment (`:21-23`): dev/build resolve Pi through `node_modules` where bundlers/tsc don't see a preload resolve hook, so shims are written into the checkout; `start` needs no writable checkout because prebuilt output imports Pi by name.
- If `requireBuild` and `.next` doesn't exist under `pkgDir`, throws `Build artifacts not found. Please report this issue.` (`:25-27`) — this is how `pi-web.js`'s `requireBuild: true` prevents starting a server with no build.
- Resolves the real Next.js bin (`next/dist/bin/next`) relative to `pkgDir`.
- Spawns `node --require <bin/host-pi-runtime.js> <next-bin> <mode> ...args` with `cwd: pkgDir`, `stdio: "inherit"`, and env = `{...env, PI_WEB_HOST_PI: JSON.stringify(runtime)}` — the resolved host Pi runtime info is passed to the child via this JSON env var, consumed by the `host-pi-runtime.js` preload.
- Wires child process lifecycle via `wireChildProcessLifecycle(child)` from `bin/process-lifecycle.js`.
- When run as `require.main` directly: `mode` must be `dev`, `start`, or `build`, else usage error + exit 1.

**`bin/process-lifecycle.js` (1-81)** — shared shutdown plumbing for both `pi-web.js`-driven start and direct `run-next.js` invocations:

- Forwards `SIGINT`/`SIGTERM` from the parent process to the child (`:5, 47-61`). A second signal while a shutdown is already pending immediately `SIGKILL`s the child (`:49-52`).
- `shutdownTimeoutMs = 5_000` (`:6`): after forwarding a signal, starts an unref'd 5s timer; if the child hasn't exited by then, force-kills it with `SIGKILL` (`:54-56`, `forceKill` `:25`).
- On child `"error"` (spawn failure, `child.pid === undefined`), logs and exits the parent with code 1 if the process never spawned (`:35-45`).
- On child `"exit"`: unwires listeners/timer; if the exit wasn't a shutdown the parent itself triggered (`!shuttingDown`) and exit code isn't 0, logs `[pi-web] Next.js exited unexpectedly (...)` with signal or code (`:71-75`); then exits the parent process with the child's exit code, or a signal-derived code (`128 + signal number`) if the child died by signal (`:77`, `getSignalExitCode` `:8-11`).

### 4.5 `docs/packaging.md` — runtime smoke, and `scripts/runtime-smoke.test.mjs`

`docs/packaging.md` documents the runtime smoke test as the check that exercises a packaged tarball install end-to-end (`npm pack` → install into a scratch dir → run the `pi-web` bin) rather than the source checkout, catching packaging bugs (missing `files` entries, wrong bin paths) that unit tests against the checkout can't see. `scripts/runtime-smoke.test.mjs` packs the package, installs it in an isolated temp directory, starts the resulting `pi-web` binary as a child process against a scratch/fixture Pi agent dir, waits for it to bind its HTTP port, issues real HTTP requests against the running server (asserting a successful response, e.g. the root page and/or an API route) to confirm the packaged build actually serves traffic, then tears the child process and temp directory down.

---

## 5. i18n message layer

### 5.1 `lib/i18n/messages/en.ts` — namespaces and key counts

A single flat `Record<string, string>` (`enMessages`, dotted-namespace keys, no nesting), 506 lines, **477 total keys**. Per-namespace (prefix before the first `.`) counts:

| Namespace | Keys | Namespace | Keys |
|---|---|---|---|
| chat | 178 | session | 36 |
| i18n | 126 | sidebar | 36 |
| files | 21 | tools | 15 |
| settings | 13 | directoryPicker | 11 |
| trust | 9 | skills | 7 |
| workspace | 6 | system | 5 |
| common | 4 | error | 4 |
| history | 3 | layout | 3 |

The `i18n.*` namespace (126 keys, largest after `chat`) is a generic/shared bucket — common UI verbs (`i18n.close`, `i18n.cancel`, `i18n.copy`, `i18n.loading`, `i18n.search`, etc., `en.ts:341-360`) plus shared status/notification strings, e.g. `i18n.sessionComplete: "Session complete"`, `i18n.taskFinished: "Task finished."`, `i18n.attentionNeeded: "Pi needs your attention"`, `i18n.extensionInputNeeded: "An extension is waiting for your input."` (`en.ts:488-491`).

### 5.2 `lib/i18n/format.ts` (130 lines) — formatting helpers

English-only, no locale switching:

- `translateMessage(key, params)` (`:19-30`): looks up `enMessages[key]`; if missing, warns to console (non-production only) and returns the raw key as fallback; otherwise runs `interpolateMessage`.
- `interpolateMessage(message, params)` (`:8-16`): replaces `{name}` tokens via regex `/\{([\w.-]+)\}/g`; an unmatched param name leaves the literal token in place.
- `formatTimestamp(timestamp, now = new Date())` (`:78-96`): **`hourCycle` is hardcoded to `"h23"`** (24-hour clock) via `toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })` — not locale-dependent, always forced 24h. If the timestamp's date matches `now`'s year/month/day, returns just the time (e.g. `"14:32"`); otherwise prefixes with a date via `toLocaleDateString("en", { month: "short", day: "numeric", year: ... })`, where `year` is included only if the timestamp's year differs from `now`'s year (`:93`) — e.g. `"Mar 3 14:32"` same-year, `"Mar 3, 2025 14:32"` different year.
- `formatRelativeTime(date, now = new Date())` (`:99-119`): uses `Intl.RelativeTimeFormat("en", { numeric: "always" })`. Unit/divisor thresholds on `absMs = |diffMs|` (`:106-113`): `< 60_000` → unit `"second"` (divisor 1000); `< 3_600_000` (1hr) → `"minute"` (divisor 60000); `< 86_400_000` (1 day) → `"hour"` (divisor 3600000); else → `"day"` (divisor 86400000). Value = `Math.round(diffMs / divisor)`. `numeric: "always"` means it always renders as "in N units"/"N units ago", never "now"/"yesterday" — there is no special-cased "just now" string; a sub-minute diff still renders e.g. "in 3 seconds" / "3 seconds ago". No absolute-date fallback (unlike `formatTimestamp`) — it always stays relative regardless of how old the date is.
- `formatDuration(seconds)` (`:122-129`): whole-seconds elapsed-time formatter for tool calls. `total = max(0, round(seconds))`. Renders `"{h}h {m}m {s}s"` if hours>0, else `"{m}m {s}s"` if minutes>0, else `"{s}s"`. Hours value uses `toLocaleString("en")` (thousands separator for huge values); minutes/seconds are raw numbers.
- `formatCompactCount(value)` (`:36-40`): hand-rolled instead of `Intl` compact notation "because it renders an uppercase K" (comment). `≥1_000_000` → `"{n.toFixed(1)}M"`; `≥1_000` → `"{round(n/1000)}k"` (lowercase k); else `value.toLocaleString("en")`.
- `formatContextUsage(usage)` (`:43-75`): builds `{summary, size, percent}` strings for context-window UI from a `ContextUsage` object, using `translateMessage("session.contextSummary"/"session.contextSize"/"session.estimatedValue", ...)` templates and `formatCompactCount`; returns `null` if `usage?.contextWindow` is falsy.
