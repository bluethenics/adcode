/**
 * What the editor was doing last time - the folder and the open editors.
 *
 * Brief §4's Session group: "Restore workspace `on` - reopen the last folder and editors
 * on launch." No Electron import, so the disk behaviour is testable the same way the
 * settings store's is.
 *
 * Every failure path yields an empty session rather than an error. Losing the tab layout
 * is a small annoyance; refusing to start because of a stale JSON file is not.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Enough to restore a working session without turning startup into a file-read storm. */
const MAX_REMEMBERED_EDITORS = 100;

/** Workbench sizes, in pixels. Absent in sessions written before they were adjustable. */
export interface SessionLayout {
  readonly sidebarWidth: number;
  readonly panelHeight: number;
}

export interface SessionState {
  readonly root: string | null;
  readonly openFiles: readonly string[];
  readonly activeFile: string | null;
  readonly layout?: SessionLayout;
}

export interface SessionStore {
  load(): Promise<SessionState>;
  save(state: SessionState): Promise<void>;
}

const EMPTY: SessionState = { root: null, openFiles: [], activeFile: null };

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

/**
 * A stored size, sanity-checked but not fitted to any particular window.
 *
 * Whether 900px is a sensible sidebar depends on the screen, which the main process
 * cannot see; the renderer clamps it against the real window on load. All this rejects
 * is what could never be a size - a string, a negative, a NaN that `JSON.parse` turned
 * into null - so the renderer is never handed something it would have to guess about.
 */
const asSize = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0 && value < 10_000
    ? Math.round(value)
    : null;

function asLayout(value: unknown): SessionLayout | undefined {
  if (typeof value !== "object" || value === null) return undefined;

  const raw = value as { sidebarWidth?: unknown; panelHeight?: unknown };
  const sidebarWidth = asSize(raw.sidebarWidth);
  const panelHeight = asSize(raw.panelHeight);

  // Both or neither: half a layout would leave one dimension silently defaulted while
  // the other was restored, which reads as the app forgetting at random.
  return sidebarWidth === null || panelHeight === null ? undefined : { sidebarWidth, panelHeight };
}

export function createSessionStore(directory: string): SessionStore {
  const target = join(directory, "session.json");
  const temporary = `${target}.tmp`;

  return {
    async load(): Promise<SessionState> {
      try {
        const parsed: unknown = JSON.parse(await readFile(target, "utf8"));
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return EMPTY;

        const state = (parsed as { state?: unknown }).state;
        if (typeof state !== "object" || state === null) return EMPTY;

        const raw = state as {
          root?: unknown;
          openFiles?: unknown;
          activeFile?: unknown;
          layout?: unknown;
        };

        const layout = asLayout(raw.layout);

        return {
          root: asString(raw.root),
          openFiles: Array.isArray(raw.openFiles)
            ? raw.openFiles
                .map(asString)
                .filter((value): value is string => value !== null)
                .slice(0, MAX_REMEMBERED_EDITORS)
            : [],
          activeFile: asString(raw.activeFile),
          ...(layout === undefined ? {} : { layout }),
        };
      } catch {
        return EMPTY;
      }
    },

    async save(state: SessionState): Promise<void> {
      const layout = asLayout(state.layout);

      const trimmed: SessionState = {
        root: state.root,
        openFiles: state.openFiles.slice(0, MAX_REMEMBERED_EDITORS),
        activeFile: state.activeFile,
        ...(layout === undefined ? {} : { layout }),
      };

      try {
        await mkdir(directory, { recursive: true });

        // Write-then-rename, so a crash mid-save leaves the previous session intact
        // instead of a truncated file the load path would have to discard.
        await writeFile(temporary, JSON.stringify({ state: trimmed }, null, 2), "utf8");
        await rename(temporary, target);
      } catch {
        // A session that cannot be written is not worth an error dialog.
      }
    },
  };
}
