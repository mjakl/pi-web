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
 */
export function TrustDialog({ cwd }: { cwd: string }) {
  return (
    <Dialog id="trust-dialog" title="Trust this project?">
      <p>
        Project resources can run local code. Trust only projects whose contents
        you know.
      </p>
      <code>{cwd}</code>
      <div>
        <form method="dialog">
          <button>Cancel</button>
        </form>
        <button
          type="button"

          hx-post="/workspaces/trust"
          hx-vals={JSON.stringify({ cwd })}
          hx-swap="none"
        >
          Trust project
        </button>
      </div>
    </Dialog>
  );
}

/** The toolbar badge that opens the dialog while a folder stays untrusted. */
export function TrustBadge({
  cwd,
  status,
}: {
  cwd: string;
  status: { requiresTrust: boolean; trusted: boolean };
}) {
  if (!status.requiresTrust || status.trusted) return <></>;
  return (
    <button
      type="button"

      title="Project resources are not loaded because this project is not trusted"
      hx-get={`/workspaces/trust?cwd=${encodeURIComponent(cwd)}`}
      hx-target="#dialogs"
      hx-swap="innerHTML"
    >
      🛡 Restricted mode
    </button>
  );
}

/** Shown wherever a session's folder is gone; every mutating route agrees. */
export function MissingFolderNotice({ cwd }: { cwd: string }) {
  return (
    <div role="status">
      <span>Read only</span>
      <span>Working folder is unavailable. This session is read-only.</span>
      <code>{cwd}</code>
    </div>
  );
}
