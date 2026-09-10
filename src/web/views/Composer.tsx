import type { SlashCommand, SlashSource } from "@core/composer";
import type { Notice } from "@core/ports";

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
    return (
      <div class="px-3 py-2 text-sm text-base-content/60">No commands</div>
    );
  }
  const groups = [...new Set(commands.map((command) => command.source))];
  let index = -1;
  return (
    <ul class="menu w-full flex-nowrap p-0 text-sm" role="listbox">
      {groups.map((source) => (
        <>
          <li class="sticky top-0 bg-base-100 px-3 py-1 text-xs text-base-content/50">
            {SOURCE_LABEL[source]}
          </li>
          {commands
            .filter((command) => command.source === source)
            .map((command) => {
              index += 1;
              return (
                <li>
                  <button
                    type="button"
                    role="option"
                    class="flex w-full items-baseline gap-2 rounded-none"
                    data-command={command.name}
                    data-index={String(index)}
                  >
                    <span class="font-mono">/{command.name}</span>
                    {command.manual ? (
                      <span class="badge badge-ghost badge-xs">Manual</span>
                    ) : null}
                    <span class="truncate text-xs text-base-content/60">
                      {command.description}
                    </span>
                  </button>
                </li>
              );
            })}
        </>
      ))}
    </ul>
  );
}

const TOAST_CLASS = {
  info: "alert-info",
  warning: "alert-warning",
  error: "alert-error",
} as const;

/** One batch of notices, appended to the shelf by the session's SSE stream. */
export function Toasts({ notices }: { notices: Notice[] }) {
  return (
    <>
      {notices.map((notice) => (
        <div class={`alert py-2 text-sm ${TOAST_CLASS[notice.level]}`}>
          <span>{notice.message}</span>
        </div>
      ))}
    </>
  );
}

function Menu({ id, label }: { id: string; label: string }) {
  return (
    <div
      id={id}
      role="presentation"
      aria-label={label}
      hidden
      class="absolute right-0 bottom-full left-0 z-20 mb-2 max-h-[min(48vh,400px)] overflow-y-auto rounded-box border border-base-300 bg-base-100 shadow-lg"
    />
  );
}

export function ComposerText({ draft }: { draft?: string }) {
  return (
    <textarea
      id="composer-text"
      name="text"
      class="composer-textarea textarea-bordered textarea w-full"
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
 * `sessionId` posts into an existing session; `cwd` starts a new one. The two
 * differ only in where the form posts and whether the menus have a session to
 * ask for commands and files.
 */
export function Composer({
  sessionId,
  cwd,
  draft,
}: {
  sessionId?: string;
  cwd?: string;
  draft?: string;
}) {
  return (
    <form
      id="composer"
      class="flex flex-col gap-2 border-t border-base-300 p-3"
      hx-post={
        sessionId === undefined ? "/sessions" : `/sessions/${sessionId}/prompt`
      }
      hx-encoding="multipart/form-data"
      hx-target="#toasts"
      hx-swap="beforeend"
      {...(sessionId === undefined ? {} : { "data-session-id": sessionId })}
      {...(cwd === undefined ? {} : { "data-cwd": cwd })}
    >
      {sessionId === undefined && cwd !== undefined ? (
        <label class="form-control">
          <span class="label-text text-xs">Working folder</span>
          <input
            name="cwd"
            value={cwd}
            class="input-bordered input w-full input-sm"
            required
          />
        </label>
      ) : null}
      {/* htmx reads the last clicked button, not requestSubmit's submitter,
          so the delivery mode travels in a field of its own. */}
      <input
        id="composer-behavior"
        type="hidden"
        name="behavior"
        value="steer"
      />
      <div id="image-previews" class="flex flex-wrap gap-2 empty:hidden" />
      <input
        id="image-input"
        type="file"
        name="images[]"
        accept="image/*"
        multiple
        hidden
      />
      <div class="relative">
        <Menu id="slash-menu" label="Commands" />
        <Menu id="at-menu" label="Files" />
        <ComposerText draft={draft} />
      </div>
      <div class="flex items-center gap-2">
        <button
          type="button"
          id="attach-image"
          class="btn btn-ghost btn-sm"
          aria-label="Attach images"
          title="Attach images"
        >
          🖼
        </button>
        <span id="shell-hint" class="text-xs text-base-content/60" hidden />
        <span class="flex-1" />
        <button
          type="submit"
          name="behavior"
          value="followUp"
          class="composer-running-only btn btn-sm"
          title="Queue after the agent finishes (Alt+Enter)"
        >
          Queue
        </button>
        <button
          type="submit"
          name="behavior"
          value="steer"
          class="btn btn-primary btn-sm"
          title="Ctrl+Enter to send"
        >
          <span class="composer-idle-label">Send</span>
          <span class="composer-running-label">Steer</span>
        </button>
      </div>
    </form>
  );
}
