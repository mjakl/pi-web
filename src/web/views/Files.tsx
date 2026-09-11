import {
  baseName,
  extensionOf,
  formatBytes,
  hasPreview,
} from "@core/file-types";
import { frontmatterCard, parseFrontmatter } from "@core/frontmatter";
import { type GitFileStatus, statusLabel } from "@core/git-status";
import { type UnifiedRow, unifiedRows } from "@core/patch";
import type { GitChangeFile, GitStatus } from "@core/ports";
import { directoryWithin } from "@core/path-access";
import type { FileView } from "@core/workspace";
import { escapeHtml, rawFileUrl, renderMarkdown } from "@web/markdown";
import { highlightLines } from "@web/syntax";
import {
  DirectoryLoadingIcon,
  DownloadIcon,
  FileIcon,
  FolderIcon,
  MentionIcon,
  SmallChevronIcon,
  WrapLinesIcon,
} from "@web/views/icons";
import { raw } from "hono/html";

// The explorer tree, the working tree's changes, and one viewer per open tab,
// in pi-web's markup: components/FileExplorer.tsx and components/FileViewer.tsx
// are the spec, down to the inline styles, so its stylesheets apply unchanged.
// Everything here is server-rendered; the browser only keeps which tabs are
// open and how each is scrolled.

/** Paths are joined POSIX-style; the policy compares them segment by segment. */
function childPath(directory: string, name: string): string {
  return `${directory.replace(/[\\/]+$/, "")}/${name}`;
}

function relativeTo(cwd: string, path: string): string {
  if (cwd !== "" && path.length > cwd.length && directoryWithin(cwd, path)) {
    return path.slice(cwd.length).replace(/^[\\/]/, "");
  }
  return path;
}

/** pi-web's Git badge colours (FileExplorer.tsx:L98-L105). */
const STATUS_COLOUR: Record<GitFileStatus, string> = {
  M: "var(--warning)",
  A: "var(--success)",
  D: "var(--danger)",
  R: "#60a5fa",
  U: "var(--success)",
  C: "var(--danger)",
};

// `display` and the centring live in the stylesheet, not here: an inline
// style would outrank the rule that takes the badge away on hover.
const BADGE_STYLE =
  "width:14px; height:14px; flex-shrink:0; font-family:var(--font-mono); font-size:11px; font-weight:600";

const ROW_NAME_STYLE =
  "font-size:12px; color:var(--text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1";

/** The hover buttons sit on top of the row, so both are absolutely placed. */
const HOVER_ACTION_STYLE =
  "position:absolute; top:50%; transform:translateY(-50%); gap:4px; height:20px; background:var(--bg-panel); border:1px solid var(--border); border-radius:4px; cursor:pointer; font-size:11px; font-weight:600; white-space:nowrap";

function GitStatusBadge({ status }: { status: GitFileStatus }) {
  const label = statusLabel(status);
  return (
    <span
      class="file-tree-badge"
      title={label}
      aria-label={label}
      style={`${BADGE_STYLE}; color:${STATUS_COLOUR[status]}`}
    >
      {status}
    </span>
  );
}

export type TreeContext = {
  /** Absent until a session is open: the folder alone roots the requests. */
  sessionId?: string;
  cwd: string;
  /** Absolute paths Git reports as changed, with their letter. */
  changes: Map<string, GitChangeFile>;
};

/** How a files request names its folder: by session, else by path. */
export function scopeQuery(context: TreeContext): string {
  return context.sessionId === undefined
    ? `cwd=${encodeURIComponent(context.cwd)}`
    : `session=${encodeURIComponent(context.sessionId)}`;
}

function changedUnder(context: TreeContext, directory: string): boolean {
  for (const path of context.changes.keys()) {
    if (directoryWithin(directory, path)) return true;
  }
  return false;
}

