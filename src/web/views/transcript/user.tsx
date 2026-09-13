import type { UserItem } from "@core/transcript";
import { ExpandChevronIcon, RewindIcon } from "@web/views/icons";
import {
  CopyButton,
  Images,
  type ItemActions,
  Markdown,
  Time,
} from "./shared.tsx";

// pi-web's user message band: the question, its attachments, and the
// copy and rewind actions under it. A skill expansion folds into a
// disclosure that shows the command.

export function UserMessage({
  item,
  actions,
}: {
  item: UserItem;
  actions?: ItemActions;
}) {
  const editable = actions && !actions.readOnly && !actions.live;
  const images = (
    <Images
      entryId={item.entryId}
      indices={item.images}
      actions={actions}
      size="thumb"
      marginBottom={item.text === "" ? 0 : 8}
    />
  );
  const command = item.command;
  const space = command === undefined ? -1 : command.search(/\s/);
  const name =
    command === undefined
      ? ""
      : space === -1
        ? command
        : command.slice(0, space);
  const args =
    command !== undefined && space !== -1 ? command.slice(space + 1) : "";
  return (
    <div
      class="message-row"
      id={`entry-${item.entryId}`}
      data-role="user"
      style="margin-bottom:16px; display:flex; flex-direction:column; align-items:flex-end"
    >
      <div class="user-message-band">
        <div class="user-message-band-content">
          <div style="min-width:0; max-width:85%; padding:14px 0; display:flex; flex-direction:column; font-size:14px; line-height:1.6; color:var(--text); word-break:break-word">
            <div style="margin-right:4px; padding:0 8px 0 12px">
              {command === undefined ? (
                <>
                  {images}
                  {/* `data-user-text` is what the composer's ArrowUp reads. */}
                  <div data-user-text hidden>
                    {item.text}
                  </div>
                  <Markdown
                    source={item.text}
                    actions={actions}
                    variant="markdown-user-message"
                  />
                </>
              ) : (
                <details
                  class="transcript-details"
                  style="display:flex; flex-direction:column; gap:6px; min-width:0"
                >
                  <summary style="display:flex; align-items:flex-start; gap:8px; flex-wrap:wrap">
                    <span hidden data-user-text>
                      {command}
                    </span>
                    <span style="display:flex; align-items:center; gap:6px; flex-shrink:0; color:var(--accent); font-family:var(--font-mono); font-size:13px; text-align:left">
                      <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">
                        {name}
                      </span>
                      <span
                        class="card-chevron"
                        style="display:flex; flex-shrink:0; opacity:0.75; transition:transform 0.15s"
                      >
                        <ExpandChevronIcon />
                      </span>
                    </span>
                    {args === "" ? null : (
                      <span style="color:var(--text); font-size:14px; line-height:1.6; white-space:pre-wrap; word-break:break-word; min-width:0; flex:1">
                        {args}
                      </span>
                    )}
                  </summary>
                  {images}
                  <Markdown
                    source={item.text}
                    actions={actions}
                    variant="markdown-user-message"
                  />
                </details>
              )}
            </div>
          </div>
        </div>
      </div>
      <div style="display:flex; align-items:center; justify-content:flex-end; gap:6px; margin-top:3px; flex-wrap:wrap">
        <div class="message-actions" style="display:flex; gap:3px">
          <CopyButton text={item.command ?? item.text} />
        </div>
        {editable && actions ? (
          <div
            class="message-actions"
            style="display:flex; gap:3px; flex-wrap:wrap; justify-content:flex-end"
          >
            {actions.busy === true ? null : (
              <button
                type="button"
                class="message-rewind"
                title="Rewind — remove this message and later history, then edit it again"
                hx-post={`/sessions/${actions.sessionId}/rewind`}
                hx-vals={JSON.stringify({ entryId: item.entryId })}
                hx-confirm="Remove this message and all later history?"
                hx-target="body"
                hx-swap="innerHTML"
              >
                <RewindIcon />
                Rewind
              </button>
            )}
          </div>
        ) : null}
        <Time
          value={item.timestamp}
          style="font-size:10px; color:var(--text-dim)"
        />
      </div>
    </div>
  );
}
