"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { getFileIcon, FolderIcon, MentionIcon } from "./FileIcons";
import {
  getFileApiUrl,
  getFileDirectory,
  getFileName,
  getRelativeFilePath,
  joinFilePath,
  normalizeFilePathSlashes,
} from "@/lib/file-paths";
import { errorMessage } from "@/lib/error-message";
import type {
  GitFileStatus,
  GitFileStatusKind,
  GitStatusResponse,
} from "@/lib/git-types";
import type { FileIndexEntry } from "@/lib/file-fuzzy";
import { buildSearchTree, type SearchTreeNode } from "@/lib/search-tree";
import { useI18n } from "@/hooks/useI18n";
type Translate = ReturnType<typeof useI18n>["t"];

interface FileEntry {
  name: string;
  isDir: boolean;
  size: number;
  modified: string;
}

interface FileNode {
  name: string;
  fullPath: string;
  isDir: boolean;
  size: number;
  children?: FileNode[];
  loaded?: boolean;
}

interface Props {
  cwd: string;
  onOpenFile: (
    filePath: string,
    fileName: string,
    options?: OpenFileOptions,
  ) => void;
  refreshKey?: number;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  changesCollapsed: boolean;
  onChangesCountChange?: (count: number) => void;
  fileSearchOpen?: boolean;
  onFileSearchOpenChange?: (open: boolean) => void;
}

async function fetchEntries(
  dirPath: string,
  t: Translate,
): Promise<FileNode[]> {
  const res = await fetch(getFileApiUrl(dirPath, "list"));
  if (!res.ok) {
    let message = t("files.loadFailed", { status: res.status });
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // ignore non-JSON error bodies
    }
    throw new Error(message);
  }
  const data = (await res.json()) as { entries?: FileEntry[] };
  return (data.entries ?? []).map((e) => ({
    name: e.name,
    fullPath: joinFilePath(dirPath, e.name),
    isDir: e.isDir,
    size: e.size,
    children: e.isDir ? [] : undefined,
    loaded: !e.isDir,
  }));
}

async function fetchGitStatus(cwd: string): Promise<GitStatusResponse> {
  const params = new URLSearchParams({ cwd });
  const res = await fetch(`/api/git/status?${params.toString()}`);
  if (!res.ok)
    throw new Error(`Failed to load Git status (HTTP ${res.status})`);
  return res.json() as Promise<GitStatusResponse>;
}

const GIT_STATUS_KEYS: Record<GitFileStatusKind, string> = {
  modified: "files.modified",
  added: "files.added",
  deleted: "files.deleted",
  renamed: "files.renamed",
  untracked: "files.untracked",
  conflict: "files.conflict",
};

const GIT_STATUS_COLORS: Record<GitFileStatusKind, string> = {
  modified: "var(--warning)",
  added: "var(--success)",
  deleted: "var(--danger)",
  renamed: "#60a5fa",
  untracked: "var(--success)",
  conflict: "var(--danger)",
};

