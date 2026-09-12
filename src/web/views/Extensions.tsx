import { ansiToHtml, normalizeFrame } from "@core/ansi";
import type { CustomFrame, DialogRequest } from "@core/extension-ui";
import { raw } from "hono/html";

// What an extension puts on screen while it waits for the reader: one modal
// dialog, and one panel holding the frames of a terminal component. Both are
// server-rendered and arrive on the session stream, so a second tab sees the
// same dialog and loses it the moment another tab answers. The markup is
// pi-web's (components/ChatWindow.tsx L1696-L2100), kebab-cased.

const PANEL =
  "width:min(560px, 100%); max-height:min(760px, 100%); display:flex;" +
  " flex-direction:column; border:1px solid var(--border); border-radius:8px;" +
  " background:var(--bg); box-shadow:0 20px 60px rgba(0,0,0,0.28);" +
  " overflow:hidden";

const FIELD =
  "width:100%; padding:9px 10px; border-radius:7px;" +
  " border:1px solid var(--border); background:var(--bg-panel);" +
  " color:var(--text); outline:none; font-size:13px";

const CANCEL_BUTTON =
  "padding:6px 10px; border-radius:6px; border:1px solid var(--border);" +
  " background:var(--bg); color:var(--text-muted); cursor:pointer";

const CONFIRM_BUTTON =
  "padding:6px 10px; border-radius:6px; border:1px solid var(--accent);" +
  " background:var(--accent); color:var(--on-accent); cursor:pointer";

/** Seconds left on an extension-set timeout, for the line under the title. */
function remaining(expiresAt: number): string {
  const seconds = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
  return `Closes in ${String(seconds)}s if unanswered.`;
}

/**
 * Second in the row but first to the eye: Enter in a text field submits the
 * first submit button in the document, so the primary one has to come first
 * and `order` puts it back on the left, where pi-web draws Cancel.
 */
function Cancel() {
  return (
    <button
      type="submit"
      name="cancelled"
      value="1"
      style={`${CANCEL_BUTTON}; order:-1`}
      data-dialog-cancel
    >
      Cancel
    </button>
  );
}

function Footer({ children }: { children?: unknown }) {
  return (
    <div style="flex-shrink:0; display:flex; justify-content:flex-end; gap:8px; padding:10px 14px; border-top:1px solid var(--border); background:var(--bg-panel)">
      {children}
    </div>
  );
}

function Body({ dialog }: { dialog: DialogRequest }) {
  switch (dialog.method) {
    case "select":
      return (
        <>
          <div style="padding:14px; flex:1 1 auto; min-height:0; overflow-y:auto">
            <div style="display:grid; gap:8px">
              {(dialog.options ?? []).map((option) => (
                <button
                  type="submit"
                  name="value"
                  value={option}
                  style="width:100%; padding:9px 10px; border-radius:7px; border:1px solid var(--border); background:var(--bg-panel); color:var(--text); cursor:pointer; text-align:left; font-size:13px; overflow-wrap:anywhere"
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
          <Footer>
            <Cancel />
          </Footer>
        </>
      );
    case "confirm":
      return (
        <>
          <div style="padding:14px">
            <div style="color:var(--text-muted); font-size:13px; line-height:1.6; white-space:pre-wrap">
              {dialog.message ?? ""}
            </div>
          </div>
          <Footer>
            <button
              type="submit"
              name="confirmed"
              value="1"
              style={CONFIRM_BUTTON}
            >
              Confirm
            </button>
            <Cancel />
          </Footer>
        </>
      );
    case "input":
      return (
        <>
          <div style="padding:14px">
            <input
              type="text"
              name="value"
              style={FIELD}
              placeholder={dialog.placeholder ?? ""}
              autofocus
            />
          </div>
          <Footer>
            <button type="submit" style={CONFIRM_BUTTON}>
              Submit
            </button>
            <Cancel />
          </Footer>
        </>
      );
    case "editor":
      return (
        <>
          <div style="padding:14px">
            <textarea
              name="value"
              style="width:100%; min-height:220px; padding:10px; border-radius:7px; border:1px solid var(--border); background:var(--bg-panel); color:var(--text); outline:none; resize:vertical; font-size:13px; line-height:1.55; font-family:var(--font-mono)"
              data-dialog-submit
              autofocus
            >
              {dialog.prefill ?? ""}
            </textarea>
          </div>
          <Footer>
            <button type="submit" style={CONFIRM_BUTTON}>
              Submit
            </button>
            <Cancel />
          </Footer>
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
    <dialog class="extension-dialog" aria-label={dialog.title} data-modal open>
      <form
        style={PANEL}
        hx-post={`/sessions/${sessionId}/ui/${dialog.id}`}
        hx-swap="none"
      >
        <div style="flex-shrink:0; padding:12px 14px; border-bottom:1px solid var(--border)">
          <div style="color:var(--text); font-size:14px; font-weight:650">
            {dialog.title}
          </div>
          <div style="margin-top:3px; color:var(--text-dim); font-size:11px; font-family:var(--font-mono)">
            {dialog.expiresAt === undefined
              ? "extension request"
              : remaining(dialog.expiresAt)}
          </div>
        </div>
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
    <div id="extension-dialog">
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
    <dialog
      class="extension-dialog"
      aria-label="Extension terminal input"
      data-modal
      data-no-escape
      open
    >
      <section
        style="position:relative; width:min(920px, 100%); max-height:min(760px, calc(100vh - 40px)); border:1px solid var(--border); border-radius:8px; background:var(--bg); box-shadow:0 20px 60px rgba(0,0,0,0.28); overflow:hidden; outline:none"
        data-custom-ui={`/sessions/${sessionId}/ui/${frame.id}/input`}
      >
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 12px; border-bottom:1px solid var(--border)">
          <div style="color:var(--text); font-size:13px; font-weight:650">
            Extension panel
          </div>
          <button
            type="button"
            style="padding:5px 9px; border-radius:6px; border:1px solid var(--border); background:var(--bg-panel); color:var(--text-muted); cursor:pointer; font-size:12px"
            data-custom-close
            title="Sends Ctrl+C, which is how a component is asked to finish"
          >
            Close
          </button>
        </div>
        <pre
          id="custom-frame"
          style="margin:0; padding:14px; max-height:calc(min(760px, 100vh - 40px) - 48px); overflow:auto; background:var(--bg-panel); color:var(--text); font-family:var(--font-mono); font-size:13px; line-height:1.45; white-space:pre"
          tabindex={0}
          role="application"
          aria-label="Extension terminal UI"
        >
          <CustomFrameBody frame={frame} />
        </pre>
      </section>
    </dialog>
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
    <div id="custom-ui">
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
