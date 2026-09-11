import type { SlashCommand, SlashSource } from "@core/composer";
import type {
  ModelOption,
  Notice,
  ThinkingChoice,
  ThinkingLevel,
} from "@core/ports";
import type { NewSessionView } from "@core/workspace";

// The composer is one form. The server renders it and every menu it opens;
// the client bundle owns only the keyboard, the local file index, and the
// image previews, which cannot come from a round trip.

const SOURCE_LABEL: Record<SlashSource, string> = {
  builtin: "Built in",
  extension: "Extensions",
  prompt: "Prompts",
  skill: "Skills",
};

/** The slash menu list, grouped by source with a flat index for the arrows. */
export function CommandMenu({ commands }: { commands: SlashCommand[] }) {
  if (commands.length === 0) {
    return <div>No commands</div>;
  }
  const groups = [...new Set(commands.map((command) => command.source))];
  let index = -1;
  return (
    <ul role="listbox">
      {groups.map((source) => (
        <>
          <li>{SOURCE_LABEL[source]}</li>
          {commands
            .filter((command) => command.source === source)
            .map((command) => {
              index += 1;
              return (
                <li>
                  <button
                    type="button"
                    role="option"

                    data-command={command.name}
                    data-index={String(index)}
                  >
                    <span>/{command.name}</span>
                    {command.manual ? <span>Manual</span> : null}
                    <span>{command.description}</span>
                  </button>
                </li>
              );
            })}
        </>
      ))}
    </ul>
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

function Menu({ id, label }: { id: string; label: string }) {
  return <div id={id} role="presentation" aria-label={label} hidden />;
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
      placeholder="Ask Pi…  /command  @file  !shell"
      // The browser keyboard must not steal Enter from a phone user.
      enterkeyhint="enter"
    >
      {draft ?? ""}
    </textarea>
  );
}

/**
 * The model and reasoning selects, rendered the same way wherever they
 * appear: the status bar of a running session and the new-session composer.
 * `auto` is offered only before a session exists, where leaving the level
 * unset means "whatever Pi defaults to".
 */
export function ModelPicker({
  models,
  current,
  levels,
  level,
  auto,
}: {
  models: ModelOption[];
  current: ModelOption | null;
  levels: ThinkingChoice[];
  level?: ThinkingLevel;
  auto?: boolean;
}) {
  const providers = [...new Set(models.map((model) => model.provider))];
  const option = (model: ModelOption) => (
    <option
      value={`${model.provider}/${model.id}`}
      selected={current?.provider === model.provider && current.id === model.id}
    >
      {model.name}
    </option>
  );
  return (
    <>
      <select
        name="model"

        aria-label="Model"
        title={`${String(models.length)} models. Type to search.`}
      >
        {providers.length > 1
          ? providers.map((provider) => (
              <optgroup label={provider}>
                {models
                  .filter((model) => model.provider === provider)
                  .map(option)}
              </optgroup>
            ))
          : models.map(option)}
      </select>
      {current?.reasoning && levels.length > 0 ? (
        <select name="thinking" aria-label="Reasoning">
          {auto ? <option value="">auto</option> : null}
          {levels.map((choice) => (
            <option value={choice.level} selected={choice.level === level}>
              {choice.label}
            </option>
          ))}
        </select>
      ) : null}
    </>
  );
}

/**
 * The model a new session starts on. An explicit pick also becomes Pi's
 * default for the next session, which is why it is a field of the form
 * rather than a live command.
 */
function StartupModel({ view }: { view: NewSessionView }) {
  if (view.models.length === 0) return <></>;
  return (
    <div>
      <ModelPicker
        models={view.models}
        current={view.model ?? null}
        levels={view.model?.thinkingLevels ?? []}
        level={view.thinkingLevel}
        auto
      />
      {view.modelWarnings.length > 0 ? (
        <span role="alert">{view.modelWarnings.join("\n")}</span>
      ) : null}
    </div>
  );
}

/**
 * `sessionId` posts into an existing session; `cwd` starts a new one. The two
 * differ only in where the form posts and whether the menus have a session to
 * ask for commands and files.
 */
export function Composer({
  sessionId,
  cwd,
  draft,
  start,
}: {
  sessionId?: string;
  cwd?: string;
  draft?: string;
  /** Set on the new-session page: the model picker and the folder it starts in. */
  start?: NewSessionView;
}) {
  return (
    <form
      id="composer"

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
      <div id="image-previews" />
      <RecalledImages images={[]} oob={false} />
      <input
        id="image-input"
        type="file"
        name="images[]"
        accept="image/*"
        multiple
        hidden
      />
      <div>
        <Menu id="slash-menu" label="Commands" />
        <Menu id="at-menu" label="Files" />
        <ComposerText draft={draft} />
      </div>
      <div>
        {start ? <StartupModel view={start} /> : null}
        <button
          type="button"
          id="attach-image"

          aria-label="Attach images"
          title="Attach images"
        >
          🖼
        </button>
        <span id="shell-hint" hidden />
        <span />
        {/* The delivery mode travels in the hidden field above, which the
            click handler sets: htmx appends a submitter's own name and value
            *after* the form's fields, so a named button here would lose to
            the hidden one. */}
        <button
          type="submit"
          data-behavior="followUp"
          class="composer-running-only"
          title="Queue after the agent finishes (Alt+Enter)"
        >
          Queue
        </button>
        <button
          type="submit"
          data-behavior="steer"

          title="Ctrl+Enter to send"
        >
          <span class="composer-idle-label">Send</span>
          <span class="composer-running-label">Steer</span>
        </button>
      </div>
    </form>
  );
}
