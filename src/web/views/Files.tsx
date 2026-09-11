import {
  baseName,
  extensionOf,
  formatBytes,
  hasPreview,
  iconOf,
} from "@core/file-types";
import { frontmatterCard, parseFrontmatter } from "@core/frontmatter";
import { statusLabel } from "@core/git-status";
import { type UnifiedRow, unifiedRows } from "@core/patch";
import type { GitChangeFile, GitStatus } from "@core/ports";
import { directoryWithin } from "@core/path-access";
import type { FileView } from "@core/workspace";
import { escapeHtml, rawFileUrl, renderMarkdown } from "@web/markdown";
import { highlightLines } from "@web/syntax";
import { raw } from "hono/html";

// The file panel: a lazy tree, the working tree's changes, and one viewer per
// open tab. Everything here is server-rendered; the browser only keeps which
// tabs are open and how each is scrolled.

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

const ICON_PATHS: Record<string, string> = {
  folder:
    "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  file: "M6 3h8l4 4v14H6zM14 3v4h4",
  code: "M6 3h8l4 4v14H6zM14 3v4h4M9 12l-1.5 2L9 16M14 12l1.5 2L14 16",
  config: "M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 15h4",
  doc: "M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 15h6M9 18h3",
  image: "M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0",
  audio:
    "M9 18V6l10-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0M19 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  pdf: "M6 3h8l4 4v14H6zM14 3v4h4M9 13h2a1 1 0 0 1 0 2H9zM9 13v5",
};

function Icon({ name }: { name: string }) {
  return (
    <svg class="file-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICON_PATHS[name] ?? ICON_PATHS["file"]} />
    </svg>
  );
}

/** pi-web's Git badge colours (§3.5): the letter carries the state. */
const STATUS_COLOUR: Record<string, string> = {
  M: "var(--warning)",
  A: "var(--success)",
  D: "var(--danger)",
  R: "#60a5fa",
  U: "var(--success)",
  C: "var(--danger)",
};

/** Hover actions: put the path into the composer, or download the file. */
function RowActions({
  sessionId,
  cwd,
  path,
  isDir,
}: {
  sessionId: string;
  cwd: string;
  path: string;
  isDir: boolean;
}) {
  const relative = relativeTo(cwd, path);
  return (
    <span class="tree-actions">
      <button
        type="button"
        class="tree-action"
        title={`Mention ${relative}`}
        aria-label={`Mention ${relative}`}
        data-mention={relative}
        {...(isDir ? { "data-mention-dir": "1" } : {})}
      >
        @
      </button>
      {isDir ? null : (
        <a
          class="tree-action"
          title={`Download ${relative}`}
          aria-label={`Download ${relative}`}
          href={`${rawFileUrl(path, sessionId)}&download=1`}
        >
          ⤓
        </a>
      )}
    </span>
  );
}

export type TreeContext = {
  sessionId: string;
  cwd: string;
  /** Absolute paths Git reports as changed, with their letter. */
  changes: Map<string, GitChangeFile>;
};

function changedUnder(context: TreeContext, directory: string): boolean {
  for (const path of context.changes.keys()) {
    if (directoryWithin(directory, path)) return true;
  }
  return false;
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
    return <li class="tree-empty">empty</li>;
  }
  const query = (path: string) =>
    new URLSearchParams({
      path,
      session: context.sessionId,
      depth: String(depth + 1),
    }).toString();
  return (
    <>
      {entries.map((entry) => {
        const path = childPath(directory, entry.name);
        const change = context.changes.get(path);
        return (
          <li
            role="treeitem"
            tabindex={-1}
            class="tree-item"
            data-path={path}
            data-name={entry.name}
            {...(entry.isDir
              ? {
                  "data-dir": "1",
                  "aria-expanded": "false",
                  "hx-get": `/files/tree?${query(path)}`,
                  "hx-trigger": "expand once",
                  "hx-target": "find ul",
                  "hx-swap": "innerHTML",
                }
              : {})}
          >
            <span
              class="tree-row"
              style={`padding-left:${String(8 + depth * 14)}px`}
            >
              {entry.isDir ? (
                <span class="tree-caret" aria-hidden="true">
                  ▸
                </span>
              ) : (
                <span class="tree-caret" aria-hidden="true" />
              )}
              <Icon name={iconOf(entry.name, entry.isDir)} />
              <span class="tree-name">{entry.name}</span>
              {change ? (
                <span
                  class="tree-status"
                  style={`color:${STATUS_COLOUR[change.status] ?? "var(--text-dim)"}`}
                  title={statusLabel(change.status)}
                >
                  {change.status}
                </span>
              ) : entry.isDir && changedUnder(context, path) ? (
                <span class="tree-dot" title="Contains changes" />
              ) : null}
              <RowActions
                sessionId={context.sessionId}
                cwd={context.cwd}
                path={path}
                isDir={entry.isDir}
              />
            </span>
            {entry.isDir ? <ul role="group" hidden /> : null}
          </li>
        );
      })}
    </>
  );
}

