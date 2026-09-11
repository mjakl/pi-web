import type { SlashCommand, SlashSource } from "@core/composer";
import type {
  ModelOption,
  Notice,
  ThinkingChoice,
  ThinkingLevel,
} from "@core/ports";
import type { NewSessionView, SessionView } from "@core/workspace";
import {
  AttachImageIcon,
  ChevronDownIcon,
  ComposerActionIcon,
  DropZoneIcon,
  ModelCheckIcon,
  MoreDotsIcon,
  WarningTriangleIcon,
} from "./icons.tsx";

// pi-web's ChatInput (components/ChatInput.tsx, §6 of the UI map): one 820px
// column holding the banners, the queue panel, the 24px-radius surface and its
// toolbar. The server renders the composer and every menu it opens; the client
// bundle owns only the keyboard, the local file index, and the image previews,
// which cannot come from a round trip.

/** The two anchored menus above the surface share pi-web's panel box. */
const MENU_PANEL =
  "position:absolute; left:0; right:0; bottom:calc(100% + 8px);" +
  " z-index:120; overflow:hidden; box-sizing:border-box; display:flex;" +
  " flex-direction:column; max-height:min(48vh, 400px)";

const MENU_HEADER =
  "padding:8px 10px; border-bottom:1px solid var(--border); display:flex;" +
  " align-items:center; justify-content:space-between; gap:8px;" +
  " font-size:11px; color:var(--text-dim); flex-shrink:0";

const SOURCE_LABEL: Record<SlashSource, string> = {
  builtin: "Built-in",
  extension: "Extensions",
  prompt: "Prompts",
  skill: "Skills",
};

/** pi-web groups the list in this order, whatever order the commands arrive in. */
const SOURCE_ORDER: SlashSource[] = ["builtin", "extension", "prompt", "skill"];

/** "1 match" / "N matches", as pi-web labels the `@` file menu. */
export function matchLabel(count: number): string {
  return count === 1 ? "1 match" : `${String(count)} matches`;
}

/**
 * The slash menu counts commands until something is typed after the slash,
 * and only then counts matches (ChatInput.tsx L1116-L1121).
 */
export function commandLabel(count: number, query: string): string {
  if (query !== "") return matchLabel(count);
  return count === 1 ? "1 command" : `${String(count)} commands`;
}

/**
 * The slash menu: pi-web's header with the count and the Tab / Enter hint,
 * then one section per source. The flat `data-index` is what the arrow keys
 * walk; `data-active` is the highlight pi-web's `.menu-item` CSS keys on.
 */
