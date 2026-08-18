/**
 * The renderer's side of a session: which open files are shared, and who is where.
 *
 * One binding per shared file, created when a file is opened during a session and when a session
 * starts with files already open. Both cases matter and only the first is obvious - a user who
 * shares a folder with four tabs open expects those four tabs to be live, not just the fifth one
 * they open afterwards.
 *
 * Paths are the seam that needs care here. The workbench works in absolute paths, because that is
 * what the filesystem IPC takes. The session works in workspace-relative paths with forward
 * slashes, because that is what the wire protocol allows and what a guest's machine can make sense
 * of - the host's `E:\project\src\main.ts` means nothing on someone else's computer. Converting in
 * one place means no message ever carries the wrong form.
 */
import type { CollabPresenceView, CollabStatusView } from "../../shared/api.ts";
import type { EditorHost } from "../editor/editorHost.ts";
import { bindModel, type DocBinding } from "./binding.ts";

export interface CollabSessionDeps {
  readonly editorHost: EditorHost;
  /** The open folder, absolute. `null` when none is open. */
  readonly workspaceRoot: () => string | null;
  /** Every open tab, absolute paths. Used when a session starts with files already open. */
  readonly openPaths: () => readonly string[];
  /** The tab in front of the user, absolute, or `null`. */
  readonly activePath: () => string | null;
}

export interface CollabSession {
  /** A session started or ended. */
  applyStatus(status: CollabStatusView): void;
  /** A file was opened in the workbench. Binds it if a session is running. */
  trackFile(absolutePath: string): void;
  /** A tab closed. */
  untrackFile(absolutePath: string): void;
  /** An update arrived from the main process. */
  applyDocUpdate(relativePath: string, update: string): void;
  /** Presence for everyone, from the main process. */
  applyPresence(presence: readonly CollabPresenceView[]): void;
  /** The local caret moved, or the active tab changed. */
  publishCursor(line: number, column: number): void;
  /** Redraw remote carets, after a tab switch. */
  refreshCursors(): void;
  /** True while a session is running, so the workbench can label things honestly. */
  isActive(): boolean;
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function createCollabSession(deps: CollabSessionDeps): CollabSession {
  /** Bindings by workspace-relative path. */
  const bindings = new Map<string, DocBinding>();
  let status: CollabStatusView | null = null;
  let presence: readonly CollabPresenceView[] = [];

  function active(): boolean {
    return status?.mode === "hosting" || status?.mode === "joined";
  }

  /**
   * Absolute to workspace-relative, with forward slashes.
   *
   * `null` for anything outside the folder, which is not an error: a user may well have a file
   * from elsewhere open in a tab, and it simply is not part of the session. Backslashes are
   * normalised because the protocol refuses them outright - a Windows path sent as-is would be
   * rejected by the host and the file would silently never sync.
   */
  function toRelative(absolutePath: string): string | null {
    const root = deps.workspaceRoot();
    if (root === null) return null;

    const normalisedRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
    const normalised = absolutePath.replace(/\\/g, "/");

    if (!normalised.startsWith(`${normalisedRoot}/`)) return null;

    const relative = normalised.slice(normalisedRoot.length + 1);
    return relative.length === 0 ? null : relative;
  }

  function relativeToActive(): string | null {
    const path = deps.activePath();
    return path === null ? null : toRelative(path);
  }

  async function bind(absolutePath: string): Promise<void> {
    if (!active()) return;

    const relative = toRelative(absolutePath);
    if (relative === null || bindings.has(relative)) return;

    const model = deps.editorHost.modelFor(absolutePath);
    if (model === null) return;

    const state = await window.adcode.collab.openDoc(relative);

    // Between the await and here the session may have ended, or the tab closed. Binding now
    // would attach a listener to a disposed model.
    if (!active() || bindings.has(relative)) return;
    if (deps.editorHost.modelFor(absolutePath) !== model) return;

    bindings.set(
      relative,
      bindModel({
        model,
        initialState: state === null ? null : fromBase64(state),
        onLocalUpdate: (update) => window.adcode.collab.pushUpdate(relative, update),
      }),
    );
  }

  function unbindAll(): void {
    for (const binding of bindings.values()) binding.dispose();
    bindings.clear();
  }

  return {
    applyStatus(next) {
      const wasActive = active();
      status = next;

      if (!active()) {
        if (wasActive) {
          unbindAll();
          presence = [];
          deps.editorHost.remoteCursors.clear();
        }
        return;
      }

      // A session that has just started adopts every file already open, not only the next one
      // to be opened.
      if (!wasActive) {
        for (const path of deps.openPaths()) void bind(path);
      }
    },

    trackFile(absolutePath) {
      void bind(absolutePath);
    },

    untrackFile(absolutePath) {
      const relative = toRelative(absolutePath);
      if (relative === null) return;

      // The binding holds a listener on a model that is about to be disposed, so it goes first.
      bindings.get(relative)?.dispose();
      bindings.delete(relative);
    },

    applyDocUpdate(relativePath, update) {
      const binding = bindings.get(relativePath);
      if (binding === undefined) return;

      try {
        binding.applyRemote(fromBase64(update));
      } catch {
        // A payload that is not decodable base64 cannot have come from our own main process,
        // but dropping it beats throwing inside an IPC listener.
      }
    },

    applyPresence(next) {
      presence = next;
      this.refreshCursors();
    },

    publishCursor(line, column) {
      if (!active()) return;
      window.adcode.collab.presence(relativeToActive(), { line, column }, null);
    },

    refreshCursors() {
      if (status === null) return;

      deps.editorHost.remoteCursors.render(
        relativeToActive(),
        presence,
        status.participants,
        status.selfId,
      );
    },

    isActive: active,
  };
}
