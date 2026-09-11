import { TrustDialogShieldIcon, TrustShieldIcon } from "./icons.tsx";

// The dialogs the shell owns: the modal shell every one of them is built from,
// the host they are swapped into, and the trust flow. The workspace picker
// lives with the sidebar (Workspace.tsx) and reuses `Dialog` from here.

/** Everything modal renders here; the client turns it into a real modal. */
export function DialogHost() {
  return <div id="dialogs" />;
}

export function Dialog({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children?: unknown;
}) {
  return (
    <dialog id={id} data-modal open>
      <div>
        <div>
          <h2>{title}</h2>
          <form method="dialog">
            <button aria-label="Close">✕</button>
          </form>
        </div>
        {children}
      </div>
      <form method="dialog">
        <button aria-label="Close">close</button>
      </form>
    </dialog>
  );
}

/**
 * Trust. Project resources are code Pi runs, so a repository nobody vouched
 * for stays dormant until someone says otherwise, here or in the terminal.
 * pi-web's markup: components/ProjectTrustDialog.tsx.
 */
export function TrustDialog({ cwd }: { cwd: string }) {
  return (
    <dialog
      id="trust-dialog"
      class="project-trust-dialog"
      aria-labelledby="project-trust-title"
      data-modal
      data-backdrop-close
      open
    >
      <div class="project-trust-panel">
        <div style="display:flex; gap:12px; padding:18px 18px 14px">
          <TrustDialogShieldIcon />
          <div style="min-width:0">
            <div
              id="project-trust-title"
              style="font-size:15px; font-weight:700; color:var(--text)"
            >
              Trust this project?
            </div>
            <div style="margin-top:7px; font-size:12px; line-height:1.6; color:var(--text-muted)">
              Project resources can run local code. Trust only projects whose
              contents you know.
            </div>
            <code style="display:block; margin-top:10px; padding:8px 10px; border:1px solid var(--border); border-radius:5px; background:var(--bg); color:var(--text); font-family:var(--font-mono); font-size:11px; overflow-wrap:anywhere">
              {cwd}
            </code>
          </div>
        </div>
        <div style="display:flex; justify-content:flex-end; gap:8px; padding:10px 18px; border-top:1px solid var(--border)">
          <form method="dialog">
            <button style="height:32px; padding:0 12px; border:1px solid var(--border); border-radius:5px; background:transparent; color:var(--text-muted); cursor:pointer; font-size:12px">
              Cancel
            </button>
          </form>
          <button
            type="button"
            style="height:32px; padding:0 12px; border:1px solid var(--accent); border-radius:5px; background:var(--accent); color:var(--on-accent); cursor:pointer; font-size:12px; font-weight:600"
            hx-post="/workspaces/trust"
            hx-vals={JSON.stringify({ cwd })}
            hx-swap="none"
          >
            Trust project
          </button>
        </div>
      </div>
    </dialog>
  );
}

/**
 * The top bar's trust warning (ui-map 2.3). pi-web keeps it beside the tabs,
 * in `--warning`, and it opens the dialog.
 */
export function TrustBadge({
  cwd,
  status,
  banner,
}: {
  cwd: string;
  status: { requiresTrust: boolean; trusted: boolean };
  /** The phone variant: a full-width row under the bar, not a bar button. */
  banner?: boolean;
}) {
  if (!status.requiresTrust || status.trusted) return <></>;
  const shape =
    banner === true
      ? "justify-content:flex-start; width:100%; min-height:32px;" +
        " padding:6px 12px;" +
        " background:color-mix(in srgb, var(--warning) 8%, var(--bg-panel));" +
        " border:none; border-bottom:1px solid var(--border)"
      : "justify-content:center; height:100%; padding:0 12px;" +
        " background:none; border:none;" +
        " border-right:1px solid var(--border)";
  return (
    <button
      type="button"
      data-trust-warning
      {...(banner === true ? { "data-mobile-trust-banner": "true" } : {})}
      style={`display:flex; align-items:center; gap:6px; ${shape}; color:var(--warning); cursor:pointer; flex-shrink:0; font-size:11px; line-height:1.35; text-align:left`}
      title="Restricted mode"
      aria-label="Restricted mode"
      hx-get={`/workspaces/trust?cwd=${encodeURIComponent(cwd)}`}
      hx-target="#dialogs"
      hx-swap="innerHTML"
    >
      <TrustShieldIcon />
      <span>Restricted mode</span>
    </button>
  );
}

/**
 * What pi-web puts in the composer's place when the session's folder is gone
 * (ChatWindow.tsx `chatInputElement`): one sentence, in the class its own
 * stylesheet indents and dims.
 */
export function MissingFolderNotice() {
  return (
    <div role="status" class="project-folder-message">
      Working folder is unavailable. This session is read-only.
    </div>
  );
}
