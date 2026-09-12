import {
  formatCompactCount,
  formatContextTooltip,
  formatContextUsage,
} from "@core/context-usage";
import type { ContextUsage } from "@core/context-usage";
import type { ImageAttachment } from "@core/ports";
import type { SessionStats } from "@core/session-entries";
import type { NewSessionView, SessionView, SidebarView } from "@core/workspace";
import { Composer, DropZone } from "./Composer.tsx";
import { FilePanelBody } from "./Files.tsx";
import { Rail } from "./Rail.tsx";
import { CustomPanel, ExtensionDialog } from "./Extensions.tsx";
import { Shelf } from "./Shelf.tsx";
import {
  CacheReadIcon,
  CloseIcon,
  HamburgerIcon,
  HistoryIcon,
  JumpToLatestIcon,
  MoreDotsIcon,
  PanelLeftIcon,
  PanelRightIcon,
  RefreshIcon,
  StopCompactionIcon,
  SystemPromptIcon,
  TokenArrowIcon,
  WrenchIcon,
} from "./icons.tsx";
import {
  type ItemActions,
  Items,
  LoadEarlier,
  TurnFragment,
} from "./Items.tsx";
import { Sidebar } from "./Sidebar.tsx";
import {
  compactDisabled,
  CompactButton,
  ContextReadout,
  Status,
  turnBusy,
} from "./Status.tsx";
import { DialogHost, MissingFolderNotice, TrustBadge } from "./Dialogs.tsx";

// The application shell, with pi-web's DOM: the sidebar column, the 36px top
// bar, the chat window with its rail, and the right-hand file panel. The
// inline styles are pi-web's own (components/AppShell.tsx), kebab-cased;
// everything with a class name is styled by src/web/styles/globals.css.