export function CommandMenu({
  commands,
  query = "",
}: {
  commands: SlashCommand[];
  /** What was typed after the slash: it picks the header's noun. */
  query?: string;
}) {
  const groups = SOURCE_ORDER.map((source) => ({
    source,
    items: commands.filter((command) => command.source === source),
  })).filter((group) => group.items.length > 0);
  let index = -1;
  return (
    <>
      <div style={MENU_HEADER}>
        <span>Slash commands · {commandLabel(commands.length, query)}</span>
        <span style="font-family:var(--font-mono)">Tab / Enter</span>
      </div>
      <div style="flex:1 1 auto; min-height:0; overflow-y:auto; padding:4px">
        {commands.length === 0 ? (
          <div style="padding:2px 2px 4px; font-size:12px; color:var(--text-dim)">
            No extension, prompt, or skill commands found
          </div>
        ) : (
          groups.map((group) => (
            <section style="margin-bottom:8px">
              <div
                class="menu-section-label"
                style="position:sticky; top:-10px; z-index:1; display:flex; align-items:center; justify-content:space-between; gap:8px; background:var(--bg)"
              >
                <span>{SOURCE_LABEL[group.source]}</span>
                <span style="font-family:var(--font-mono); font-weight:500">
                  {String(group.items.length)}
                </span>
              </div>
              <div>
                {group.items.map((command) => {
                  index += 1;
                  return (
                    <button
                      type="button"
                      class="menu-item"
                      style="align-items:baseline"
                      data-command={command.name}
                      data-index={String(index)}
                    >
                      <span style="flex-shrink:0; font-size:12.5px; font-family:var(--font-mono); overflow-wrap:anywhere">
                        /{command.name}
                        {command.manual ? (
                          <span style="margin-left:6px; padding:0 4px; border:1px solid var(--border); border-radius:3px; font-size:9px; color:var(--text-muted); white-space:nowrap">
                            Manual
                          </span>
                        ) : null}
                      </span>
                      {command.description ? (
                        <span style="min-width:0; flex:1 1 auto; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:11px; color:var(--text-dim)">
                          {command.description}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </>
  );
}

/** pi-web's notice dot colours (§4.8). */
const TOAST_COLOUR = {
  info: "var(--accent)",
  warning: "var(--warning)",
  error: "var(--danger)",
} as const;

/** pi-web's `NoticeShelf` card, floating over the transcript (§4.8). */
const NOTICE_ITEM_STYLE =
  "display:flex; align-items:flex-start; gap:10px; min-height:60px;" +
  " height:auto; max-height:500px; pointer-events:auto; overflow:hidden;" +
  " border-radius:14px;" +
  " border:1px solid color-mix(in srgb, var(--border) 70%, transparent);" +
  " background:var(--bg); color:var(--text-muted); width:fit-content;" +
  " max-width:min(100%, 620px);" +
  " box-shadow:0 1px 2px rgba(15,23,42,0.05), 0 10px 28px -14px rgba(15,23,42,0.24);" +
  " font-size:14px; line-height:1.5; transform-origin:top right;" +
  " animation:notice-shelf-in 0.18s ease-out backwards; padding:0 12px";

const NOTICE_TEXT_STYLE =
  "padding:14px 0; min-width:0; max-width:100%; max-height:470px;" +
  " overflow-y:auto; scrollbar-width:thin; white-space:pre-line;" +
  " word-break:break-word";

/** One batch of notices, appended to the shelf by the session's SSE stream. */
export function Toasts({ notices }: { notices: Notice[] }) {
  return (
    <>
      {notices.map((notice) => (
        <div
          class="notice-shelf-item"
          role={notice.level === "error" ? "alert" : "status"}
          style={NOTICE_ITEM_STYLE}
        >
          <span
            style={`width:7px; height:7px; border-radius:50%; background:${TOAST_COLOUR[notice.level]}; flex-shrink:0; margin-top:21px`}
          />
          <span tabindex={0} style={NOTICE_TEXT_STYLE}>
            {notice.message}
          </span>
        </div>
      ))}
    </>
  );
}

/**
 * Images a recall took back out of the queue. The client bundle turns each
 * one into a File and puts it back in the attachment strip; nothing renders.
 */
export function RecalledImages({
  images,
  oob,
}: {
  images: { data: string; mimeType: string }[];
  oob?: boolean;
}) {
  return (
    <div
      id="recalled-images"
      hidden
      {...(oob === false ? {} : { "hx-swap-oob": "innerHTML" })}
    >
      {images.map((image) => (
        <span data-image={image.data} data-mime={image.mimeType} />
      ))}
    </div>
  );
}

export function ComposerText({ draft }: { draft?: string }) {
  return (
    <textarea
      id="composer-text"
      name="text"
      class="composer-textarea"
      rows={1}
      placeholder="Message…"
      // The browser keyboard must not steal Enter from a phone user.
      enterkeyhint="enter"
    >
      {draft ?? ""}
    </textarea>
  );
}

/** pi-web's ModelNoticeBanner (§6.2), for the one tone web-pi raises. */
export function ModelScopeWarning({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return <></>;
  return (
    <div
      role="alert"
      style="display:flex; align-items:flex-start; gap:8px; max-height:120px; margin-bottom:8px; padding:7px 10px; overflow-y:auto; border:1px solid rgba(234,179,8,0.3); border-radius:6px; background:rgba(234,179,8,0.07); color:rgb(234,179,8); font-size:11px; line-height:1.45"
    >
      <span style="flex-shrink:0; margin-top:1px; display:flex">
        <WarningTriangleIcon />
      </span>
      <div style="min-width:0">
        <div style="font-weight:600">
          Model scope warning{warnings.length === 1 ? "" : "s"}
        </div>
        <div style="white-space:pre-wrap; overflow-wrap:anywhere">
          {warnings.join("\n")}
        </div>
      </div>
    </div>
  );
}

/** Everything the model selector renders from, wherever it is rendered. */
export type ModelPick = {
  models: ModelOption[];
  current: ModelOption | null;
  levels: ThinkingChoice[];
  level?: ThinkingLevel;
  /** A live session applies a pick at once; `/new` only records it. */
  sessionId?: string;
  cwd?: string;
  /** A running turn locks the selector, as pi-web does. */
  disabled?: boolean;
};

/** How many models it takes before the menu needs a filter box (pi-web: >8). */
const FILTER_FROM = 8;

/**
 * What the selector shows for a session. `disabled` is also kept in step by
 * the client while a turn runs: the stream only re-sends this subtree when
 * the model or its levels change, not on every frame of a turn.
 */
export function modelPick(view: SessionView): ModelPick {
  const { status } = view;
  const current = status?.model ?? view.model ?? null;
  return {
    models: view.models,
    current,
    // A session nothing is running for still offers the levels its model
    // knows, as pi-web's picker does from the model list alone.
    levels: status?.thinkingLevels ?? current?.thinkingLevels ?? [],
    // Nothing is running, so the level is the one the branch last switched to,
    // else the one an `enabledModels` pattern pinned for this model. That is
    // what pi-web puts beside the name before a turn (session-reader.ts
    // `getSessionSettings`); neither reads "auto", as it does there.
    ...(status === null
      ? (view.thinking ?? current?.pin) === undefined
        ? {}
        : { level: view.thinking ?? current?.pin }
      : { level: status.thinkingLevel }),
    sessionId: view.summary.id,
    disabled: status?.running === true || status?.compacting === true,
  };
}

function modelValue(model: ModelOption): string {
  return `${model.provider}/${model.id}`;
}

/**
 * The reasoning level shown beside the model name, and inside the menu. pi-web
 * shows it on every chat, naming the provider's own label when the level maps
 * to one and "auto" while Pi is left to decide (ChatInput.tsx L1734).
 */
function levelLabel(pick: ModelPick): string {
  const choice = pick.levels.find((entry) => entry.level === pick.level);
  return choice?.label ?? pick.level ?? "auto";
}

/** Where a pick goes, as htmx attributes: the same swap in both places. */
function pickAttributes(pick: ModelPick, value: string) {
  const target = {
    "hx-target": "closest .model-selector",
    "hx-swap": "outerHTML",
  };
  const model = encodeURIComponent(value);
  if (pick.sessionId !== undefined) {
    return {
      // The button sits inside the composer form: without this htmx would
      // post the draft and its attachments along with the pick.
      "hx-params": "none",
      "hx-post": `/sessions/${pick.sessionId}/model?model=${model}`,
      ...target,
    };
  }
  const cwd = encodeURIComponent(pick.cwd ?? "");
  return {
    "hx-get": `/workspaces/model-selector?cwd=${cwd}&model=${model}`,
    ...target,
  };
}

/** pi-web's reasoning row: the label and the level select (§6.1). */
function ReasoningField({ pick }: { pick: ModelPick }) {
  const current = pick.current;
  const value =
    pick.sessionId === undefined || current === null
      ? {}
      : {
          "hx-post": `/sessions/${pick.sessionId}/model?model=${encodeURIComponent(modelValue(current))}`,
          "hx-trigger": "change",
          "hx-params": "thinking",
          "hx-target": "closest .model-selector",
          "hx-swap": "outerHTML",
        };
  return (
    <label class="composer-thinking-field">
      <span>Change reasoning level</span>
      <select name="thinking" disabled={pick.disabled === true} {...value}>
        {/* pi-web keeps "auto" in the list whatever the model offers, and
            selects it while nothing is pinned (ChatInput.tsx L1759-L1768). */}
        <option value="auto" selected={pick.level === undefined}>
          auto
        </option>
        {pick.levels.map((choice) => (
          <option value={choice.level} selected={choice.level === pick.level}>
            {choice.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** pi-web sorts the whole list by display name, never by which is current. */
const MODEL_COLLATOR = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

function compareModels(a: ModelOption, b: ModelOption): number {
  return (
    MODEL_COLLATOR.compare(a.name || a.id, b.name || b.id) ||
    MODEL_COLLATOR.compare(a.provider, b.provider) ||
    MODEL_COLLATOR.compare(a.id, b.id)
  );
}

/**
 * pi-web's ModelSelector (§6.5): the toolbar trigger and the listbox it
 * anchors. The popover is the browser's — `popovertarget` opens it, light
 * dismiss and Escape close it — and CSS anchor positioning pins it to the
 * trigger, so nothing here needs a script.
 */
export function ModelSelector({
  pick,
  oob,
}: {
  pick: ModelPick;
  /** The session stream re-renders the whole selector in place. */
  oob?: boolean;
}) {
  const { current, disabled } = pick;
  const models = [...pick.models].sort(compareModels);
  const name =
    current?.name ?? (models.length === 0 ? "No models" : "Select model");
  const detail = levelLabel(pick);
  const providers = [...new Set(models.map((model) => model.provider))];
  return (
    <div
      id="model-selector"
      class={`model-selector is-composer${disabled === true ? " is-disabled" : ""}`}
      style="position:relative; min-width:0"
      {...(oob === true ? { "hx-swap-oob": "outerHTML" } : {})}
    >
      {/* `/new` posts the pick with the first prompt instead of applying it. */}
      {pick.sessionId === undefined ? (
        <input
          type="hidden"
          name="model"
          value={current ? modelValue(current) : ""}
        />
      ) : null}
      <button
        type="button"
        id="model-trigger"
        class="anchor-model-selector"
        popovertarget="model-menu"
        aria-haspopup="dialog"
        aria-expanded="false"
        aria-label="Model and reasoning"
        disabled={disabled === true}
        title={
          disabled === true
            ? name
            : models.length > 0
              ? "Change model"
              : "No available models"
        }
      >
        <span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">
          {name}
        </span>
        <span class="composer-model-detail">{detail}</span>
        <ChevronDownIcon />
      </button>
      <div
        id="model-menu"
        popover="auto"
        class="anchored-menu menu-surface opens-up menu-model-selector"
        role="dialog"
        aria-label="Model and reasoning"
      >
        <ReasoningField pick={pick} />
        {models.length > FILTER_FROM ? (
          <div style="flex-shrink:0; padding:6px 8px; border-bottom:1px solid var(--border)">
            <input
              id="model-filter"
              class="menu-filter"
              style="min-width:220px"
              placeholder="Filter models…"
              aria-label="Filter models…"
              autocomplete="off"
              spellcheck={false}
              // Showing a popover focuses its first autofocus element, which
              // is where pi-web's ref.focus() put the caret.
              autofocus
            />
          </div>
        ) : null}
        <div
          role="listbox"
          aria-label="Select model"
          style="min-height:0; overflow-y:auto"
        >
          {models.length === 0 ? (
            <div style="padding:8px 12px; color:var(--text-dim); font-size:12px; white-space:nowrap">
              No available models
            </div>
          ) : (
            providers.map((provider, index) => (
              <div data-provider={provider}>
                {providers.length > 1 ? (
                  <div
                    class="menu-section-label"
                    style={`border-top:${index > 0 ? "1px solid var(--border)" : "none"}`}
                  >
                    {provider}
                  </div>
                ) : null}
                {models
                  .filter((model) => model.provider === provider)
                  .map((model) => {
                    const active =
                      current?.provider === model.provider &&
                      current.id === model.id;
                    return (
                      <button
                        type="button"
                        role="option"
                        class="menu-item"
                        style="white-space:nowrap"
                        aria-selected={active ? "true" : "false"}
                        data-model-name={model.name}
                        {...pickAttributes(pick, modelValue(model))}
                      >
                        {active ? (
                          <ModelCheckIcon />
                        ) : (
                          <span style="width:10px; flex-shrink:0" />
                        )}
                        <span
                          title={model.name}
                          style="min-width:0; overflow:hidden; text-overflow:ellipsis"
                        >
                          {model.name}
                        </span>
                      </button>
                    );
                  })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * pi-web's mobile "more" menu (§6.1): a phone has no Alt key and no room for
 * the extension status line, so both live here. `.composer-more` is hidden
 * above 640px by areas/composer.css, which is where pi-web's `isMobile` was.
 */
function MoreControls({ sessionId }: { sessionId?: string }) {
  return (
    <>
      <button
        type="button"
        id="composer-controls-trigger"
        class="anchor-composer-controls composer-more"
        popovertarget="composer-controls"
        aria-expanded="false"
        title="Session controls"
        aria-label="Session controls"
      >
        <MoreDotsIcon size={18} />
      </button>
      <div
        id="composer-controls"
        popover="auto"
        class="anchored-menu menu-surface opens-up menu-composer-controls"
      >
        {sessionId === undefined ? null : (
          <button
            type="button"
            class="menu-item composer-stop"
            hx-post={`/sessions/${sessionId}/abort`}
            hx-params="none"
            hx-swap="none"
          >
            Stop agent
          </button>
        )}
        {/* The shelf's own status line is sr-only on a phone (globals.css
            L2262); this is the copy pi-web shows instead. The client keeps it
            in step with the shelf, and it stays out of the accessibility tree
            because the live region below already announces the same text. */}
        <section
          id="composer-status-section"
          aria-label="Extension status"
          hidden
        >
          <div class="menu-section-label">Extension status</div>
          <div class="extension-status-shelf has-status" aria-hidden="true">
            <div class="extension-status-line">
              <span id="shelf-mobile" class="extension-status-text" />
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

/** pi-web's drag-and-drop overlay (§4.1); the client bundle unhides it. */
export function DropZone() {
  return (
    <div class="chat-drop-zone" hidden>
      <div class="chat-drop-zone-ripples">
        {["0s", "0.8s", "1.6s"].map((delay) => (
          <div
            class="chat-drop-zone-ripple"
            style={`transform-origin:center; animation-delay:${delay}`}
          />
        ))}
      </div>
      <DropZoneIcon />
    </div>
  );
}

/**
 * `sessionId` posts into an existing session; `cwd` starts a new one. The two
 * differ only in where the form posts, whether the menus have a session to ask
 * for commands and files, and whether a model pick applies now or on send.
 */
export function Composer({
  sessionId,
  cwd,
  draft,
  view,
  start,
  status,
}: {
  sessionId?: string;
  cwd?: string;
  draft?: string;
  /** The session this composer belongs to: its models and running state. */
  view?: SessionView;
  /** Set on the new-session page: the model to start in this folder with. */
  start?: NewSessionView;
  /** The banners and queue panel, so the first render matches the stream's. */
  status?: unknown;
}) {
  const pick: ModelPick | undefined = view
    ? modelPick(view)
    : start
      ? {
          models: start.models,
          current: start.model ?? null,
          levels: start.model?.thinkingLevels ?? [],
          ...(start.thinkingLevel === undefined
            ? {}
            : { level: start.thinkingLevel }),
          cwd: start.cwd,
        }
      : undefined;
  return (
    <form
      id="composer"
      class="chat-input"
      hx-post={
        sessionId === undefined ? "/sessions" : `/sessions/${sessionId}/prompt`
      }
      hx-encoding="multipart/form-data"
      hx-target="#toasts"
      hx-swap="beforeend"
      {...(sessionId === undefined ? {} : { "data-session-id": sessionId })}
      {...(cwd === undefined ? {} : { "data-cwd": cwd })}
      {...(start?.usable === true ? { "data-complete": "folder" } : {})}
    >
      <input
        id="image-input"
        type="file"
        name="images[]"
        accept="image/*"
        multiple
        style="display:none"
      />
      <div style="max-width:820px; margin:0 auto">
        {sessionId === undefined && cwd !== undefined ? (
          <input type="hidden" name="cwd" value={cwd} />
        ) : null}
        {/* htmx reads the last clicked button, not requestSubmit's submitter,
            so the delivery mode travels in a field of its own. */}
        <input
          id="composer-behavior"
          type="hidden"
          name="behavior"
          value="steer"
        />
        {/* pi-web's banners and queue panel live here, above the surface and
            inside the 820px column; the session stream re-renders them. */}
        {/* hx-target is inherited, and the form's points at the toast list:
            without this the stream's status fragments would pile up there. */}
        <div id="status" sse-swap="status" hx-target="this" hx-swap="innerHTML">
          {status}
          {start ? <ModelScopeWarning warnings={start.modelWarnings} /> : null}
        </div>
        <div style="position:relative; min-width:0">
          <div
            id="slash-menu"
            class="menu-surface menu-panel"
            style={MENU_PANEL}
            hidden
          />
          <div
            id="at-menu"
            class="menu-surface menu-panel"
            style={MENU_PANEL}
            hidden
          />
          <div class="composer-surface">
            <div
              id="image-previews"
              style="display:flex; gap:6px; margin-bottom:6px; flex-wrap:wrap"
              hidden
            />
            <ComposerText draft={draft} />
            <div class="composer-toolbar">
              <button
                type="button"
                id="attach-image"
                class="composer-attach"
                title="Attach image"
                aria-label="Attach image"
              >
                <AttachImageIcon />
              </button>
              <MoreControls
                {...(sessionId === undefined ? {} : { sessionId })}
              />
              {pick === undefined ? null : <ModelSelector pick={pick} />}
              <button
                type="submit"
                class="composer-action-primary"
                data-action="send"
                data-behavior="steer"
                aria-label="Send"
                title="Send"
                disabled
              >
                <ComposerActionIcon action="send" />
              </button>
            </div>
          </div>
        </div>
        <div class="composer-shell-mode" id="shell-hint" hidden />
        <span class="sr-only" role="status" id="composer-running-note" />
        <RecalledImages images={[]} oob={false} />
      </div>
    </form>
  );
}
