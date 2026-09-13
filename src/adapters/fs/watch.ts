import type { Watcher } from "@core/ports";
import { watch as watchFs } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { samePath } from "@core/path-access";

// The directory is watched rather than the file, so an editor that saves by
// writing a temporary file and renaming it over the target still reports a
// change. Every event is deduplicated against the last known identity of the
// file: editors touch a directory far more often than they touch one file.

export function createWatcher(): Watcher {
  return {
    watch(path, handlers) {
      let last = "";
      let deleted = false;
      let closed = false;
      const check = () => {
        void stat(path).then(
          (info) => {
            if (closed) return;
            deleted = false;
            const identity = [
              info.mtimeMs,
              info.ctimeMs,
              info.ino,
              info.size,
            ].join(":");
            if (identity === last) return;
            last = identity;
            handlers.change({ mtime: info.mtimeMs, size: info.size });
          },
          () => {
            if (closed || deleted) return;
            deleted = true;
            last = "";
            handlers.change({ mtime: Date.now(), size: 0 });
          },
        );
      };
      let watcher;
      try {
        watcher = watchFs(dirname(path), (_event, name) => {
          if (name !== null && !samePath(join(dirname(path), name), path)) {
            return;
          }
          check();
        });
      } catch {
        handlers.error();
        return () => {
          // Nothing was installed.
        };
      }
      watcher.on("error", () => {
        handlers.error();
      });
      // The first stat records the current identity, so the viewer is not
      // told about a change that happened before it opened.
      void stat(path).then(
        (info) => {
          if (!closed && last === "") {
            last = [info.mtimeMs, info.ctimeMs, info.ino, info.size].join(":");
          }
        },
        () => undefined,
      );
      return () => {
        closed = true;
        watcher.close();
      };
    },
  };
}