/** Put the path into the composer, or download the file: hover only. */
function RowActions({
  sessionId,
  cwd,
  path,
  isDir,
}: {
  sessionId?: string;
  cwd: string;
  path: string;
  isDir: boolean;
}) {
  const relative = relativeTo(cwd, path);
  return (
    <>
      <button
        type="button"
        class="file-tree-action"
        title="Insert path into chat"
        aria-label="Insert path into chat"
        data-mention={relative}
        {...(isDir ? { "data-mention-dir": "1" } : {})}
        style={`${HOVER_ACTION_STYLE}; right:${isDir ? "4px" : "28px"}; padding:0 8px; color:var(--accent)`}
      >
        <MentionIcon size={11} />
        mention
      </button>
      {isDir ? null : (
        <a
          class="file-tree-action"
          title="Download file"
          aria-label="Download file"
          href={`${rawFileUrl(path, sessionId)}&download=1`}
          download
          style={`${HOVER_ACTION_STYLE}; right:4px; padding:0 5px; color:var(--text-muted); text-decoration:none`}
        >
          <DownloadIcon size={11} />
        </a>
      )}
    </>
  );
}

/**
 * One row of the tree, with the subtree it opens. A directory fetches its
 * children the first time it is expanded, which is what `hx-trigger="expand"`
 * on the node waits for; pi-web fetches them from the same click.
 */
function TreeNode({
  context,
  path,
  name,
  isDir,
  depth,
  nodes,
  open,
}: {
  context: TreeContext;
  path: string;
  name: string;
  isDir: boolean;
  depth: number;
  /** Already-known children (search results arrive expanded). */
  nodes?: SearchNode[];
  open?: boolean;
}) {
  const change = context.changes.get(path);
  const marked = isDir && (change !== undefined || changedUnder(context, path));
  const query = `path=${encodeURIComponent(path)}&${scopeQuery(context)}&depth=${String(depth + 1)}`;
  return (
    <div
      class="file-tree-node"
      role="treeitem"
      tabindex={-1}
      data-path={path}
      data-name={name}
      {...(isDir
        ? {
            "data-dir": "1",
            "aria-expanded": open === true ? "true" : "false",
            ...(nodes === undefined
              ? {
                  "hx-get": `/files/tree?${query}`,
                  "hx-trigger": "expand once",
                  "hx-target": "find [data-children]",
                  "hx-swap": "innerHTML",
                }
              : {}),
          }
        : {})}
    >
      <div
        class="file-tree-row"
        style={`position:relative; display:flex; align-items:center; gap:4px; padding-left:${String(8 + depth * 14)}px; padding-right:8px; height:24px; cursor:pointer; border-radius:4px; user-select:none`}
      >
        {isDir ? (
          <span
            class="file-tree-chevron"
            style="display:flex; flex-shrink:0; color:var(--text-dim); transition:transform 0.1s"
          >
            <SmallChevronIcon size={10} />
          </span>
        ) : (
          <span style="width:10px; flex-shrink:0" />
        )}
        <span style="flex-shrink:0; display:flex; align-items:center">
          {isDir ? (
            <FolderIcon size={14} open={open === true} />
          ) : (
            <FileIcon name={name} size={14} />
          )}
        </span>
        <span style={ROW_NAME_STYLE} title={path}>
          {name}
        </span>
        {!isDir && change ? <GitStatusBadge status={change.status} /> : null}
        {marked ? (
          <span
            class="file-tree-badge"
            title="Contains changed files"
            aria-label="Contains changed files"
            style="width:14px; height:14px; flex-shrink:0"
          >
            <span style="width:6px; height:6px; border-radius:50%; background:var(--warning)" />
          </span>
        ) : null}
        {isDir && nodes === undefined ? (
          <span class="file-tree-loading">
            <DirectoryLoadingIcon size={10} />
          </span>
        ) : null}
        <RowActions
          {...(context.sessionId === undefined
            ? {}
            : { sessionId: context.sessionId })}
          cwd={context.cwd}
          path={path}
          isDir={isDir}
        />
      </div>
      {isDir ? (
        <div
          role="group"
          data-children
          {...(open === true ? {} : { hidden: true })}
        >
          {nodes === undefined ? null : (
            <SearchNodes context={context} nodes={nodes} depth={depth + 1} />
          )}
        </div>
      ) : null}
    </div>
  );
}

