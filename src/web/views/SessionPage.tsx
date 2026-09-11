import { formatContextUsage } from "@core/context-usage";
import type { ContextUsage } from "@core/context-usage";
import type { NewSessionView, SessionView, SidebarView } from "@core/workspace";
import { Composer } from "./Composer.tsx";
import { FilePanelBody } from "./Files.tsx";
import { Rail } from "./Rail.tsx";
import { CustomPanel, ExtensionDialog } from "./Extensions.tsx";
import { Shelf } from "./Shelf.tsx";
import {
  CompactIcon,
  ContextGaugeIcon,
  HamburgerIcon,
  HistoryIcon,
  PanelLeftIcon,
  PanelRightIcon,
  RefreshIcon,
  StopCompactionIcon,
  SystemPromptIcon,
  WrenchIcon,
} from "./icons.tsx";
import {
  type ItemActions,
  Items,
  LoadEarlier,
  TurnFragment,
} from "./Items.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { Status } from "./Status.tsx";
import { DialogHost, MissingFolderNotice, TrustBadge } from "./Dialogs.tsx";

// The application shell, with pi-web's DOM: the sidebar column, the 36px top
// bar, the chat window with its rail, and the right-hand file panel. The
// inline styles are pi-web's own (components/AppShell.tsx), kebab-cased;
// everything with a class name is styled by src/web/styles/globals.css.

/** pi-web's top bar and both panel headers are exactly this tall. */
const BAR_HEIGHT = "calc(36px + env(safe-area-inset-top))";

const TOP_BAR_BUTTON =
  "display:flex; align-items:center; justify-content:center; gap:6px;" +
  " height:100%; padding:0 12px; background:none; border:none;" +
  " border-top:2px solid transparent; border-right:1px solid var(--border);" +
  " color:var(--text-muted); cursor:pointer; flex-shrink:0; font-size:11px;" +
  " white-space:nowrap; text-decoration:none;" +
  " transition:color 0.1s, background 0.1s";

const ICON_BUTTON_36 =
  "display:flex; align-items:center; justify-content:center; width:36px;" +
  " height:36px; padding:0; background:none; border:none;" +
  " color:var(--text-muted); cursor:pointer; flex-shrink:0;" +
  " transition:color 0.12s, background 0.12s";

/** The panel one of the top-bar buttons opens, one at a time. */
function TopPanelHost() {
  return (
    <div
      id="top-panel"
      style={`position:fixed; left:0; top:${BAR_HEIGHT}; width:100%; max-height:calc(100dvh - 36px); overflow-y:auto; z-index:500`}
      hidden
    />
  );
}