function Changes({
  context,
  status,
}: {
  context: TreeContext;
  status: GitStatus;
}) {
  if (!status.isRepository || status.files.length === 0) return <></>;
  return (
    <details class="changes">
      <summary class="changes-head">
        <span>{String(status.files.length)} changed</span>
        <span>+{String(status.additions)}</span>
        <span>-{String(status.deletions)}</span>
      </summary>
      <ul class="changes-list">
        {status.files.map((file) => {
          const relative = relativeTo(context.cwd, file.path);
          return (
            <li>
              <button
                type="button"
                class="changes-row"
                title={`${file.path} (${statusLabel(file.status)})`}
                data-file-path={file.path}
                data-file-mode="diff"
              >
                <span
                  class="tree-status"
                  style={`color:${STATUS_COLOUR[file.status] ?? "var(--text-dim)"}`}
                >
                  {file.status}
                </span>
                <Icon name={iconOf(file.path, false)} />
                <span class="tree-name">{relative}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/** The changes list plus the root of the tree, re-rendered on refresh. */
export function Explorer({
  context,
  status,
  entries,
}: {
  context: TreeContext;
  status: GitStatus;
  entries: { name: string; isDir: boolean }[];
}) {
  return (
    <>
      <Changes context={context} status={status} />
      <ul id="file-tree" role="tree" aria-label="Files" class="tree">
        <TreeNodes
          context={context}
          directory={context.cwd}
          entries={entries}
          depth={0}
        />
      </ul>
    </>
  );
}

/** Search hits, folded back into the tree shape they came from. */
export function SearchResults({
  context,
  matches,
}: {
  context: TreeContext;
  matches: string[];
}) {
  if (matches.length === 0) {
    // Keeps the id: the search box swaps this element again on the next
    // keystroke, and an empty query has to be able to put the tree back.
    return (
      <p id="file-tree" class="tree-empty" role="status">
        No matching files
      </p>
    );
  }
  // One row per hit, indented by its depth: a full tree of ancestors would
  // add rows nobody asked for.
  return (
    <ul id="file-tree" role="tree" aria-label="Search results" class="tree">
      {matches.map((relative) => {
        const path = childPath(context.cwd, relative);
        const depth = relative.split("/").length - 1;
        return (
          <li role="treeitem" tabindex={-1} class="tree-item" data-path={path}>
            <span
              class="tree-row"
              style={`padding-left:${String(8 + depth * 10)}px`}
            >
              <Icon name={iconOf(relative, false)} />
              <span class="tree-name" title={relative}>
                {relative}
              </span>
              <RowActions
                sessionId={context.sessionId}
                cwd={context.cwd}
                path={path}
                isDir={false}
              />
            </span>
          </li>
        );
      })}
    </ul>
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

/** The newline that ends a file does not start another line. */
function countLines(text: string): string {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return String(lines.length);
}

function SourceLines({ view }: { view: FileView }) {
  const text = view.text ?? "";
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  // Above a thousand lines the colouring costs more than it is worth, so the
  // text is printed plain, exactly as pi-web does.
  const coloured =
    lines.length <= 1000 ? highlightLines(text, view.language) : null;
  const rows = lines
    .map((line, index) => {
      const body = coloured?.[index] ?? escapeHtml(line);
      const number = String(index + 1);
      return `<div class="file-line" data-line="${number}"><span class="file-ln" aria-hidden="true">${number}</span><span class="file-lt">${body === "" ? "​" : body}</span></div>`;
    })
    .join("");
  return <>{raw(rows)}</>;
}

function Frontmatter({ source }: { source: string }) {
  const card = frontmatterCard(parseFrontmatter(source).fields);
  if (
    card.title === undefined &&
    card.chips.length === 0 &&
    card.rest.length === 0
  ) {
    return <></>;
  }
  return (
    <div class="frontmatter">
      {card.title === undefined ? null : <h2>{card.title}</h2>}
      {card.chips.length === 0 ? null : (
        <div class="frontmatter-chips">
          {card.chips.map((chip) => (
            <span class="frontmatter-chip">{chip}</span>
          ))}
        </div>
      )}
      {card.rest.length === 0 ? null : (
        <dl>
          {card.rest.map(([key, value]) => (
            <>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </>
          ))}
        </dl>
      )}
    </div>
  );
}

function DiffRows({ rows }: { rows: UnifiedRow[] }) {
  return (
    <div class="file-diff">
      {rows.map((row) => {
        if (row.type === "hunk") {
          return <div class="diff-hunk">{row.text}</div>;
        }
        if (row.type === "collapsed") {
          return (
            <div class="diff-collapsed">
              ... {String(row.count)} unchanged lines ...
            </div>
          );
        }
        return (
          <div class={`diff-line diff-${row.kind}`}>
            <span class="file-ln" aria-hidden="true">
              {row.lineNo === null ? "" : String(row.lineNo)}
            </span>
            <span class="diff-sign" aria-hidden="true">
              {row.kind === "added" ? "+" : row.kind === "removed" ? "-" : " "}
            </span>
            <span class="file-lt">{row.text}</span>
          </div>
        );
      })}
    </div>
  );
}

function ViewerBody({
  view,
  mode,
  sessionId,
}: {
  view: FileView;
  mode: ViewMode;
  sessionId: string;
}) {
  if (mode === "diff") {
    if (view.diff === undefined) {
      return <p class="viewer-note">No changes against HEAD.</p>;
    }
    return <DiffRows rows={unifiedRows(view.diff)} />;
  }
  const source = rawFileUrl(view.path, sessionId);
  switch (view.kind) {
    case "image":
      return (
        <div class="media-image">
          <img src={source} alt={baseName(view.path)} />
        </div>
      );
    case "audio":
      return (
        <div class="media-audio">
          {/* oxlint-disable-next-line jsx-a11y/media-has-caption */}
          <audio controls preload="metadata" src={source} />
        </div>
      );
    case "pdf":
      return (
        <iframe class="media-frame" src={source} title={baseName(view.path)} />
      );
    case "docx":
      return (
        <iframe
          class="media-frame"
          sandbox="allow-same-origin"
          src={`/files/docx?path=${encodeURIComponent(view.path)}&session=${encodeURIComponent(sessionId)}`}
          title={baseName(view.path)}
        />
      );
    default:
      break;
  }
  if (view.tooLarge === true) {
    return (
      <p class="viewer-note">
        This file is {formatBytes(view.size)}, above the 256 KB the viewer
        shows. Download it to read the whole thing.
      </p>
    );
  }
  const text = view.text ?? "";
  if (mode === "preview" && view.language === "html") {
    return (
      <iframe
        class="media-frame"
        sandbox="allow-scripts"
        srcdoc={text}
        title={baseName(view.path)}
      />
    );
  }
  if (mode === "preview") {
    const parsed = parseFrontmatter(text);
    return (
      <div class="viewer-preview">
        <Frontmatter source={text} />
        <div class="markdown-body">
          {raw(
            renderMarkdown(parsed.body, {
              cwd: view.cwd,
              sessionId,
            }),
          )}
        </div>
      </div>
    );
  }
  return (
    <div class="file-source">
      <SourceLines view={view} />
    </div>
  );
}

/** The whole viewer: toolbar plus body, swapped as one fragment per mode. */
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
  const lines = view.text === undefined ? null : countLines(view.text);
  const meta = [
    // A media file's grammar is meaningless; its extension is not.
    view.kind === "text" ? view.language : extensionOf(view.path),
    lines === null ? "" : `${lines} lines`,
    view.deleted === true ? "deleted" : formatBytes(view.size),
  ]
    .filter((part) => part !== "")
    .join(" · ");
  const url = (next: ViewMode) =>
    `/files/view?path=${encodeURIComponent(view.path)}&session=${encodeURIComponent(sessionId)}&mode=${next}`;
  const modes: ViewMode[] = [
    ...(view.deleted === true ? [] : (["source"] as ViewMode[])),
    ...(hasPreview(view.path) && view.text !== undefined
      ? (["preview"] as ViewMode[])
      : []),
    ...(view.diff === undefined ? [] : (["diff"] as ViewMode[])),
  ];
  return (
    <div
      class="viewer"
      data-path={view.path}
      data-relative={relative}
      data-mode={mode}
      data-kind={view.kind}
    >
      <div class="viewer-bar">
        <span class="viewer-path" title={view.path}>
          {relative}
        </span>
        <span class="viewer-meta">{meta}</span>
        <span class="viewer-live" title="Watching this file" hidden />
        <span />
        {modes.length < 2 ? null : (
          <span role="group" aria-label="View mode">
            {modes.map((option) => (
              <button
                type="button"
                class="viewer-mode"
                aria-pressed={option === mode ? "true" : "false"}
                hx-get={url(option)}
                hx-target="#file-view"
                hx-swap="innerHTML"
              >
                {option}
              </button>
            ))}
          </span>
        )}
        <button
          type="button"
          class="viewer-action"
          data-mention-file
          title="Put this file, or the selected lines, into the composer"
        >
          @
        </button>
        {mode === "source" ? (
          <button
            type="button"
            class="viewer-action"
            data-wrap-toggle
            aria-pressed="false"
            title="Wrap long lines"
          >
            ⏎
          </button>
        ) : null}
        <a
          class="viewer-action"
          title="Download"
          href={`${rawFileUrl(view.path, sessionId)}&download=1`}
        >
          ⤓
        </a>
      </div>
      <div class="viewer-body">
        <ViewerBody view={view} mode={mode} sessionId={sessionId} />
      </div>
    </div>
  );
}

/**
 * What the right panel holds below its tab bar. The panel container, its tab
 * bar and the hide button are pi-web's shell (src/web/views/SessionPage.tsx),
 * and the file tree now lives in the sidebar's explorer section, so this is
 * the viewer alone.
 */
export function FilePanelBody() {
  return <div id="file-view" class="file-view" />;
}