/** One directory's children. Fetched again for each node that is opened. */
export function TreeNodes({
  context,
  directory,
  entries,
  depth,
}: {
  context: TreeContext;
  directory: string;
  entries: { name: string; isDir: boolean }[];
  depth: number;
}) {
  if (entries.length === 0) {
    return (
      <div
        style={`padding-left:${String(8 + depth * 14)}px; font-size:11px; color:var(--text-dim); height:22px; display:flex; align-items:center`}
      >
        empty
      </div>
    );
  }
  return (
    <>
      {entries.map((entry) => (
        <TreeNode
          context={context}
          path={childPath(directory, entry.name)}
          name={entry.name}
          isDir={entry.isDir}
          depth={depth}
        />
      ))}
    </>
  );
}

/** The header line above the changed files: "N files  +N  -N". */
function ChangesHeader({ status }: { status: GitStatus }) {
  return (
    <div
      aria-label={`${String(status.files.length)} changed files, ${String(status.additions)} lines added, ${String(status.deletions)} lines deleted`}
      style="display:flex; align-items:center; gap:6px; height:24px; padding:0 10px; font-size:12px"
    >
      <span style="color:var(--text-dim)">
        {String(status.files.length)} files
      </span>
      <span style="color:var(--success); font-family:var(--font-mono)">
        +{String(status.additions)}
      </span>
      <span style="color:var(--danger); font-family:var(--font-mono)">
        -{String(status.deletions)}
      </span>
    </div>
  );
}

function ChangeRow({
  context,
  file,
}: {
  context: TreeContext;
  file: GitChangeFile;
}) {
  return (
    <div
      class="file-explorer-change-row"
      role="treeitem"
      tabindex={-1}
      title={file.path}
      data-file-path={file.path}
      data-file-mode="diff"
      style="display:flex; align-items:center; gap:6px; padding-left:10px; padding-right:8px; height:24px; cursor:pointer; border-radius:4px; user-select:none"
    >
      <GitStatusBadge status={file.status} />
      <span style="flex-shrink:0; display:flex; align-items:center; opacity:0.85">
        <FileIcon name={baseName(file.path)} size={13} />
      </span>
      <span style={ROW_NAME_STYLE}>{relativeTo(context.cwd, file.path)}</span>
    </div>
  );
}

/**
 * What the sidebar's explorer body holds. pi-web shows either the changes or
 * the tree, never both (`changesCollapsed` in FileExplorer.tsx), and the
 * search results take the same place while a query is open. All three keep the
 * id so the next swap lands in the same spot.
 */
export function Explorer({
  context,
  status,
  entries,
  changes,
}: {
  context: TreeContext;
  status: GitStatus;
  entries: { name: string; isDir: boolean }[];
  changes: boolean;
}) {
  const count = status.isRepository ? status.files.length : 0;
  if (changes && count > 0) {
    return (
      <div
        id="file-tree"
        role="tree"
        aria-label="Changed files"
        data-changes={String(count)}
        style="padding:0 4px 2px"
      >
        <ChangesHeader status={status} />
        {status.files.map((file) => (
          <ChangeRow context={context} file={file} />
        ))}
      </div>
    );
  }
  return (
    <div
      id="file-tree"
      role="tree"
      aria-label="Files"
      data-changes={String(count)}
      style="padding:2px 4px"
    >
      {entries.length === 0 ? (
        <div style="padding:8px 12px; font-size:11px; color:var(--text-dim)">
          No files found
        </div>
      ) : (
        <TreeNodes
          context={context}
          directory={context.cwd}
          entries={entries}
          depth={0}
        />
      )}
    </div>
  );
}

type SearchNode = {
  name: string;
  path: string;
  isDir: boolean;
  children: SearchNode[];
};

