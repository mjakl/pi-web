"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { RecentProject } from "@/lib/project-groups";
import { useI18n } from "@/hooks/useI18n";

export interface ProjectFolders {
  projectRoot: string;
  projectKey: string;
  cwdAvailable: boolean;
  isGit: boolean;
  isTopLevel: boolean;
  currentWorktreePath?: string | null;
  worktrees: { path: string; branch: string | null }[];
}

function FolderIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" style={{ flexShrink: 0 }}><path d="M3 7V5h6l2 2h10v13H3Z" /></svg>;
}

export function ProjectFolderGroup({ project, selectedCwd, selected, homeDir, activity, onSelect }: {
  project: RecentProject;
  selectedCwd: string | null;
  selected: boolean;
  homeDir: string;
  activity: ReactNode;
  onSelect: (cwd: string, root: string, key: string) => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(selected);
  const [data, setData] = useState<ProjectFolders | null>(null);
  const [error, setError] = useState<string | null>(null);
  const display = (path: string) => homeDir && path.startsWith(`${homeDir}/`) ? `~${path.slice(homeDir.length)}` : path;
  const name = (path: string) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;

  const queryCwd = selected ? selectedCwd ?? project.cwd : project.cwd;
  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    fetch(`/api/worktrees?cwd=${encodeURIComponent(queryCwd)}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
        if (!controller.signal.aborted) { setData(result); setError(null); }
      })
      .catch(error => { if (!controller.signal.aborted) setError(String(error)); });
    return () => controller.abort();
  }, [expanded, queryCwd]);

  const folders = data ? data.isGit && data.isTopLevel
    ? data.worktrees.map(folder => folder.path)
    : data.cwdAvailable ? [project.cwd] : [] : [];
  const selectedPath = selected ? data?.currentWorktreePath ?? selectedCwd : selectedCwd;
  const select = (path: string) => onSelect(path, data?.projectRoot ?? project.root, data?.projectKey ?? project.key);
  const direct = data && folders.length === 1 && folders[0] === project.root;

  return (
    <div className="project-folder-group">
      <button className="project-folder-row" aria-expanded={direct ? undefined : expanded}
        onClick={() => direct ? select(folders[0]) : setExpanded(value => !value)}>
        {direct ? <FolderIcon /> : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" style={{ flexShrink: 0, transform: expanded ? "rotate(90deg)" : undefined }}><path d="m9 5 7 7-7 7" /></svg>}
        <span className="project-folder-label"><span>{name(project.root)}</span><span className="project-folder-path">{display(project.root)}</span></span>
        {activity}
        {direct && selectedPath === folders[0] && <span aria-hidden="true">✓</span>}
      </button>
      {expanded && !direct && <div>
        {!data && !error && <div className="project-folder-message" role="status">{t("sidebar.loading")}</div>}
        {error && <div className="project-folder-message" role="alert">{error}</div>}
        {data && !folders.length && <div className="project-folder-message">{t("sidebar.noWorkingFolders")}</div>}
        {folders.map(path => <button key={path} className="project-folder-row project-folder-child"
          aria-current={selectedPath === path ? "true" : undefined} onClick={() => select(path)} title={path}>
          <FolderIcon />
          <span className="project-folder-label"><span>{name(path)}</span><span className="project-folder-path">{display(path)}</span></span>
          {selectedPath === path && <span aria-hidden="true">✓</span>}
        </button>)}
      </div>}
    </div>
  );
}