function TopBar({
  sessionId,
  usage,
  files,
  cwd,
  trust,
}: {
  sessionId?: string;
  usage?: ContextUsage;
  /** False when this session has no folder to show files from. */
  files?: boolean;
  cwd?: string;
  trust?: { requiresTrust: boolean; trusted: boolean };
}) {
  return (
    <div id="top-bar" style="flex-shrink:0; background:var(--bg-panel)">
      <div
        style={`display:flex; align-items:center; position:relative; border-bottom:1px solid var(--border); height:${BAR_HEIGHT}; padding-top:env(safe-area-inset-top)`}
      >
        <button
          type="button"
          id="sidebar-toggle"
          style={`${ICON_BUTTON_36}; border-right:1px solid var(--border)`}
          aria-controls="session-sidebar"
          aria-expanded="true"
          title="Toggle the sidebar"
          aria-label="Toggle the sidebar"
        >
          <span data-sidebar-open-icon>
            <PanelLeftIcon />
          </span>
          <span data-sidebar-closed-icon hidden>
            <HamburgerIcon />
          </span>
        </button>
        {trust === undefined || cwd === undefined ? null : (
          <TrustBadge cwd={cwd} status={trust} />
        )}
        {sessionId === undefined ? null : (
          <div style="display:flex; align-items:stretch; height:100%">
            <a
              style={TOP_BAR_BUTTON}
              href={`/sessions/${sessionId}/export`}
              target="_blank"
              rel="noreferrer"
              title="The whole conversation as one page"
            >
              <HistoryIcon />
              Full history
            </a>
            <button
              type="button"
              style={TOP_BAR_BUTTON}
              data-top-panel="system"
              aria-expanded="false"
              title="The prompt this session runs with"
              hx-get={`/sessions/${sessionId}/system-prompt`}
              hx-target="#top-panel"
              hx-swap="innerHTML"
            >
              <SystemPromptIcon />
              System
            </button>
            <button
              type="button"
              style={TOP_BAR_BUTTON}
              data-top-panel="tools"
              aria-expanded="false"
              title="The tools this session may call"
              hx-get={`/sessions/${sessionId}/tools`}
              hx-target="#top-panel"
              hx-swap="innerHTML"
            >
              <WrenchIcon />
              Tools
            </button>
          </div>
        )}
        {sessionId === undefined ? (
          <span style="margin-left:auto" />
        ) : (
          <button
            type="button"
            id="stats-trigger"
            data-top-panel="stats"
            aria-expanded="false"
            style={`margin-left:auto; display:flex; align-items:center; justify-content:flex-end; min-width:0; gap:10px; padding:0 12px; height:100%; overflow:hidden; background:none; border:none; border-top:2px solid transparent; color:var(--text-muted); cursor:pointer; font-size:11px; white-space:nowrap; font-variant-numeric:tabular-nums; transition:color 0.1s, background 0.1s`}
            title="Session info"
            hx-get={`/sessions/${sessionId}/stats`}
            hx-target="#top-panel"
            hx-swap="innerHTML"
          >
            {/* TODO(shell): pi-web also shows ↑ input, ↓ output and ⟳ cache
                read here. SessionView carries no token totals yet; adding them
                to the view is what this row is waiting for. */}
            <ContextReadout usage={usage} />
          </button>
        )}
        {sessionId === undefined ? null : (
          <>
            <button
              type="button"
              class="context-compact-button"
              title="Compact the conversation"
              aria-label="Compact the conversation"
              hx-post={`/sessions/${sessionId}/compact`}
              hx-swap="none"
            >
              <CompactIcon />
            </button>
            <button
              type="button"
              class="context-compact-button"
              data-compacting
              title="Stop compacting"
              aria-label="Stop compacting"
              hx-post={`/sessions/${sessionId}/compact/abort`}
              hx-swap="none"
              hidden
            >
              <StopCompactionIcon />
            </button>
          </>
        )}
        <button
          type="button"
          class="page-refresh-button"
          id="page-refresh"
          title="Reload the page"
          aria-label="Reload the page"
        >
          <RefreshIcon />
        </button>
        {sessionId === undefined || files !== true ? null : (
          <button
            type="button"
            id="file-panel-toggle"
            style={`${ICON_BUTTON_36}; border-left:1px solid var(--border)`}
            aria-controls="file-panel"
            aria-expanded="false"
            title="Files"
            aria-label="Files"
          >
            <PanelRightIcon />
          </button>
        )}
        <TopPanelHost />
      </div>
    </div>
  );
}

/** The context gauge in the top bar; red, amber or plain by threshold. */
function ContextReadout({ usage }: { usage?: ContextUsage }) {
  const text = usage ? formatContextUsage(usage) : "";
  if (!usage || text === "") {
    return <span style="color:var(--text-dim)">Session info</span>;
  }
  const colour =
    usage.level === "critical"
      ? "var(--danger)"
      : usage.level === "warn"
        ? "rgba(234,179,8,0.95)"
        : "var(--text-muted)";
  return (
    <span
      style={`display:flex; align-items:center; gap:4px; color:${colour}`}
      data-context-readout
    >
      <ContextGaugeIcon />
      {text}
    </span>
  );
}