/** Matches, folded back into the folders they came from (pi-web's tree). */
function searchTree(cwd: string, matches: string[]): SearchNode[] {
  const roots: SearchNode[] = [];
  for (const relative of matches) {
    const parts = relative.split("/").filter((part) => part !== "");
    let siblings = roots;
    let prefix = "";
    parts.forEach((part, index) => {
      prefix = prefix === "" ? part : `${prefix}/${part}`;
      const isDir = index < parts.length - 1;
      let node = siblings.find(
        (candidate) => candidate.name === part && candidate.isDir === isDir,
      );
      if (!node) {
        node = {
          name: part,
          path: childPath(cwd, prefix),
          isDir,
          children: [],
        };
        siblings.push(node);
      }
      siblings = node.children;
    });
  }
  return roots;
}

function SearchNodes({
  context,
  nodes,
  depth,
}: {
  context: TreeContext;
  nodes: SearchNode[];
  depth: number;
}) {
  return (
    <>
      {nodes.map((node) => (
        <TreeNode
          context={context}
          path={node.path}
          name={node.name}
          isDir={node.isDir}
          depth={depth}
          open={node.isDir}
          nodes={node.isDir ? node.children : undefined}
        />
      ))}
    </>
  );
}

/** Search hits, as a tree with every directory that holds one expanded. */
export function SearchResults({
  context,
  matches,
}: {
  context: TreeContext;
  matches: string[];
}) {
  return (
    <div
      id="file-tree"
      role="tree"
      aria-label="Search results"
      style="padding-top:3px"
    >
      {matches.length === 0 ? (
        <div style="padding:6px 2px; font-size:10px; color:var(--text-dim)">
          No matching files
        </div>
      ) : (
        <SearchNodes
          context={context}
          nodes={searchTree(context.cwd, matches)}
          depth={0}
        />
      )}
    </div>
  );
}

export type ViewMode = "source" | "preview" | "diff";

export function defaultMode(view: FileView, hint?: string): ViewMode {
  if (view.deleted) return "diff";
  if (hint === "diff" && view.diff !== undefined) return "diff";
  if (hint === "source") return "source";
  return hasPreview(view.path) && view.text !== undefined
    ? "preview"
    : "source";
}

/** pi-web's gutter: 48px of right-aligned tabular digits on the panel grey. */
const LINE_NUMBER_STYLE =
  "width:48px; min-width:48px; padding:0 10px; text-align:right; color:var(--text-dim); background:var(--bg-panel); border-right:1px solid var(--border); font-family:var(--font-mono); font-size:11px; font-style:normal; font-variant-numeric:tabular-nums; line-height:20.8px; user-select:none; flex-shrink:0; vertical-align:top";

const CODE_STYLE =
  "font-family:var(--font-mono); font-size:13px; line-height:1.6";

function SourceView({ view }: { view: FileView }) {
  const text = view.text ?? "";
  // pi-web counts the newline that ends the file as starting another line,
  // both in the gutter and in the toolbar's "N lines".
  const lines = text.split("\n");
  // Above a thousand lines the colouring costs more than it is worth, so the
  // text is printed plain, exactly as pi-web does. A file whose grammar is
  // not registered is escaped the same way, but it is not the big-file path.
  const lightweight = lines.length > 1000;
  const coloured = lightweight ? null : highlightLines(text, view.language);
  const rows = lines
    .map((line, index) => {
      const body = coloured?.[index] ?? escapeHtml(line);
      const number = String(index + 1);
      return `<span class="file-source-line" data-line-number="${number}" style="display:flex; min-width:100%"><span aria-hidden="true" style="${LINE_NUMBER_STYLE}">${number}</span><span class="file-source-line-content">${body}</span></span>`;
    })
    .join("");
  return (
    <div
      class={`file-source-view${lightweight ? " is-lightweight" : ""}`}
      style={`min-width:100%; min-height:100%; background:var(--bg); ${CODE_STYLE}`}
    >
      {raw(rows)}
    </div>
  );
}