function GitStatusBadge({
  status,
  t,
}: {
  status: GitFileStatus;
  t: Translate;
}) {
  return (
    <span
      title={t(GIT_STATUS_KEYS[status.status])}
      aria-label={t(GIT_STATUS_KEYS[status.status])}
      style={{
        width: 14,
        height: 14,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: GIT_STATUS_COLORS[status.status],
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      {status.code}
    </span>
  );
}

function TreeNode({
  node,
  depth,
  cwd,
  onOpenFile,
  onAtMention,
  expandedPaths,
  onToggleExpanded,
  refreshToken,
  gitStatusByPath,
  changedDirectoryPaths,
  t,
}: {
  node: FileNode;
  depth: number;
  cwd: string;
  onOpenFile: (
    filePath: string,
    fileName: string,
    options?: OpenFileOptions,
  ) => void;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  expandedPaths: Set<string>;
  onToggleExpanded: (fullPath: string, open: boolean) => void;
  refreshToken?: string;
  gitStatusByPath: Map<string, GitFileStatus>;
  changedDirectoryPaths: Set<string>;
  t: Translate;
}) {
  const open = expandedPaths.has(node.fullPath);
  const normalizedPath = normalizeFilePathSlashes(node.fullPath);
  const gitStatus = gitStatusByPath.get(normalizedPath);
  const containsGitChanges =
    node.isDir &&
    (gitStatus !== undefined || changedDirectoryPaths.has(normalizedPath));
  const [children, setChildren] = useState<FileNode[]>(node.children ?? []);
  const [loaded, setLoaded] = useState(node.loaded ?? false);
  const [loading, setLoading] = useState(false);
  const [hovered, setHovered] = useState(false);

  const loadChildren = useCallback(
    async (force = false) => {
      if (loaded && !force) return;
      setLoading(true);
      try {
        const entries = await fetchEntries(node.fullPath, t);
        setChildren(entries);
        setLoaded(true);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    },
    [loaded, node.fullPath, t],
  );

  // Re-fetch children when the tree refreshes and the directory is open.
  useEffect(() => {
    if (refreshToken !== undefined && open && loaded) {
      void loadChildren(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  const handleClick = useCallback(() => {
    if (node.isDir) {
      const next = !open;
      onToggleExpanded(node.fullPath, next);
      if (next && !loaded) void loadChildren();
    } else {
      onOpenFile(node.fullPath, node.name);
    }
  }, [
    node.isDir,
    node.fullPath,
    node.name,
    loaded,
    open,
    loadChildren,
    onOpenFile,
    onToggleExpanded,
  ]);

  return (
    <div>
      <div
        onClick={handleClick}
        onMouseEnter={() => {
          setHovered(true);
        }}
        onMouseLeave={() => {
          setHovered(false);
        }}
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 4,
          paddingLeft: 8 + depth * 14,
          paddingRight: 8,
          height: 24,
          cursor: "pointer",
          background: hovered ? "var(--bg-hover)" : "transparent",
          borderRadius: 4,
          userSelect: "none",
        }}
      >
        {node.isDir && (
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="var(--text-dim)"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              flexShrink: 0,
              transform: open ? "rotate(90deg)" : "none",
              transition: "transform 0.1s",
            }}
          >
            <polyline points="3 2 7 5 3 8" />
          </svg>
        )}
        {!node.isDir && <span style={{ width: 10, flexShrink: 0 }} />}
        <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
          {node.isDir ? (
            <FolderIcon size={14} open={open} />
          ) : (
            getFileIcon(node.name, 14)
          )}
        </span>
        <span
          style={{
            fontSize: 12,
            color: "var(--text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
          title={node.fullPath}
        >
          {node.name}
        </span>
        {!hovered && !node.isDir && gitStatus && (
          <GitStatusBadge status={gitStatus} t={t} />
        )}
        {!hovered && containsGitChanges && (
          <span
            title={t("files.containsChangedFiles")}
            aria-label={t("files.containsChangedFiles")}
            style={{
              width: 14,
              height: 14,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--warning)",
              }}
            />
          </span>
        )}
        {loading && (
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--text-dim)"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4" />
          </svg>
        )}
        {onAtMention && hovered && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAtMention(getRelativeFilePath(node.fullPath, cwd), node.isDir);
            }}
            title={t("files.insertPath")}
            style={{
              position: "absolute",
              right: !node.isDir ? 28 : 4,
              top: "50%",
              transform: "translateY(-50%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              padding: "0 8px",
              height: 20,
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              color: "var(--accent)",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            <MentionIcon size={11} />
            {t("files.mention")}
          </button>
        )}
        {hovered && !node.isDir && (
          <a
            href={getFileApiUrl(node.fullPath, "download")}
            download
            onClick={(e) => {
              e.stopPropagation();
            }}
            title={t("files.download")}
            style={{
              position: "absolute",
              right: 4,
              top: "50%",
              transform: "translateY(-50%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              padding: "0 5px",
              height: 20,
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 600,
              whiteSpace: "nowrap",
              textDecoration: "none",
            }}
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </a>
        )}
      </div>
      {node.isDir && open && (
        <div>
          {children.map((child) => (
            <TreeNode
              key={child.fullPath}
              node={child}
              depth={depth + 1}
              cwd={cwd}
              onOpenFile={onOpenFile}
              onAtMention={onAtMention}
              expandedPaths={expandedPaths}
              onToggleExpanded={onToggleExpanded}
              refreshToken={refreshToken}
              gitStatusByPath={gitStatusByPath}
              changedDirectoryPaths={changedDirectoryPaths}
              t={t}
            />
          ))}
          {children.length === 0 && loaded && (
            <div
              style={{
                paddingLeft: 8 + (depth + 1) * 14,
                fontSize: 11,
                color: "var(--text-dim)",
                height: 22,
                display: "flex",
                alignItems: "center",
              }}
            >
              empty
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type OpenFileOptions = { sourceSessionId?: string | null; modeHint?: "diff" };

type OpenFileHandler = (
  filePath: string,
  fileName: string,
  options?: OpenFileOptions,
) => void;

function ChangeRow({
  status,
  cwd,
  onOpenFile,
  t,
}: {
  status: GitFileStatus;
  cwd: string;
  onOpenFile: OpenFileHandler;
  t: Translate;
}) {
  const name = getFileName(status.filePath);
  const rel = getRelativeFilePath(status.filePath, cwd);
  return (
    <div
      className="file-explorer-change-row"
      onClick={() => {
        onOpenFile(status.filePath, name, { modeHint: "diff" });
      }}
      title={status.filePath}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        paddingLeft: 10,
        paddingRight: 8,
        height: 24,
        cursor: "pointer",
        borderRadius: 4,
        userSelect: "none",
      }}
    >
      <GitStatusBadge status={status} t={t} />
      <span
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          opacity: 0.85,
        }}
      >
        {getFileIcon(name, 13)}
      </span>
      <span
        style={{
          fontSize: 12,
          color: "var(--text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          flex: 1,
        }}
      >
        {rel}
      </span>
    </div>
  );
}

export function FileExplorer({
  cwd,
  onOpenFile,
  refreshKey,
  onAtMention,
  changesCollapsed,
  onChangesCountChange,
  fileSearchOpen = false,
  onFileSearchOpenChange,
}: Props) {
  const { t } = useI18n();
  const [roots, setRoots] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [gitFiles, setGitFiles] = useState<GitFileStatus[]>([]);
  const [gitLineStats, setGitLineStats] = useState({
    additions: 0,
    deletions: 0,
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [searchPaths, setSearchPaths] = useState<string[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState<Set<string>>(new Set());
  const searchInputRef = useRef<HTMLInputElement>(null);
  const prevCwdRef = useRef<string | null>(null);
  const refreshToken = `${refreshKey ?? 0}`;
  const hasSearchQuery = searchQuery.trim().length > 0;

  // Reuse the cached, bounded file index used by @ mentions.
  useEffect(() => {
    if (!fileSearchOpen) return;
    const query = searchQuery.trim();
    if (!query) {
      setSearchPaths([]);
      setSearchLoading(false);
      setSearchError(false);
      return;
    }
    const controller = new AbortController();
    setSearchLoading(true);
    setSearchError(false);
    const timer = setTimeout(() => {
      fetch(
        `/api/file-index?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(query)}`,
        { signal: controller.signal },
      )
        .then((response) =>
          response.ok
            ? (response.json() as Promise<{ matches?: FileIndexEntry[] }>)
            : Promise.reject(new Error("Search failed")),
        )
        .then((data) => {
          setSearchPaths(
            (data.matches ?? [])
              .filter((entry) => !entry.isDir)
              .map((entry) => entry.path),
          );
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setSearchPaths([]);
            setSearchError(true);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearchLoading(false);
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [cwd, fileSearchOpen, searchQuery]);

  // Focus the search input whenever the search panel opens.
  useEffect(() => {
    if (fileSearchOpen) searchInputRef.current?.focus();
  }, [fileSearchOpen]);

  // Results render as a tree; keep every directory that contains a match
  // expanded, while preserving the user's manual collapses as they type.
  useEffect(() => {
    if (searchPaths.length === 0) return;
    const dirs = new Set<string>();
    for (const relative of searchPaths) {
      const parts = relative.split("/");
      let path = "";
      for (const part of parts.slice(0, -1)) {
        path = path ? `${path}/${part}` : part;
        dirs.add(joinFilePath(cwd, path));
      }
    }
    setSearchExpanded((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const dir of dirs) {
        if (!next.has(dir)) {
          next.add(dir);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [cwd, searchPaths]);

  const searchRoots = useMemo(() => {
    const toFileNode = (node: SearchTreeNode): FileNode => ({
      name: node.name,
      fullPath: joinFilePath(cwd, node.path),
      isDir: node.isDir,
      size: 0,
      children: node.children.map(toFileNode),
      loaded: true,
    });
    return buildSearchTree(searchPaths).map(toFileNode);
  }, [cwd, searchPaths]);

  const gitStatusByPath = useMemo(
    () =>
      new Map(
        gitFiles.map((status) => [
          normalizeFilePathSlashes(status.filePath),
          status,
        ]),
      ),
    [gitFiles],
  );

  const changedDirectoryPaths = useMemo(() => {
    const directories = new Set<string>();
    const normalizedCwd = normalizeFilePathSlashes(cwd).replace(/\/$/, "");
    for (const status of gitFiles) {
      let directory = getFileDirectory(
        normalizeFilePathSlashes(status.filePath),
      );
      while (
        directory === normalizedCwd ||
        directory.startsWith(`${normalizedCwd}/`)
      ) {
        directories.add(directory);
        if (directory === normalizedCwd) break;
        const parent = getFileDirectory(directory);
        if (parent === directory) break;
        directory = parent;
      }
    }
    return directories;
  }, [cwd, gitFiles]);

  const handleToggleExpanded = useCallback(
    (fullPath: string, open: boolean) => {
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        if (open) next.add(fullPath);
        else next.delete(fullPath);
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    const cwdChanged = prevCwdRef.current !== cwd;
    prevCwdRef.current = cwd;

    // Reset expanded state only when cwd changes, not on refreshKey bumps
    if (cwdChanged) {
      setExpandedPaths(new Set());
    }

    setLoading(cwdChanged);
    setError(null);
    let cancelled = false;
    fetchEntries(cwd, t)
      .then((entries) => {
        if (!cancelled) setRoots(entries);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, refreshKey, t]);

  useEffect(() => {
    let cancelled = false;
    fetchGitStatus(cwd)
      .then((status) => {
        if (!cancelled) {
          setGitFiles(status.isGitRepository ? status.files : []);
          setGitLineStats(
            status.isGitRepository
              ? { additions: status.additions, deletions: status.deletions }
              : { additions: 0, deletions: 0 },
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGitFiles([]);
          setGitLineStats({ additions: 0, deletions: 0 });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, refreshKey]);

  useEffect(() => {
    onChangesCountChange?.(gitFiles.length);
  }, [gitFiles, onChangesCountChange]);

  return (
    <div style={{ minHeight: "100%" }}>
      {fileSearchOpen && (
        <div
          style={{
            padding: "6px 8px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div style={{ position: "relative" }}>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              style={{
                position: "absolute",
                left: 8,
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--text-dim)",
                pointerEvents: "none",
              }}
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-4-4" />
            </svg>
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") onFileSearchOpenChange?.(false);
              }}
              placeholder={t("sidebar.searchFilesPlaceholder")}
              aria-label={t("sidebar.searchFiles")}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "6px 24px",
                border: "1px solid var(--border)",
                borderRadius: 5,
                outline: "none",
                background: "var(--bg)",
                color: "var(--text)",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
              }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                }}
                title={t("sidebar.clearSearch")}
                aria-label={t("sidebar.clearSearch")}
                className="file-explorer-search-clear"
                style={{
                  position: "absolute",
                  right: 4,
                  top: "50%",
                  transform: "translateY(-50%)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 18,
                  height: 18,
                  padding: 0,
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            )}
          </div>
          {hasSearchQuery && (
            <div style={{ paddingTop: 3 }}>
              {searchLoading && (
                <div
                  role="status"
                  style={{
                    padding: "6px 2px",
                    fontSize: 10,
                    color: "var(--text-dim)",
                  }}
                >
                  {t("sidebar.searchingFiles")}
                </div>
              )}
              {!searchLoading && searchError && (
                <div
                  role="alert"
                  style={{
                    padding: "6px 2px",
                    fontSize: 10,
                    color: "var(--danger)",
                  }}
                >
                  {t("i18n.networkError")}
                </div>
              )}
              {!searchLoading && !searchError && searchPaths.length === 0 && (
                <div
                  style={{
                    padding: "6px 2px",
                    fontSize: 10,
                    color: "var(--text-dim)",
                  }}
                >
                  {t("sidebar.noMatchingFiles")}
                </div>
              )}
              {!searchLoading && !searchError && searchPaths.length > 0 && (
                <div>
                  {searchRoots.map((node) => (
                    <TreeNode
                      key={`${searchQuery}:${node.fullPath}`}
                      node={node}
                      depth={0}
                      cwd={cwd}
                      onOpenFile={onOpenFile}
                      onAtMention={onAtMention}
                      expandedPaths={searchExpanded}
                      onToggleExpanded={(fullPath, open) => {
                        setSearchExpanded((prev) => {
                          const next = new Set(prev);
                          if (open) next.add(fullPath);
                          else next.delete(fullPath);
                          return next;
                        });
                      }}
                      gitStatusByPath={gitStatusByPath}
                      changedDirectoryPaths={changedDirectoryPaths}
                      t={t}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!changesCollapsed && gitFiles.length > 0 && (
        <div style={{ padding: "0 4px 2px" }}>
          <div
            aria-label={t("files.changeStats", {
              count: gitFiles.length,
              additions: gitLineStats.additions,
              deletions: gitLineStats.deletions,
            })}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              height: 24,
              padding: "0 10px",
              fontSize: 12,
            }}
          >
            <span style={{ color: "var(--text-dim)" }}>
              {t("files.changedCount", { count: gitFiles.length })}
            </span>
            <span
              style={{
                color: GIT_STATUS_COLORS.added,
                fontFamily: "var(--font-mono)",
              }}
            >
              +{gitLineStats.additions}
            </span>
            <span
              style={{
                color: GIT_STATUS_COLORS.deleted,
                fontFamily: "var(--font-mono)",
              }}
            >
              -{gitLineStats.deletions}
            </span>
          </div>
          {gitFiles.map((status) => (
            <ChangeRow
              key={status.filePath}
              status={status}
              cwd={cwd}
              onOpenFile={onOpenFile}
              t={t}
            />
          ))}
        </div>
      )}

      {(changesCollapsed || gitFiles.length === 0) &&
        (!fileSearchOpen || !hasSearchQuery) && (
          <div style={{ padding: "2px 4px" }}>
            {loading ? (
              <div
                style={{
                  padding: "8px 12px",
                  fontSize: 11,
                  color: "var(--text-dim)",
                }}
              >
                {t("chat.loadingFiles")}
              </div>
            ) : error ? (
              <div
                style={{
                  padding: "8px 12px",
                  fontSize: 11,
                  color: "var(--danger)",
                }}
              >
                {error}
              </div>
            ) : (
              roots.map((node) => (
                <TreeNode
                  key={node.fullPath}
                  node={node}
                  depth={0}
                  cwd={cwd}
                  onOpenFile={onOpenFile}
                  onAtMention={onAtMention}
                  expandedPaths={expandedPaths}
                  onToggleExpanded={handleToggleExpanded}
                  refreshToken={refreshToken}
                  gitStatusByPath={gitStatusByPath}
                  changedDirectoryPaths={changedDirectoryPaths}
                  t={t}
                />
              ))
            )}
            {!loading && !error && roots.length === 0 && (
              <div
                style={{
                  padding: "8px 12px",
                  fontSize: 11,
                  color: "var(--text-dim)",
                }}
              >
                {t("files.noFiles")}
              </div>
            )}
          </div>
        )}
    </div>
  );
}
