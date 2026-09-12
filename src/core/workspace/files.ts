import {
  buildEntriesFromFiles,
  type FileEntry,
  filterFileEntries,
} from "@core/composer";
import { type FileKind, fileKind, languageOf } from "@core/file-types";
import { directoryWithin, FileAccessError, samePath } from "@core/path-access";
import type { DirEntry, GitChangeFile, GitStatus } from "@core/ports";
import type { Shared } from "./deps.ts";
import { type FileScope, type FileView, ForbiddenPath } from "./views.ts";

// The file panel and the `@` menu: listings, the viewer, Git changes, and
// completion. Every path goes through `authorize` before it is touched.

/** 256 KiB of text, as pi-web; above that the viewer says so. */
const TEXT_LIMIT = 256 * 1024;
const MEDIA_LIMIT = 10 * 1024 * 1024;

export function fileUseCases({ deps, authorize, cwdOf, summaryOf }: Shared) {
  /**
   * The folder a completion request may list. Defaults to the session's own,
   * and anything else goes through the same containment policy as the file
   * panel, so there is one answer to "may this be listed".
   */
  async function authorizedCwd(
    id: string,
    directory: string | undefined,
  ): Promise<string> {
    const summary = await summaryOf(id);
    if (!summary) throw new ForbiddenPath("Unknown session");
    if (directory === undefined || directory === "") return summary.cwd;
    await authorize(directory, { sessionId: id, listing: true });
    return directory;
  }

  /**
   * The folder a files request is rooted in. A session names its own; without
   * one the folder comes from the page, so it goes through the same
   * containment check every other path does before it is listed.
   */
  async function scopeCwd(scope: FileScope): Promise<string> {
    if (scope.sessionId !== undefined) {
      const cwd = await cwdOf(scope.sessionId);
      if (cwd === "") throw new FileAccessError("Unknown session", 404);
      return cwd;
    }
    const cwd = scope.cwd ?? "";
    if (cwd === "") throw new FileAccessError("Unknown folder", 404);
    await authorize(cwd, { listing: true });
    return cwd;
  }

  /**
   * The folder a viewed file is read against: it decides the relative path in
   * the toolbar and whether there is a diff to offer. A folder the reader may
   * not list just leaves the file without that context; the file itself is
   * authorized on its own.
   */
  async function viewCwd(scope: FileScope): Promise<string> {
    try {
      return await scopeCwd(scope);
    } catch {
      return "";
    }
  }

  function changeFor(
    status: GitStatus,
    path: string,
  ): GitChangeFile | undefined {
    return status.files.find((file) => samePath(file.path, path));
  }

  return {
    /** The `@` index for a folder inside the session's own working folder. */
    async fileIndex(
      id: string,
      directory: string | undefined,
      query: string,
    ): Promise<
      { files: string[]; truncated: boolean } | { matches: FileEntry[] }
    > {
      const cwd = await authorizedCwd(id, directory);
      const index = await deps.files.index(cwd);
      if (query === "") return index;
      return {
        matches: filterFileEntries(buildEntriesFromFiles(index.files), query),
      };
    },

    /** Immediate children for a path-like `@` query, containment enforced. */
    async fileCompletion(
      id: string,
      query: string,
      directory: string | undefined,
    ): Promise<FileEntry[]> {
      const cwd = await authorizedCwd(id, directory);
      const children = await deps.files.children(query, cwd);
      return children.filter((entry) => directoryWithin(cwd, entry.path));
    },

    /** Children of one directory, for the explorer's lazy tree. */
    async listDirectory(
      sessionId: string | undefined,
      path: string,
    ): Promise<{ path: string; entries: DirEntry[] }> {
      await authorize(path, { sessionId, listing: true });
      return { path, entries: await deps.files.list(path) };
    },

    /** What the working tree changed, for the panel's changes section. */
    async gitChanges(scope: FileScope): Promise<GitStatus> {
      return deps.git.status(await scopeCwd(scope));
    },

    /**
     * One file as the viewer needs it: its kind, its text when it has any,
     * and its diff against HEAD. A deleted file has no content left, so it
     * opens with the diff alone.
     */
    async fileView(scope: FileScope, path: string): Promise<FileView> {
      const { sessionId } = scope;
      const cwd = await viewCwd(scope);
      const info = await authorize(path, { sessionId, allowMissing: true });
      const status = cwd === "" ? null : await deps.git.status(cwd);
      const change = status ? changeFor(status, path) : undefined;
      if (info === undefined) {
        if (!change) throw new FileAccessError("Not found", 404);
        const diff = await deps.git.diff(cwd, change);
        return {
          path,
          cwd,
          kind: "text",
          language: languageOf(path),
          size: 0,
          deleted: true,
          status: change.status,
          ...(diff === null ? {} : { diff }),
        };
      }
      if (!info.isFile) throw new FileAccessError("Not a file", 400);
      const kind = fileKind(path);
      const view: FileView = {
        path,
        cwd,
        kind,
        language: languageOf(path),
        size: info.size,
        ...(change ? { status: change.status } : {}),
      };
      if (kind === "text") {
        if (info.size > TEXT_LIMIT) view.tooLarge = true;
        else view.text = await deps.files.readText(path, TEXT_LIMIT);
      }
      if (change) {
        const diff = await deps.git.diff(cwd, change);
        if (diff !== null) view.diff = diff;
      }
      return view;
    },

    /** Size, language, and kind alone: what a media viewer re-reads. */
    async fileMeta(
      sessionId: string | undefined,
      path: string,
    ): Promise<{ size: number; language: string; kind: FileKind }> {
      const info = await authorize(path, { sessionId });
      if (info === undefined || !info.isFile) {
        throw new FileAccessError("Not a file", 400);
      }
      return {
        size: info.size,
        language: languageOf(path),
        kind: fileKind(path),
      };
    },

    /** Raw bytes for an image, an audio file, a PDF, or a download. */
    async fileBytes(
      sessionId: string | undefined,
      path: string,
      range?: { start: number; end: number },
    ): Promise<{ size: number; stream: ReadableStream<Uint8Array> }> {
      const info = await authorize(path, { sessionId });
      if (info === undefined || !info.isFile) {
        throw new FileAccessError("Not a file", 400);
      }
      if (fileKind(path) === "image" && info.size > MEDIA_LIMIT) {
        throw new FileAccessError("Image too large (>10MB)", 413);
      }
      return { size: info.size, stream: deps.files.stream(path, range) };
    },

    /** A .docx as HTML, for the sandboxed preview frame. */
    async docxPreview(
      sessionId: string | undefined,
      path: string,
    ): Promise<string> {
      const info = await authorize(path, { sessionId });
      if (info === undefined || fileKind(path) !== "docx") {
        throw new FileAccessError("Not a Word document", 400);
      }
      if (info.size > MEDIA_LIMIT) {
        throw new FileAccessError("Document too large (>10MB)", 413);
      }
      return deps.files.docxHtml(path);
    },

    /** Tells the viewer when the file changed under it. */
    async watchFile(
      sessionId: string | undefined,
      path: string,
      handlers: {
        change(info: { mtime: number; size: number }): void;
        error(): void;
      },
    ): Promise<() => void> {
      // A watch survives the file being deleted and written again, so a
      // missing path is not an error here.
      await authorize(path, { sessionId, allowMissing: true });
      return deps.watcher.watch(path, handlers);
    },

    /** The explorer's search box: files of the index, ranked. */
    async searchFiles(
      scope: FileScope,
      query: string,
      limit = 50,
    ): Promise<FileEntry[]> {
      const index = await deps.files.index(await scopeCwd(scope));
      const entries = index.files.map((path) => ({ path, isDir: false }));
      return filterFileEntries(entries, query, limit);
    },

    /** `@` completion before a session exists, containment enforced. */
    async folderFiles(
      cwd: string,
      query: string,
      path: boolean,
    ): Promise<
      { files: string[]; truncated: boolean } | { matches: FileEntry[] }
    > {
      await authorize(cwd, { listing: true });
      if (path) {
        const children = await deps.files.children(query, cwd);
        return {
          matches: children.filter((entry) => directoryWithin(cwd, entry.path)),
        };
      }
      const index = await deps.files.index(cwd);
      if (query === "") return index;
      return {
        matches: filterFileEntries(buildEntriesFromFiles(index.files), query),
      };
    },
  };
}