function Shell({
  sidebar,
  activeId,
  cwd,
  home,
  usage,
  trust,
  children,
  panel,
}: {
  sidebar: SidebarView;
  activeId?: string;
  /** The folder on screen: the document title is built from it. */
  cwd?: string;
  /** The reader's home folder: the workspace pill shortens paths with it. */
  home?: string;
  usage?: ContextUsage;
  trust?: { requiresTrust: boolean; trusted: boolean };
  children?: unknown;
  /** The right-hand file panel, on a session page. */
  panel?: unknown;
}) {
  return (
    <div style="display:flex; width:100%; height:100%; padding-left:env(safe-area-inset-left); padding-right:env(safe-area-inset-right); overflow:hidden; background:var(--bg)">
      <div
        class="sidebar-overlay-backdrop sidebar-mobile-pending"
        style="position:fixed; inset:0; z-index:199; background:rgba(0,0,0,0.4); opacity:0; pointer-events:none; transition:opacity 0.25s ease"
      />
      <div
        id="session-sidebar"
        class="sidebar-container sidebar-open sidebar-mobile-pending"
        style="background:var(--bg-panel); border-right:1px solid var(--border); display:flex; flex-direction:column; flex-shrink:0; padding-top:env(safe-area-inset-top); padding-bottom:env(safe-area-inset-bottom); z-index:200"
      >
        <Sidebar
          view={sidebar}
          {...(activeId === undefined ? {} : { activeId })}
          {...(cwd === undefined ? {} : { cwd })}
          {...(home === undefined ? {} : { home })}
        />
      </div>
      <div
        class="panel-resize-handle sidebar-resize-handle"
        role="separator"
        tabindex={0}
        aria-orientation="vertical"
        aria-controls="session-sidebar"
        aria-valuemin={180}
        aria-valuemax={480}
        data-resize-handle="sidebar"
        title="Resize the sidebar"
        aria-label="Resize the sidebar"
      />
      <div style="flex:1; display:flex; flex-direction:column; overflow:hidden; min-width:0">
        <TopBar
          {...(activeId === undefined ? {} : { sessionId: activeId })}
          {...(usage === undefined ? {} : { usage })}
          {...(cwd === undefined ? {} : { cwd })}
          {...(trust === undefined ? {} : { trust })}
          files={panel !== undefined}
        />
        <main
          style="flex:1; overflow:hidden; position:relative"
          data-session-id={activeId}
          data-cwd={cwd}
          hx-ext="sse"
          sse-connect={activeId ? `/sessions/${activeId}/events` : undefined}
        >
          {children}
          {/* pi-web floats notices over the transcript, clear of the rail. */}
          <div class="chat-notices">
            <div id="toasts" sse-swap="notice" hx-swap="beforeend" />
          </div>
          <DialogHost />
        </main>
      </div>
      <div class="right-panel-overlay-backdrop" aria-hidden="true" />
      {panel === undefined ? null : (
        <>
          <div
            class="panel-resize-handle right-panel-resize-handle"
            role="separator"
            tabindex={0}
            aria-orientation="vertical"
            aria-controls="file-panel"
            aria-valuemin={300}
            aria-valuemax={1200}
            data-resize-handle="right-panel"
            title="Resize the file panel"
            aria-label="Resize the file panel"
          />
          {panel}
        </>
      )}
    </div>
  );
}

/** The right panel: pi-web's container, with the files area's body inside. */
function FilePanel({ sessionId }: { sessionId: string }) {
  return (
    <div
      id="file-panel"
      class="right-panel-container right-panel-closed"
      data-session={sessionId}
      style="display:flex; flex-direction:column; border-left:1px solid var(--border); background:var(--bg)"
    >
      <div
        style={`display:flex; align-items:center; flex-shrink:0; height:${BAR_HEIGHT}; padding-top:env(safe-area-inset-top); background:var(--bg-panel); border-bottom:1px solid var(--border)`}
      >
        <div style="flex:1; overflow:hidden">
          <div id="file-tabs" class="file-tabs" role="tablist" hidden />
        </div>
        <button
          type="button"
          id="file-panel-close"
          style={`${ICON_BUTTON_36}; background:var(--bg-selected); border-left:1px solid var(--border); color:var(--text)`}
          title="Hide the file panel"
          aria-label="Hide the file panel"
        >
          <PanelRightIcon />
        </button>
      </div>
      <div style="flex:1; overflow:hidden; padding-bottom:env(safe-area-inset-bottom)">
        <FilePanelBody />
      </div>
    </div>
  );
}

export function IndexPage({
  sidebar,
  cwd,
  home,
}: {
  sidebar: SidebarView;
  cwd?: string;
  home?: string;
}) {
  return (
    <Shell
      sidebar={sidebar}
      {...(cwd === undefined ? {} : { cwd })}
      {...(home === undefined ? {} : { home })}
    >
      {/* §2.5: nothing selected yet — the arrow points at the sidebar. */}
      <div style="height:100%; display:flex; align-items:center; justify-content:center; color:var(--text-muted); font-size:15px">
        Select a session to view the conversation
      </div>
    </Shell>
  );
}

