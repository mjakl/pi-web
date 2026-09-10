import type { ProjectGroup } from "@core/sessions";
import type { SessionView } from "@core/workspace";
import { Items } from "./Items.tsx";
import { Status } from "./Status.tsx";

function Sidebar({
  groups,
  activeId,
}: {
  groups: ProjectGroup[];
  activeId?: string;
}) {
  return (
    <aside class="flex w-72 shrink-0 flex-col overflow-y-auto border-r border-base-300 bg-base-200">
      <div class="flex items-center justify-between px-3 py-2">
        <a href="/" class="font-semibold">
          Pi
        </a>
        <a href="/new" class="btn btn-primary btn-xs">
          New
        </a>
      </div>
      {groups.map((group) => (
        <section class="px-2 pb-2">
          <h2
            class="truncate px-1 text-xs text-base-content/60"
            title={group.cwd}
          >
            {group.label}
          </h2>
          <ul class="menu menu-sm p-0">
            {group.sessions.map((session) => (
              <li>
                <a
                  href={`/sessions/${session.id}`}
                  class={session.id === activeId ? "menu-active" : ""}
                >
                  <span class="truncate">{session.name ?? session.id}</span>
                  {session.live ? (
                    <span class="status status-success" aria-label="live" />
                  ) : null}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </aside>
  );
}

function Shell({
  groups,
  activeId,
  children,
}: {
  groups: ProjectGroup[];
  activeId?: string;
  children?: unknown;
}) {
  return (
    <div class="flex h-full">
      <Sidebar groups={groups} activeId={activeId} />
      <main
        class="flex min-w-0 flex-1 flex-col"
        hx-ext="sse"
        sse-connect={activeId ? `/sessions/${activeId}/events` : undefined}
      >
        {children}
      </main>
    </div>
  );
}

export function IndexPage({ groups }: { groups: ProjectGroup[] }) {
  return (
    <Shell groups={groups}>
      <div class="m-auto text-base-content/60">
        Pick a session or start a new one.
      </div>
    </Shell>
  );
}

export function NewSessionPage({
  groups,
  cwd,
}: {
  groups: ProjectGroup[];
  cwd: string;
}) {
  return (
    <Shell groups={groups}>
      <form
        method="post"
        action="/sessions"
        class="m-auto flex w-full max-w-xl flex-col gap-3"
      >
        <label class="form-control">
          <span class="label-text">Working folder</span>
          <input
            name="cwd"
            value={cwd}
            class="input-bordered input w-full"
            required
          />
        </label>
        <label class="form-control">
          <span class="label-text">First request</span>
          <textarea
            name="text"
            class="textarea-bordered textarea w-full"
            rows={4}
            required
          />
        </label>
        <button class="btn self-end btn-primary">Start</button>
      </form>
    </Shell>
  );
}

export function Composer({ sessionId }: { sessionId: string }) {
  return (
    <form
      id="composer"
      hx-post={`/sessions/${sessionId}/prompt`}
      hx-target="#notice"
      hx-swap="innerHTML"
      hx-on--after-request="if (event.detail.successful) this.reset()"
      class="flex gap-2 border-t border-base-300 p-3"
    >
      <textarea
        name="text"
        class="textarea-bordered textarea flex-1"
        rows={3}
        placeholder="Ask Pi… (Ctrl+Enter to send)"
        required
        hx-on--keydown="if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); this.form.requestSubmit(); }"
      />
      <button class="btn self-end btn-primary">Send</button>
    </form>
  );
}

export function Notice({ message }: { message?: string }) {
  return message ? (
    <div class="alert text-sm alert-error">{message}</div>
  ) : (
    <></>
  );
}

export function SessionPage({
  groups,
  view,
}: {
  groups: ProjectGroup[];
  view: SessionView;
}) {
  const { summary } = view;
  return (
    <Shell groups={groups} activeId={summary.id}>
      <header class="flex flex-col gap-1 border-b border-base-300 px-4 py-2">
        <div class="flex items-baseline gap-2">
          <h1 class="truncate font-semibold">{summary.name ?? summary.id}</h1>
          <span class="truncate text-xs text-base-content/60">
            {summary.cwd}
          </span>
        </div>
        <div id="status" sse-swap="status" hx-swap="innerHTML">
          <Status view={view} />
        </div>
      </header>
      <div id="log" class="flex-1 overflow-y-auto px-4">
        <div id="messages" sse-swap="settled" hx-swap="beforeend">
          <Items items={view.items} />
        </div>
        <div id="turn" sse-swap="turn" hx-swap="innerHTML">
          <Items items={view.turn} />
        </div>
      </div>
      <div id="notice" class="px-4" />
      <Composer sessionId={summary.id} />
    </Shell>
  );
}
