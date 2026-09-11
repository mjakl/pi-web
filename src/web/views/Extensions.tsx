import { ansiToHtml, normalizeFrame } from "@core/ansi";
import type { CustomFrame, DialogRequest } from "@core/extension-ui";
import { raw } from "hono/html";

// What an extension puts on screen while it waits for the reader: one modal
// dialog, and one panel holding the frames of a terminal component. Both are
// server-rendered and arrive on the session stream, so a second tab sees the
// same dialog and loses it the moment another tab answers.

/** Seconds left on an extension-set timeout, for the line under the title. */
function remaining(expiresAt: number): string {
  const seconds = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
  return `Closes in ${String(seconds)}s if unanswered.`;
}

function Actions({ children }: { children?: unknown }) {
  return <div>{children}</div>;
}

/**
 * Second in the row but first to the eye: Enter in a text field submits the
 * first submit button in the document, so the primary one has to come first
 * and `order` puts it back on the right.
 */
function Cancel() {
  return (
    <button
      type="submit"
      name="cancelled"
      value="1"

      data-dialog-cancel
    >
      Cancel
    </button>
  );
}

function Body({ dialog }: { dialog: DialogRequest }) {
  switch (dialog.method) {
    case "select":
      return (
        <>
          <div>
            {(dialog.options ?? []).map((option) => (
              <button type="submit" name="value" value={option}>
                {option}
              </button>
            ))}
          </div>
          <Actions>
            <Cancel />
          </Actions>
        </>
      );
    case "confirm":
      return (
        <>
          <p>{dialog.message ?? ""}</p>
          <Actions>
            <button type="submit" name="confirmed" value="1">
              Confirm
            </button>
            <Cancel />
          </Actions>
        </>
      );
    case "input":
      return (
        <>
          <input
            type="text"
            name="value"

            placeholder={dialog.placeholder ?? ""}
            autofocus
          />
          <Actions>
            <button type="submit">Send</button>
            <Cancel />
          </Actions>
        </>
      );
    case "editor":
      return (
        <>
          <textarea
            name="value"

            data-dialog-submit
            autofocus
          >
            {dialog.prefill ?? ""}
          </textarea>
          <Actions>
            <button type="submit">Save</button>
            <Cancel />
          </Actions>
        </>
      );
    default:
      return <></>;
  }
}

/** The dialog itself, or nothing when no extension is waiting. */
export function ExtensionDialogBody({
  sessionId,
  dialog,
}: {
  sessionId: string;
  dialog: DialogRequest | null;
}) {
  if (!dialog) return <></>;
  return (
    <dialog data-modal open>
      <form hx-post={`/sessions/${sessionId}/ui/${dialog.id}`} hx-swap="none">
        <h3>{dialog.title}</h3>
        {dialog.expiresAt === undefined ? null : (
          <p>{remaining(dialog.expiresAt)}</p>
        )}
        <Body dialog={dialog} />
      </form>
    </dialog>
  );
}

export function ExtensionDialog({
  sessionId,
  dialog,
}: {
  sessionId: string;
  dialog: DialogRequest | null;
}) {
  return (
    <div id="extension-dialog" sse-swap="dialog" hx-swap="innerHTML">
      <ExtensionDialogBody sessionId={sessionId} dialog={dialog} />
    </div>
  );
}

/** The frame, converted once; the panel around it never moves. */
export function CustomFrameBody({ frame }: { frame: CustomFrame | null }) {
  if (!frame) return <></>;
  return <>{raw(ansiToHtml(normalizeFrame(frame.lines).join("\n")))}</>;
}

/**
 * The custom-UI panel. The shell is swapped only when a component opens or
 * closes; the frame inside it is swapped on every render, so focus and the
 * reader's scroll position stay put while the component redraws.
 */
export function CustomPanelBody({
  sessionId,
  frame,
}: {
  sessionId: string;
  frame: CustomFrame | null;
}) {
  if (!frame) return <></>;
  return (
    <section data-custom-ui={`/sessions/${sessionId}/ui/${frame.id}/input`}>
      <div>
        <span>Extension UI · click to type, Ctrl+C to close</span>
        <span />
        <button
          type="button"

          data-custom-close
          title="Sends Ctrl+C, which is how a component is asked to finish"
        >
          Close
        </button>
      </div>
      <pre
        id="custom-frame"
        sse-swap="custom-frame"
        hx-swap="innerHTML"
        tabindex={0}
        role="application"
        aria-label="Extension terminal UI"
      >
        <CustomFrameBody frame={frame} />
      </pre>
    </section>
  );
}

export function CustomPanel({
  sessionId,
  frame,
}: {
  sessionId: string;
  frame: CustomFrame | null;
}) {
  return (
    <div id="custom-ui" sse-swap="custom" hx-swap="innerHTML">
      <CustomPanelBody sessionId={sessionId} frame={frame} />
    </div>
  );
}

/** What the browser needs to know changed, so a frame is only re-sent once. */
export function customSignature(frame: CustomFrame | null): string {
  return frame === null ? "" : `${frame.id}:${frame.lines.join("\n")}`;
}

export function dialogSignature(dialog: DialogRequest | null): string {
  return dialog === null ? "" : dialog.id;
}
