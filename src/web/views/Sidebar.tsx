import {
  type ProjectGroup,
  relativeTime,
  type SessionRowMetadata,
  sessionTitle,
  type SessionSummary,
} from "@core/sessions";

// The session list. Rows arrive as placeholders and fetch their own counts
// when they scroll into view, so opening a store with thousands of sessions
// costs one header read per file and nothing else.

export type Row = { summary: SessionSummary; metadata?: SessionRowMetadata };

function Indicator({ summary }: { summary: SessionSummary }) {
  const [label, klass] = summary.running
    ? ["Agent running", "status-primary animate-pulse"]
    : summary.live
      ? ["Session active", "status-success"]
      : ["Session stopped", "status-neutral opacity-40"];
  return (
    <span
      class={`status status-sm ${klass}`}
      title={label}
      aria-label={label}
    />
  );
}

function MenuItem(props: {
  label: string;
  post?: string;
  href?: string;
  danger?: boolean;
  confirm?: string;
  target: string;
}) {
  const klass = props.danger ? "text-error" : "";
  if (props.href) {
    return (
      <li>
        <a href={props.href} target="_blank" rel="noreferrer" class={klass}>
          {props.label}
        </a>
      </li>
    );
  }
  return (
    <li>
      <button
        type="button"
        class={klass}
        hx-post={props.post}
        hx-target={props.target}
        hx-swap="outerHTML"
        {...(props.confirm ? { "hx-confirm": props.confirm } : {})}
      >
        {props.label}
      </button>
    </li>
  );
}

function RowMenu({ summary, metadata }: Row) {
  const id = summary.id;
  const target = `#row-${id}`;
  return (
    <details class="dropdown dropdown-end">
      <summary
        class="btn btn-square btn-ghost btn-xs"
        aria-label={`Actions for ${sessionTitle(summary, metadata)}`}
      >
        ⋯
      </summary>
      <ul class="menu dropdown-content z-10 w-52 rounded-box bg-base-100 p-1 text-sm shadow">
        <li>
          <form
            hx-post={`/sessions/${id}/rename`}
            hx-target={target}
            hx-swap="outerHTML"
            class="p-1"
          >
            <input
              name="name"
              value={metadata?.name ?? summary.name ?? ""}
              placeholder="Rename…"
              aria-label={`Rename ${sessionTitle(summary, metadata)}`}
              class="input w-full input-xs"
            />
          </form>
        </li>
        {summary.live ? (
          <MenuItem
            label="Stop"
            post={`/sessions/${id}/stop`}
            target={target}
          />
        ) : (
          <MenuItem
            label="Activate"
            post={`/sessions/${id}/activate`}
            target={target}
          />
        )}
        {metadata && metadata.starCount > 0 ? (
          <MenuItem
            label="Clear all stars"
            post={`/sessions/${id}/stars/clear`}
            target={target}
          />
        ) : null}
        <MenuItem
          label="Clone branch"
          post={`/sessions/${id}/clone`}
          target={target}
        />
        <MenuItem
          label="Full history"
          href={`/sessions/${id}/export`}
          target={target}
        />
        <MenuItem
          label="Delete"
          post={`/sessions/${id}/delete`}
          target={target}
          confirm="Delete this session and its transcript?"
          danger
        />
      </ul>
    </details>
  );
}

/** One sidebar row. Without metadata it loads its own when revealed. */
export function SessionRow({
  summary,
  metadata,
  activeId,
  oob,
}: Row & { activeId?: string; oob?: boolean }) {
  const id = summary.id;
  const title = sessionTitle(summary, metadata);
  const pending = metadata === undefined;
  return (
    <li
      id={`row-${id}`}
      data-session-id={id}
      data-title={title.toLowerCase()}
      {...(oob ? { "hx-swap-oob": "true" } : {})}
      {...(pending
        ? {
            "hx-get": `/sessions/${id}/row`,
            "hx-trigger": "revealed",
            "hx-swap": "outerHTML",
          }
        : {})}
      class="flex items-center gap-1 px-1"
    >
      <a
        href={`/sessions/${id}`}
        class={`flex min-w-0 flex-1 flex-col gap-0.5 rounded px-2 py-1 hover:bg-base-300 ${
          id === activeId ? "bg-base-300 font-medium" : ""
        }`}
      >
        <span class="flex min-w-0 items-center gap-1">
          <span
            class="unread-dot hidden size-1.5 shrink-0 rounded-full bg-info"
            title="New activity"
          />
          <span class="truncate text-sm">{title}</span>
        </span>
        <span class="flex items-center gap-2 text-xs text-base-content/60">
          <Indicator summary={summary} />
          <span title={summary.modifiedAt}>
            {relativeTime(summary.modifiedAt)}
          </span>
          {pending ? (
            <span role="status">…</span>
          ) : (
            <>
              <span>{String(metadata.messageCount)} msgs</span>
              {metadata.starCount > 0 ? (
                <span title={`${String(metadata.starCount)} starred answers`}>
                  ★ {String(metadata.starCount)}
                </span>
              ) : null}
            </>
          )}
          {summary.worktreeBranch ? (
            <span class="badge badge-ghost badge-xs">
              {summary.worktreeBranch}
            </span>
          ) : null}
        </span>
      </a>
      {pending ? null : <RowMenu summary={summary} metadata={metadata} />}
    </li>
  );
}

export function SessionList({
  groups,
  activeId,
  oob,
}: {
  groups: ProjectGroup[];
  activeId?: string;
  oob?: boolean;
}) {
  return (
    <div
      id="session-list"
      class="min-h-0 flex-1 overflow-y-auto"
      {...(oob ? { "hx-swap-oob": "innerHTML" } : {})}
    >
      {groups.map((group) => (
        <section class="px-1 pb-2">
          <h2
            class="truncate px-2 pt-2 text-xs text-base-content/60"
            title={group.root}
          >
            {group.label}
          </h2>
          <ul class="flex flex-col">
            {group.sessions.map((session) => (
              <SessionRow summary={session} activeId={activeId} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ThemeSelect() {
  return (
    <label class="flex items-center gap-2 border-t border-base-300 px-3 py-2 text-xs">
      <span class="text-base-content/60">Theme</span>
      {/* Wired up by src/web/client/main.ts; without it the system theme wins. */}
      <select id="theme-select" class="select select-xs" aria-label="Theme">
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}

export function Sidebar({
  groups,
  activeId,
}: {
  groups: ProjectGroup[];
  activeId?: string;
}) {
  return (
    <aside
      id="sidebar"
      class="flex h-full w-72 flex-col border-r border-base-300 bg-base-200"
      hx-ext="sse"
      sse-connect="/events"
      sse-swap="rows"
      hx-swap="none"
    >
      <div class="flex items-center justify-between px-3 py-2">
        <a href="/" class="font-semibold">
          Pi
        </a>
        <a
          href="/new"
          class="btn btn-primary btn-xs"
          title="New session (Ctrl+K)"
        >
          New
        </a>
      </div>
      <div class="px-3 pb-2">
        <input
          id="session-filter"
          type="search"
          placeholder="Filter sessions"
          aria-label="Filter sessions"
          class="input w-full input-xs"
        />
      </div>
      <SessionList groups={groups} activeId={activeId} />
      {/* Filled by the global stream with the id of a session whose turn just
          finished; src/web/client/main.ts turns that into an unread dot. */}
      <div
        id="session-finished"
        sse-swap="finished"
        hx-swap="innerHTML"
        hidden
      />
      <ThemeSelect />
    </aside>
  );
}