/** The cumulative token totals the stats button reads. */
type SessionTokens = SessionStats["tokens"];

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
  tokens,
  cwd,
  trust,
  panels,
  compactOff,
}: {
  sessionId?: string;
  usage?: ContextUsage;
  /** Cumulative totals of the session, for the in / out / cache groups. */
  tokens?: SessionTokens;
  cwd?: string;
  trust?: { requiresTrust: boolean; trusted: boolean };
  /** What an attached session runs with: the two tabs tint their icons. */
  panels?: { system: boolean; tools: boolean };
  /** A read-only or busy session refuses to compact; the button dims. */
  compactOff?: boolean;
}) {
  const panelIcon = (lit: boolean) =>
    `display:flex; color:var(${lit ? "--accent" : "--text-dim"})`;
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
          title="Hide sidebar"
          aria-label="Hide sidebar"
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
        {/* Under 480px pi-web keeps the three tabs behind this button and
            slides them in over the bar (AppShell.tsx L1978-L2090); the media
            query in areas/shell.css is what hides it above that width. */}
        <button
          type="button"
          id="mobile-toolbar-more"
          style={`${ICON_BUTTON_36}; border-right:1px solid var(--border)`}
          aria-controls="top-bar-tabs"
          aria-expanded="false"
          title="More controls"
          aria-label="More controls"
        >
          <span data-more-closed-icon>
            <MoreDotsIcon size={17} />
          </span>
          <span data-more-open-icon hidden>
            <CloseIcon />
          </span>
        </button>
        {/* pi-web draws the group whenever the chat area does, so a page
            with no session yet still has it (AppShell.tsx L1224), with
            Full history disabled until there is a history to export. */}
        <div
          id="top-bar-tabs"
          style="display:flex; align-items:stretch; height:100%"
        >
          {sessionId === undefined ? (
            <button
              type="button"
              style={`${TOP_BAR_BUTTON}; color:var(--text-dim); cursor:not-allowed; opacity:0.45`}
              data-top-bar-tab
              disabled
              title="Full history is available after the session is saved"
              aria-label="Full history"
            >
              <HistoryIcon />
              <span>Full history</span>
            </button>
          ) : (
            <a
              style={TOP_BAR_BUTTON}
              data-top-bar-tab
              href={`/sessions/${sessionId}/export`}
              target="_blank"
              rel="noreferrer"
              title="Full history"
              aria-label="Full history"
            >
              <HistoryIcon />
              <span>Full history</span>
            </a>
          )}
          <button
            type="button"
            style={TOP_BAR_BUTTON}
            data-top-bar-tab
            data-top-panel="system"
            aria-pressed="false"
            title="System prompt"
            aria-label="System prompt"
            hx-get={
              sessionId === undefined
                ? "/panels/system"
                : `/sessions/${sessionId}/system-prompt`
            }
            hx-target="#top-panel"
            hx-swap="innerHTML"
          >
            {/* pi-web tints both icons with the accent once the session has
                told it what they hold, and leaves them dim until then
                (AppShell.tsx L1341, L1406). Only an attached session knows,
                which is why a stored one stays dim in pi-web too. */}
            <span data-panel-icon style={panelIcon(panels?.system === true)}>
              <SystemPromptIcon />
            </span>
            <span>System</span>
          </button>
          <button
            type="button"
            style={TOP_BAR_BUTTON}
            data-top-bar-tab
            data-top-panel="tools"
            aria-pressed="false"
            title="Tool definitions"
            aria-label="Tool definitions"
            hx-get={
              sessionId === undefined
                ? "/panels/tools"
                : `/sessions/${sessionId}/tools`
            }
            hx-target="#top-panel"
            hx-swap="innerHTML"
          >
            <span data-panel-icon style={panelIcon(panels?.tools === true)}>
              <WrenchIcon />
            </span>
            <span>Tools</span>
          </button>
        </div>
        {sessionId === undefined ? null : (
          <SessionStatsButton
            sessionId={sessionId}
            {...(usage === undefined ? {} : { usage })}
            {...(tokens === undefined ? {} : { tokens })}
          />
        )}
        {sessionId === undefined ? null : (
          <>
            <CompactButton
              sessionId={sessionId}
              {...(usage === undefined ? {} : { usage })}
              {...(compactOff === true ? { disabled: true } : {})}
            />
            <button
              type="button"
              class="context-compact-button"
              data-compacting="true"
              title="Stop compaction"
              aria-label="Stop compaction"
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
          title="Refresh page and reconnect"
          aria-label="Refresh page"
        >
          <RefreshIcon />
        </button>
        {/* pi-web renders the toggle unconditionally (AppShell.tsx L1674);
            with no stats cluster to push it, it takes the free space. */}
        <button
          type="button"
          id="file-panel-toggle"
          style={`${ICON_BUTTON_36}; border-left:1px solid var(--border)${sessionId === undefined ? "; margin-left:auto" : ""}`}
          aria-controls="file-panel"
          aria-expanded="false"
          title="Show file panel"
          aria-label="Show file panel"
        >
          <PanelRightIcon />
        </button>
        <TopPanelHost />
      </div>
      {/* pi-web gives the phone its own full-width warning row under the bar
          (AppShell.tsx); only one of the two is ever visible. */}
      {trust === undefined || cwd === undefined ? null : (
        <TrustBadge cwd={cwd} status={trust} banner />
      )}
    </div>
  );
}

/**
 * The stats cluster on the right of the bar: cumulative tokens, then the
 * context gauge. pi-web drops a group whose count is zero and puts the exact
 * numbers in the hover text (ui-map 2.3).
 */
function SessionStatsButton({
  sessionId,
  usage,
  tokens,
}: {
  sessionId: string;
  usage?: ContextUsage;
  tokens?: SessionTokens;
}) {
  const parts: string[] = [];
  if (tokens) {
    parts.push(
      `in: ${tokens.input.toLocaleString("en")}`,
      `out: ${tokens.output.toLocaleString("en")}`,
      `cache read: ${tokens.cacheRead.toLocaleString("en")}`,
      `cache write: ${tokens.cacheWrite.toLocaleString("en")}`,
    );
  }
  const context = usage === undefined ? "" : formatContextTooltip(usage);
  if (context !== "") parts.push(context);
  const readout = usage === undefined ? "" : formatContextUsage(usage);
  const empty = readout === "" && (tokens === undefined || tokens.input === 0);
  return (
    <button
      type="button"
      id="stats-trigger"
      class="mobile-session-stats"
      data-top-panel="stats"
      aria-pressed="false"
      style="margin-left:auto; display:flex; align-items:center; justify-content:flex-end; min-width:0; gap:10px; padding-left:12px; padding-right:12px; height:100%; overflow:hidden; background:none; border:none; border-top:2px solid transparent; color:var(--text-muted); cursor:pointer; font-size:11px; white-space:nowrap; font-variant-numeric:tabular-nums; transition:color 0.1s, background 0.1s"
      title={parts.length === 0 ? "Session info" : parts.join("  |  ")}
      aria-label="Session info"
      hx-get={`/sessions/${sessionId}/stats`}
      hx-target="#top-panel"
      hx-swap="innerHTML"
    >
      {tokens !== undefined && tokens.input > 0 ? (
        <span
          class="mobile-session-stat-io"
          style="display:flex; align-items:center; gap:4px"
        >
          <TokenArrowIcon direction="in" />
          {formatCompactCount(tokens.input)}
        </span>
      ) : null}
      {tokens !== undefined && tokens.output > 0 ? (
        <span
          class="mobile-session-stat-io"
          style="display:flex; align-items:center; gap:4px"
        >
          <TokenArrowIcon direction="out" />
          {formatCompactCount(tokens.output)}
        </span>
      ) : null}
      {tokens !== undefined && tokens.cacheRead > 0 ? (
        <span data-cache-read style="display:flex; align-items:center; gap:4px">
          <CacheReadIcon />
          {formatCompactCount(tokens.cacheRead)}
        </span>
      ) : null}
      <ContextReadout
        {...(usage === undefined ? {} : { usage })}
        empty={empty}
      />
    </button>
  );
}

export function Shell({
  sidebar,
  activeId,
  cwd,
  home,
  usage,
  tokens,
  trust,
  panels,
  compactOff,
  children,
  overlay,
}: {
  sidebar: SidebarView;
  activeId?: string;
  /** The folder on screen: the document title is built from it. */
  cwd?: string;
  /** The reader's home folder: the workspace pill shortens paths with it. */
  home?: string;
  usage?: ContextUsage;
  tokens?: SessionTokens;
  trust?: { requiresTrust: boolean; trusted: boolean };
  panels?: { system: boolean; tools: boolean };
  compactOff?: boolean;
  children?: unknown;
  /** An overlay over the whole shell: the settings dialog. */
  overlay?: unknown;
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
          {...(tokens === undefined ? {} : { tokens })}
          {...(cwd === undefined ? {} : { cwd })}
          {...(trust === undefined ? {} : { trust })}
          {...(panels === undefined ? {} : { panels })}
          {...(compactOff === true ? { compactOff } : {})}
        />
        <main
          style="flex:1; overflow:hidden; position:relative"
          data-session-id={activeId}
          data-cwd={cwd}
          hx-sse:connect={activeId ? `/sessions/${activeId}/events` : undefined}
          hx-trigger="web-pi:sse-start"
          hx-swap="none"
        >
          {children}
          {/* pi-web floats notices over the transcript, clear of the rail. */}
          <div class="chat-notices">
            <div id="toasts" />
          </div>
          <DialogHost />
        </main>
      </div>
      <div class="right-panel-overlay-backdrop" aria-hidden="true" />
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
      <FilePanel
        {...(activeId === undefined ? {} : { sessionId: activeId })}
        {...(cwd === undefined ? {} : { cwd })}
      />
      {overlay}
    </div>
  );
}

/**
 * The right panel: pi-web's container, with the files area's body inside.
 * pi-web keeps it mounted (collapsed) on every route, so the files it lists
 * come from the open session's folder, else from the folder that is picked.
 */
function FilePanel({ sessionId, cwd }: { sessionId?: string; cwd?: string }) {
  return (
    <div
      id="file-panel"
      class="right-panel-container right-panel-closed"
      data-session={sessionId ?? ""}
      data-cwd={cwd ?? ""}
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
          title="Hide file panel"
          aria-label="Hide file panel"
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
  overlay,
}: {
  sidebar: SidebarView;
  cwd?: string;
  home?: string;
  overlay?: unknown;
}) {
  return (
    <Shell
      sidebar={sidebar}
      {...(cwd === undefined ? {} : { cwd })}
      {...(home === undefined ? {} : { home })}
      {...(overlay === undefined ? {} : { overlay })}
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
  overlay,
}: {
  sidebar: SidebarView;
  view: NewSessionView;
  draft?: string;
  home?: string;
  overlay?: unknown;
}) {
  return (
    <Shell
      sidebar={sidebar}
      cwd={view.cwd}
      trust={view.trust}
      {...(home === undefined ? {} : { home })}
      {...(overlay === undefined ? {} : { overlay })}
    >
      <section class="chat-window is-empty" aria-label="Messages">
        <DropZone />
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
  images,
  trust,
  home,
  overlay,
}: {
  sidebar: SidebarView;
  view: SessionView;
  draft?: string;
  images?: ImageAttachment[];
  trust?: { requiresTrust: boolean; trusted: boolean };
  home?: string;
  overlay?: unknown;
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
    ...(turnBusy(view.status) ? { busy: true } : {}),
  };
  return (
    <Shell
      sidebar={sidebar}
      activeId={summary.id}
      cwd={summary.cwd}
      usage={view.usage}
      {...(home === undefined ? {} : { home })}
      tokens={view.tokens}
      {...(view.status === null
        ? {}
        : {
            panels: {
              system: view.status.hasSystemPrompt,
              tools: view.status.hasActiveTools,
            },
          })}
      {...(compactDisabled(view) ? { compactOff: true } : {})}
      {...(trust === undefined ? {} : { trust })}
      {...(overlay === undefined ? {} : { overlay })}
    >
      <section
        class="chat-window"
        aria-label="Messages"
        style="--expanded-conversation-rail-width:36px"
      >
        <DropZone />
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
                <div id="messages">
                  {view.hasMore && view.oldestId !== undefined ? (
                    <LoadEarlier
                      sessionId={summary.id}
                      before={view.oldestId}
                      {...(view.leaf === undefined ? {} : { leaf: view.leaf })}
                    />
                  ) : null}
                  <Items items={view.items} actions={actions} />
                </div>
                <div id="turn">
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
            aria-label="Jump to latest"
            title="Jump to latest"
            hidden
          >
            <JumpToLatestIcon />
          </button>
          {/* The rail column of pi-web's two-column chat body. pi-web puts
              the surface on the element itself (§5), not in a class. */}
          <div
            id="rail-column"
            class="chat-minimap"
            role="navigation"
            aria-label="Conversation paths"
            style="width:36px; flex-shrink:0; position:relative; cursor:pointer; user-select:none; border-left:1px solid var(--border); background:var(--bg-panel)"
          >
            <Rail view={view} />
          </div>
        </div>
        <footer class="chat-composer">
          {missingFolder ? (
            <MissingFolderNotice />
          ) : view.otherBranch ? null : (
            <Composer
              sessionId={summary.id}
              cwd={summary.cwd}
              draft={draft}
              images={images}
              view={view}
              status={<Status view={view} />}
            />
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
      <div id="editor-insert" hidden />
    </Shell>
  );
}
