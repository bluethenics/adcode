import { watch, type FSWatcher } from "node:fs";

/** A watcher can fail after construction, for example when Linux exhausts inotify. */
export function watchForReload(
  root: string,
  changed: () => void,
  watchImpl: typeof watch = watch,
): { close(): void } {
  let current: FSWatcher | null = null;
  let closed = false;
  function start(recursive: boolean): void {
    if (closed) return;
    try {
      const next = watchImpl(root, { recursive }, changed);
      current = next;
      next.on("error", () => {
        next.close();
        if (current !== next) return;
        current = null;
        if (recursive) start(false);
      });
    } catch {
      if (recursive) start(false);
    }
  }
  start(true);
  return {
    close() { closed = true; current?.close(); current = null; },
  };
}
