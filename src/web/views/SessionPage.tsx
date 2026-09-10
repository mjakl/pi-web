import { relativeTime, type ProjectGroup } from "@core/sessions";
import type { SessionView } from "@core/workspace";
import { Items } from "./Items.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { Status } from "./Status.tsx";

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
    <div class="drawer h-dvh md:drawer-open">
      <input id="nav-drawer" type="checkbox" class="drawer-toggle" />
      <div class="drawer-content flex min-h-0 flex-col">
        <div class="flex items-center gap-2 border-b border-base-300 px-2 py-1 md:hidden">
          <label
            for="nav-drawer"
            class="btn btn-ghost btn-sm"
            aria-label="Show sessions"
          >
            ☰
          </label>
          <a href="/" class="font-semibold">
            Pi
          </a>
        </div>
        <main
          class="flex min-h-0 flex-1 flex-col"
          data-session-id={activeId}
          hx-ext="sse"
          sse-connect={activeId ? `/sessions/${activeId}/events` : undefined}
        >
          {children}
        </main>
      </div>
      <div class="drawer-side">
        <label
          for="nav-drawer"
          class="drawer-overlay"
          aria-label="Hide sessions"
        />
        <Sidebar groups={groups} activeId={activeId} />
      </div>
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
  draft,
}: {
  groups: ProjectGroup[];
  cwd: string;
  draft?: string;
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
          >
            {draft ?? ""}
          </textarea>
        </label>
        <button class="btn self-end btn-primary">Start</button>
      </form>
    </Shell>
  );
}

export function Composer({
  sessionId,
  draft,
}: {
  sessionId: string;
  draft?: string;
}) {
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
        hx-on-keydown="if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); this.form.requestSubmit(); }"
      >
        {draft ?? ""}
      </textarea>
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

function BranchSwitcher({ view }: { view: SessionView }) {
  const { leaves, summary } = view;
  if (leaves.length < 2) return <></>;
  return (
    <details class="dropdown dropdown-end">
      <summary class="btn btn-ghost btn-xs">
        Branches ({String(leaves.length)})
      </summary>
      <ul class="menu dropdown-content z-10 max-h-96 w-80 flex-nowrap overflow-y-auto rounded-box bg-base-100 p-1 text-sm shadow">
        {leaves.map((leaf) => (
          <li>
            <a
              href={`/sessions/${summary.id}?leaf=${leaf.id}`}
              class={leaf.current ? "menu-active" : ""}
            >
              <span class="truncate">{leaf.label}</span>
              <span class="text-xs text-base-content/50">
                {relativeTime(leaf.timestamp)}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** The stored name, else the opening request, else the id. */
function pageTitle(view: SessionView): string {
  const name = view.summary.name?.trim();
  if (name) return name;
  const first = [...view.items, ...view.turn].find(
    (item) => item.kind === "user",
  );
  const opening = first?.text.replaceAll(/\s+/g, " ").trim().slice(0, 60);
  return opening === undefined || opening === "" ? view.summary.id : opening;
}

export function SessionPage({
  groups,
  view,
  draft,
}: {
  groups: ProjectGroup[];
  view: SessionView;
  draft?: string;
}) {
  const { summary } = view;
  const leafId = view.leaves.find((leaf) => leaf.current)?.id;
  return (
    <Shell groups={groups} activeId={summary.id}>
      <header class="flex flex-col gap-1 border-b border-base-300 px-4 py-2">
        <div class="flex items-baseline gap-2">
          <h1 class="truncate font-semibold">{pageTitle(view)}</h1>
          <span class="truncate text-xs text-base-content/60">
            {summary.cwd}
          </span>
          <span class="flex-1" />
          <BranchSwitcher view={view} />
          <details class="dropdown dropdown-end">
            <summary
              class="btn btn-ghost btn-xs"
              hx-get={`/sessions/${summary.id}/stats`}
              hx-target="#session-stats"
              hx-swap="innerHTML"
            >
              Stats
            </summary>
            <div
              id="session-stats"
              class="dropdown-content z-10 w-80 rounded-box bg-base-100 p-3 text-sm shadow"
            />
          </details>
          <a
            class="btn btn-ghost btn-xs"
            href={`/sessions/${summary.id}/export`}
            target="_blank"
            rel="noreferrer"
          >
            Full history
          </a>
        </div>
        <div id="status" sse-swap="status" hx-swap="innerHTML">
          <Status view={view} />
        </div>
        {view.otherBranch ? (
          <div class="alert flex items-center gap-2 py-1 text-sm alert-info">
            <span>Viewing another branch of this session, read only.</span>
            <button
              class="btn btn-xs"
              hx-post={`/sessions/${summary.id}/navigate`}
              hx-vals={JSON.stringify({ entryId: leafId })}
              hx-target="body"
              hx-swap="innerHTML"
            >
              Continue from here
            </button>
          </div>
        ) : null}
      </header>
      <div id="log" class="min-h-0 flex-1 overflow-y-auto px-4">
        <div id="messages" sse-swap="settled" hx-swap="beforeend">
          <Items
            items={view.items}
            actions={{
              sessionId: summary.id,
              starred: view.starred,
              ...(view.otherBranch ? { readOnly: true } : {}),
            }}
          />
        </div>
        <div id="turn" sse-swap="turn" hx-swap="innerHTML">
          <Items
            items={view.turn}
            actions={{
              sessionId: summary.id,
              starred: view.starred,
              ...(view.otherBranch ? { readOnly: true } : {}),
            }}
          />
        </div>
      </div>
      <div id="notice" class="px-4" />
      {view.otherBranch ? null : (
        <Composer sessionId={summary.id} draft={draft} />
      )}
    </Shell>
  );
}