export function NewSessionPage({
  sidebar,
  view,
  draft,
  home,
}: {
  sidebar: SidebarView;
  view: NewSessionView;
  draft?: string;
  home?: string;
}) {
  return (
    <Shell
      sidebar={sidebar}
      cwd={view.cwd}
      trust={view.trust}
      {...(home === undefined ? {} : { home })}
    >
      <section class="chat-window is-empty" aria-label="Messages">
        <div class="chat-body">
          <div class="chat-scroll">
            <div class="chat-scroll-content">
              <div class="chat-transcript">
                <header class="chat-empty">
                  <h1>
                    <span aria-hidden="true">π</span>
                    <span>Pi Web</span>
                  </h1>
                </header>
              </div>
            </div>
          </div>
        </div>
        <footer class="chat-composer">
          {view.available ? (
            <Composer cwd={view.cwd} draft={draft} start={view} />
          ) : (
            <div
              class="project-folder-message"
              role="status"
              style="padding:12px 16px; color:var(--text-muted); font-size:12px"
            >
              That folder is gone. Pick another one to start a session.
            </div>
          )}
        </footer>
      </section>
    </Shell>
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
  trust,
  home,
}: {
  sidebar: SidebarView;
  view: SessionView;
  draft?: string;
  trust?: { requiresTrust: boolean; trusted: boolean };
  home?: string;
}) {
  const { summary } = view;
  const leafId = view.leaves.find((leaf) => leaf.current)?.id;
  // A session whose folder is gone stays readable: only the actions that
  // would run the agent in it disappear.
  const missingFolder = summary.cwdAvailable === false;
  const actions: ItemActions = {
    sessionId: summary.id,
    cwd: summary.cwd,
    starred: view.starred,
    ...(view.otherBranch || missingFolder ? { readOnly: true } : {}),
  };
  return (
    <Shell
      sidebar={sidebar}
      activeId={summary.id}
      cwd={summary.cwd}
      usage={view.usage}
      {...(home === undefined ? {} : { home })}
      {...(trust === undefined ? {} : { trust })}
      {...(missingFolder
        ? {}
        : { panel: <FilePanel sessionId={summary.id} /> })}
    >
      <section
        class="chat-window"
        aria-label="Messages"
        style="--expanded-conversation-rail-width:36px"
      >
        <div class="chat-body">
          <div id="log" class="chat-scroll">
            <div class="chat-scroll-content">
              <div class="chat-transcript">
                <span hidden data-page-title>
                  {pageTitle(view)}
                </span>
                {view.otherBranch ? (
                  <div class="branch-sync-notice" role="status">
                    <span>
                      Viewing another branch of this session, read only.
                    </span>
                    <button
                      type="button"
                      class="history-action"
                      hx-post={`/sessions/${summary.id}/navigate`}
                      hx-vals={JSON.stringify({ entryId: leafId })}
                      hx-target="body"
                      hx-swap="innerHTML"
                    >
                      Continue from here
                    </button>
                  </div>
                ) : null}
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
            </div>
          </div>
          <button
            type="button"
            id="jump-to-latest"
            class="chat-jump-to-latest"
            aria-label="Jump to the latest message"
            title="Jump to the latest message"
            hidden
          >
            ↓
          </button>
          {/* The rail column of pi-web's two-column chat body. pi-web puts
              the surface on the element itself (§5), not in a class. */}
          <div
            id="rail-column"
            class="chat-minimap"
            role="navigation"
            aria-label="Conversation map"
            style="width:36px; flex-shrink:0; position:relative; cursor:pointer; user-select:none; border-left:1px solid var(--border); background:var(--bg-panel)"
          >
            <Rail view={view} />
          </div>
        </div>
        <footer class="chat-composer">
          {/* TODO(composer): pi-web has no status row — the readout moved into
              the top bar (gap C10). It stays until the composer carries its
              own token and t/s line. */}
          <div id="status" sse-swap="status" hx-swap="innerHTML">
            <Status view={view} />
          </div>
          {missingFolder ? (
            <MissingFolderNotice cwd={summary.cwd} />
          ) : view.otherBranch ? null : (
            <Composer sessionId={summary.id} cwd={summary.cwd} draft={draft} />
          )}
          <Shelf status={view.status} />
        </footer>
      </section>
      <CustomPanel sessionId={summary.id} frame={view.status?.custom ?? null} />
      <ExtensionDialog
        sessionId={summary.id}
        dialog={view.status?.dialog ?? null}
      />
      {/* Text an extension asked to put in the composer arrives here. */}
      <div id="editor-insert" sse-swap="editor" hx-swap="innerHTML" hidden />
      {/* One line of JSON per finished run: the tone and notifications. */}
      <div id="session-done" sse-swap="done" hx-swap="innerHTML" hidden />
    </Shell>
  );
}