function FrontmatterCard({ source }: { source: string }) {
  const card = frontmatterCard(parseFrontmatter(source).fields);
  if (
    card.title === undefined &&
    card.chips.length === 0 &&
    card.rest.length === 0
  ) {
    return <></>;
  }
  return (
    <div class="markdown-frontmatter">
      {card.title === undefined ? null : (
        <div class="markdown-frontmatter-title">{card.title}</div>
      )}
      {card.chips.length === 0 ? null : (
        <div class="markdown-frontmatter-tags">
          {card.chips.map((chip) => (
            <span class="markdown-frontmatter-tag">{chip}</span>
          ))}
        </div>
      )}
      {card.rest.length === 0 ? null : (
        <dl class="markdown-frontmatter-rows">
          {card.rest.map(([key, value]) => (
            <div class="markdown-frontmatter-row">
              <dt>{key}</dt>
              <dd>
                {/^(https?:\/\/|mailto:)/i.test(value) ? (
                  <a href={value} target="_blank" rel="noopener noreferrer">
                    {value}
                  </a>
                ) : (
                  value
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function DiffView({ rows }: { rows: UnifiedRow[] }) {
  // pi-web drops the @@ headers: the collapsed spans say what was skipped.
  const lines = rows.filter((row) => row.type !== "hunk");
  if (!lines.some((row) => row.type === "line" && row.kind !== "context")) {
    return (
      <div style="padding:12px 16px; font-size:12px; color:var(--text-dim); font-family:var(--font-mono)">
        No changes
      </div>
    );
  }
  return (
    <div
      class="file-diff-view"
      style={`width:max-content; min-width:100%; ${CODE_STYLE}`}
    >
      {lines.map((row) => {
        if (row.type === "collapsed") {
          return (
            <div style="padding:2px 16px; color:var(--text-dim); background:var(--bg-panel); font-size:11px; border-top:1px solid var(--border); border-bottom:1px solid var(--border)">
              ... {String(row.count)} unchanged lines ...
            </div>
          );
        }
        const tint =
          row.kind === "added"
            ? "rgba(0,200,80,0.12)"
            : row.kind === "removed"
              ? "rgba(240,60,60,0.14)"
              : "transparent";
        const edge =
          row.kind === "added"
            ? "var(--success)"
            : row.kind === "removed"
              ? "var(--danger)"
              : "transparent";
        const sign =
          row.kind === "added" ? "+" : row.kind === "removed" ? "-" : " ";
        return (
          <div
            class="file-diff-line"
            style={`display:flex; min-width:100%; background:${tint}; border-left:3px solid ${edge}`}
          >
            <span style={LINE_NUMBER_STYLE}>
              {row.lineNo === null ? "" : String(row.lineNo)}
            </span>
            <span
              style={`min-width:16px; padding:0 6px; color:${row.kind === "context" ? "var(--text-dim)" : edge}; user-select:none; flex-shrink:0; font-weight:600`}
            >
              {sign}
            </span>
            <span
              class="file-diff-line-content"
              style="flex-shrink:0; padding:0 8px 0 0; white-space:pre; color:var(--text)"
            >
              {row.text === "" ? " " : row.text}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** The toolbar every media viewer shares (FileViewer.tsx §7.4). */
function MediaToolbar({
  view,
  sessionId,
  label,
}: {
  view: FileView;
  sessionId: string;
  label: string;
}) {
  return (
    <div
      class="file-viewer-toolbar"
      style="display:flex; align-items:center; gap:12px; padding:4px 16px; border-bottom:1px solid var(--border); font-size:11px; color:var(--text-dim); background:var(--bg); flex-shrink:0"
    >
      <span
        class="file-viewer-path"
        style="font-family:var(--font-mono)"
        title={view.path}
      >
        {relativeTo(view.cwd, view.path)}
      </span>
      <span style="margin-left:auto">{label}</span>
      <span class="file-viewer-measured" />
      <span>{formatBytes(view.size)}</span>
      <span
        class="file-viewer-live"
        title="Not watching"
        style="display:flex; align-items:center; gap:4px; color:var(--text-dim); flex-shrink:0"
      >
        <span
          class="file-viewer-live-indicator"
          style="background:var(--border); display:inline-block; box-shadow:none"
        />
        <span class="file-viewer-live-label">static</span>
      </span>
      <DownloadLink path={view.path} sessionId={sessionId} />
    </div>
  );
}

function DownloadLink({
  path,
  sessionId,
}: {
  path: string;
  sessionId: string;
}) {
  return (
    <a
      class="file-viewer-icon-button"
      href={`${rawFileUrl(path, sessionId)}&download=1`}
      download={baseName(path)}
      title="Download file"
      aria-label="Download file"
    >
      <DownloadIcon size={14} />
    </a>
  );
}

function MediaViewer({
  view,
  sessionId,
}: {
  view: FileView;
  sessionId: string;
}) {
  const source = rawFileUrl(view.path, sessionId);
  const extension = extensionOf(view.path);
  if (view.kind === "image") {
    return (
      <>
        <MediaToolbar
          view={view}
          sessionId={sessionId}
          label={extension === "" ? "image" : extension}
        />
        <div
          class="file-viewer-media-body"
          style="flex:1; overflow:auto; background:var(--bg-panel); display:flex; align-items:center; justify-content:center; padding:16px; background-image:linear-gradient(45deg, var(--bg) 25%, transparent 25%), linear-gradient(-45deg, var(--bg) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--bg) 75%), linear-gradient(-45deg, transparent 75%, var(--bg) 75%); background-size:16px 16px; background-position:0 0, 0 8px, 8px -8px, -8px 0px"
        >
          <img
            src={source}
            alt={view.path}
            style="max-width:100%; max-height:100%; object-fit:contain; box-shadow:0 2px 8px rgba(0,0,0,0.15)"
          />
        </div>
      </>
    );
  }
  if (view.kind === "audio") {
    return (
      <>
        <MediaToolbar
          view={view}
          sessionId={sessionId}
          label={extension === "" ? "audio" : extension}
        />
        <div style="flex:1; display:flex; align-items:center; justify-content:center; padding:24px; background:var(--bg-panel)">
          <div style="width:min(680px, 100%)">
            {/* oxlint-disable-next-line jsx-a11y/media-has-caption */}
            <audio
              controls
              preload="metadata"
              src={source}
              style="width:100%"
            />
          </div>
        </div>
      </>
    );
  }
  const pdf = view.kind === "pdf";
  const url = pdf
    ? source
    : `/files/docx?path=${encodeURIComponent(view.path)}&session=${encodeURIComponent(sessionId)}`;
  return (
    <>
      <MediaToolbar
        view={view}
        sessionId={sessionId}
        label={pdf ? "pdf" : "docx preview"}
      />
      <div style="flex:1; min-height:0; background:var(--bg-panel)">
        <iframe
          src={url}
          {...(pdf ? {} : { sandbox: "allow-same-origin" })}
          title={`Preview ${baseName(view.path)}`}
          style={`width:100%; height:100%; border:none; background:${pdf ? "var(--bg)" : "#eef1f5"}`}
        />
      </div>
    </>
  );
}

function ViewerContent({
  view,
  mode,
  sessionId,
}: {
  view: FileView;
  mode: ViewMode;
  sessionId: string;
}) {
  if (mode === "diff") {
    return <DiffView rows={unifiedRows(view.diff ?? "")} />;
  }
  if (view.tooLarge === true) {
    return (
      <div style="height:100%; display:flex; align-items:center; justify-content:center; color:var(--text-muted); font-size:13px">
        This file is {formatBytes(view.size)}, above the 256 KB the viewer
        shows. Download it to read the whole thing.
      </div>
    );
  }
  const text = view.text ?? "";
  if (mode === "preview" && view.language === "html") {
    return (
      <iframe
        srcdoc={text}
        sandbox="allow-scripts"
        style="width:100%; height:100%; border:none; background:var(--bg)"
        title="HTML preview"
      />
    );
  }
  if (mode === "preview") {
    const parsed = parseFrontmatter(text);
    return (
      <div class="markdown-file-preview-shell" style="padding:24px 32px">
        <FrontmatterCard source={text} />
        <div class="markdown-body markdown-file-preview">
          {raw(renderMarkdown(parsed.body, { cwd: view.cwd, sessionId }))}
        </div>
      </div>
    );
  }
  return <SourceView view={view} />;
}

/** The whole viewer: toolbar plus content, swapped as one fragment per mode. */
export function Viewer({
  view,
  mode,
  sessionId,
}: {
  view: FileView;
  mode: ViewMode;
  sessionId: string;
}) {
  const relative = relativeTo(view.cwd, view.path);
  const deleted = view.deleted === true;
  const shell = (children: unknown) => (
    <div
      class="file-viewer-shell"
      data-path={view.path}
      data-relative={relative}
      data-mode={mode}
      data-kind={view.kind}
      style="display:flex; flex-direction:column; height:100%; overflow:hidden"
    >
      {children}
    </div>
  );
  if (view.kind !== "text") {
    return shell(<MediaViewer view={view} sessionId={sessionId} />);
  }
  const lines = view.text === undefined ? null : view.text.split("\n").length;
  const meta = deleted
    ? "Deleted"
    : `${view.language} · ${String(lines ?? 0)} lines · ${formatBytes(view.size)}`;
  const url = (next: ViewMode) =>
    `/files/view?path=${encodeURIComponent(view.path)}&session=${encodeURIComponent(sessionId)}&mode=${next}`;
  const modes: ViewMode[] = deleted
    ? ["diff"]
    : [
        "source",
        ...(hasPreview(view.path) && view.text !== undefined
          ? (["preview"] as ViewMode[])
          : []),
        ...(view.diff === undefined ? [] : (["diff"] as ViewMode[])),
      ];
  const label: Record<ViewMode, string> = {
    source: "Source",
    preview: "Preview",
    diff: "Diff",
  };
  return shell(
    <>
      <div
        class="file-viewer-toolbar"
        style="display:flex; align-items:center; gap:8px; padding:5px 12px; border-bottom:1px solid var(--border); font-size:11px; color:var(--text-dim); background:var(--bg); flex-shrink:0"
      >
        <span
          class="file-viewer-path"
          style="font-family:var(--font-mono)"
          title={view.path}
        >
          {relative}
        </span>
        <span class="file-viewer-meta" title={meta}>
          {meta}
        </span>
        {deleted ? null : (
          <span
            class="file-viewer-live-indicator"
            title="Not watching"
            aria-label="Not watching"
            style="background:var(--border); box-shadow:none"
          />
        )}
        <div class="file-viewer-controls">
          {modes.length < 2 ? null : (
            <div
              class="file-viewer-mode-switch"
              role="group"
              aria-label="File view mode"
            >
              {modes.map((option) => (
                <button
                  type="button"
                  class="file-viewer-mode-button"
                  aria-pressed={option === mode ? "true" : "false"}
                  {...(option === "diff"
                    ? { title: "Compare working tree with HEAD" }
                    : {})}
                  hx-get={url(option)}
                  hx-target="#file-view"
                  hx-swap="innerHTML"
                >
                  {label[option]}
                </button>
              ))}
            </div>
          )}
          <div class="file-viewer-actions">
            <button
              type="button"
              class="file-viewer-icon-button"
              data-mention-file
              title="Insert path into chat"
              aria-label="mention"
            >
              <MentionIcon size={14} />
            </button>
            {mode === "source" ? (
              <button
                type="button"
                class="file-viewer-icon-button"
                data-wrap-toggle
                aria-pressed="false"
                title="Enable word wrap"
                aria-label="Enable word wrap"
              >
                <WrapLinesIcon size={14} />
              </button>
            ) : null}
          </div>
          {deleted ? null : (
            <DownloadLink path={view.path} sessionId={sessionId} />
          )}
        </div>
      </div>
      <div
        class="file-viewer-content"
        style="flex:1; overflow:auto; background:var(--bg)"
      >
        <ViewerContent view={view} mode={mode} sessionId={sessionId} />
      </div>
    </>,
  );
}

/**
 * What the right panel holds below its tab bar. The panel container, its tab
 * bar and the hide button are pi-web's shell (src/web/views/SessionPage.tsx),
 * and the file tree now lives in the sidebar's explorer section, so this is
 * the viewer alone.
 */
export function FilePanelBody() {
  return (
    <div id="file-view" class="file-view">
      <div style="height:100%; display:flex; align-items:center; justify-content:center; color:var(--text-dim); font-size:12px">
        No file open
      </div>
    </div>
  );
}
