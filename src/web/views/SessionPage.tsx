import { relativeTime } from "@core/sessions";
import type { SessionView, SidebarView } from "@core/workspace";
import { Composer } from "./Composer.tsx";
import { FilePanel } from "./Files.tsx";
import { Rail } from "./Rail.tsx";
import { Shelf } from "./Shelf.tsx";
import {
  type ItemActions,
  Items,
  LoadEarlier,
  TurnFragment,
} from "./Items.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { Status } from "./Status.tsx";

function Shell({
  sidebar,
  activeId,
  children,
}: {
  sidebar: SidebarView;
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
          class="relative flex min-h-0 flex-1 flex-col"
          data-session-id={activeId}
          hx-ext="sse"
          sse-connect={activeId ? `/sessions/${activeId}/events` : undefined}
        >
          {children}
          <div
            id="toasts"
            class="pointer-events-none fixed right-4 bottom-24 z-50 flex w-80 flex-col gap-2"
            sse-swap="notice"
            hx-swap="beforeend"
          />
        </main>
      </div>
      <div class="drawer-side">
        <label
          for="nav-drawer"
          class="drawer-overlay"
          aria-label="Hide sessions"
        />
        <Sidebar view={sidebar} activeId={activeId} />
      </div>
    </div>
  );
}

export function IndexPage({ sidebar }: { sidebar: SidebarView }) {
  return (
    <Shell sidebar={sidebar}>
      <div class="m-auto text-base-content/60">
        Pick a session or start a new one.
      </div>
    </Shell>
  );
}

export function NewSessionPage({
  sidebar,
  cwd,
  draft,
}: {
  sidebar: SidebarView;
  cwd: string;
  draft?: string;
}) {
  return (
    <Shell sidebar={sidebar}>
      <div class="m-auto px-4 text-base-content/60">
        New session. Type the first request below.
      </div>
      <Composer cwd={cwd} draft={draft} />
    </Shell>
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
  sidebar,
  view,
  draft,
}: {
  sidebar: SidebarView;
  view: SessionView;
  draft?: string;
}) {
  const { summary } = view;
  const leafId = view.leaves.find((leaf) => leaf.current)?.id;
  const actions: ItemActions = {
    sessionId: summary.id,
    cwd: summary.cwd,
    starred: view.starred,
    ...(view.otherBranch ? { readOnly: true } : {}),
  };
  return (
    <Shell sidebar={sidebar} activeId={summary.id}>
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
              id="stats-trigger"
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
          <button
            type="button"
            id="file-panel-toggle"
            class="btn btn-ghost btn-xs"
            aria-controls="file-panel"
            aria-expanded="false"
          >
            Files
          </button>
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
      <div class="flex min-h-0 flex-1">
        <div id="log" class="relative min-h-0 flex-1 overflow-y-auto px-4">
          <div id="messages" sse-swap="settled" hx-swap="beforeend">
            {view.hasMore && view.oldestId !== undefined ? (
              <LoadEarlier
                sessionId={summary.id}
                before={view.oldestId}
                {...(view.leaf === undefined ? {} : { leaf: view.leaf })}
              />
            ) : null}
            <Items items={view.items} actions={actions} />
          </div>
          <div id="turn" sse-swap="turn" hx-swap="innerHTML">
            <TurnFragment
              items={view.turn}
              actions={actions}
              status={view.status}
            />
          </div>
        </div>
        <div id="rail-column" class="pr-2">
          <Rail view={view} />
        </div>
        <FilePanel sessionId={summary.id} cwd={summary.cwd} />
      </div>
      <button
        type="button"
        id="jump-to-latest"
        class="btn absolute right-6 bottom-32 z-20 btn-circle shadow btn-sm"
        aria-label="Jump to the latest message"
        title="Jump to the latest message"
        hidden
      >
        ↓
      </button>
      <div
        id="status"
        class="border-t border-base-300 px-4 py-2"
        sse-swap="status"
        hx-swap="innerHTML"
      >
        <Status view={view} />
      </div>
      <p
        id="branch-sync"
        class="htmx-indicator px-4 py-1 text-xs text-base-content/60"
        role="status"
      >
        Loading branch history. Sending is paused.
      </p>
      {view.otherBranch ? null : (
        <Composer sessionId={summary.id} cwd={summary.cwd} draft={draft} />
      )}
      <Shelf status={view.status} />
    </Shell>
  );
}
