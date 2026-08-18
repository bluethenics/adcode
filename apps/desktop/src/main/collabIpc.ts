/**
 * The collaboration IPC handlers.
 *
 * In its own file rather than in `ipc.ts` for the reason `gitIpc.ts` is: the surface is a dozen
 * channels with their own validation, and `ipc.ts` is already long enough that adding them
 * inline would bury the ones that were there first.
 *
 * **Every handler validates its own arguments**, per §1, and that is not ceremony here even
 * though the renderer is on the same machine: a compromised renderer talks to `ipcRenderer`
 * directly, and these channels start a network server and write files. `collabHost` in
 * particular is the one that binds a port beyond loopback, so it is the last place to take a
 * caller's word for anything.
 *
 * Note the asymmetry with the wire protocol. `protocol.parse` refuses malformed input with
 * `null` because the sender is another machine and the only safe answer is silence. Here the
 * sender is our own renderer, so a bad argument is a bug in this program - it gets a thrown
 * error, which is the version that shows up and gets fixed.
 */
import { relative, sep } from "node:path";
import { BrowserWindow, ipcMain } from "electron";
import { isAssignableRole, type Role } from "@adcode/collab";
import { CHANNELS, type CollabStatusView } from "../shared/api.ts";
import { createCollabRuntime, type CollabRuntime } from "./collab/runtime.ts";
import { localAddresses } from "./collab/lanTransport.ts";
import { decodeInvite, encodeInvite } from "@adcode/collab";

/** The runtime is created lazily: a user who never shares anything never starts one. */
let runtime: CollabRuntime | null = null;

/**
 * How to find the open folder.
 *
 * Held here because `collabFileChanged` is called from the save path with an **absolute** path,
 * while a session keys its documents by workspace-relative path - the form the wire protocol
 * uses. Converting needs the root, and the save path has no reason to know about sessions.
 */
let workspaceRootOf: () => string | null = () => null;

function broadcast(channel: string, ...args: unknown[]): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, ...args);
  }
}

function ensureRuntime(): CollabRuntime {
  if (runtime !== null) return runtime;

  runtime = createCollabRuntime({
    onStatus: (status) => broadcast(CHANNELS.collabStatusChanged, status satisfies CollabStatusView),
    onDocUpdate: (path, update) => broadcast(CHANNELS.collabDocUpdate, path, update),
    onPresence: (presence) => broadcast(CHANNELS.collabPresenceChanged, presence),
    onCommitRequest: (request) => broadcast(CHANNELS.collabCommitRequested, request),
    onNotice: (detail) => broadcast(CHANNELS.collabNotice, detail),
  });

  return runtime;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string.`);
  return value;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be a boolean.`);
  return value;
}

/** A coordinate from the renderer. One-based, integral, and bounded, as Monaco reports them. */
function requirePosition(value: unknown, field: string): { line: number; column: number } {
  if (typeof value !== "object" || value === null) throw new Error(`${field} must be a position.`);

  const record = value as Record<string, unknown>;
  const line = record["line"];
  const column = record["column"];

  if (
    typeof line !== "number" ||
    typeof column !== "number" ||
    !Number.isInteger(line) ||
    !Number.isInteger(column) ||
    line < 1 ||
    column < 1
  ) {
    throw new Error(`${field} must be a one-based integer position.`);
  }

  return { line, column };
}

export function registerCollabIpc(deps: { readonly workspaceRoot: () => string | null }): void {
  workspaceRootOf = deps.workspaceRoot;

  ipcMain.handle(CHANNELS.collabHost, async (_event, raw: unknown) => {
    if (typeof raw !== "object" || raw === null) throw new Error("Options must be an object.");

    const options = raw as Record<string, unknown>;
    const bind = options["bind"];

    /*
     * The bind mode is an allow-list of two strings, and there is no default.
     *
     * This is the argument that decides whether a port is opened to the local network. A
     * permissive parse here - anything truthy meaning "lan", say - would make the difference
     * between a private and a published session depend on a typo.
     */
    if (bind !== "lan" && bind !== "loopback") {
      throw new Error('bind must be "lan" or "loopback".');
    }

    const port = options["port"];
    if (typeof port !== "number" || !Number.isInteger(port) || port < 0 || port > 65_535) {
      throw new Error("port must be an integer between 0 and 65535.");
    }

    const displayName = requireString(options["displayName"], "displayName");

    return ensureRuntime().startHosting(deps.workspaceRoot(), { bind, port, displayName });
  });

  ipcMain.handle(CHANNELS.collabJoin, async (_event, code: unknown, displayName: unknown) =>
    ensureRuntime().joinWith(requireString(code, "code"), requireString(displayName, "displayName")),
  );

  ipcMain.handle(CHANNELS.collabLeave, async () => {
    if (runtime === null) return ensureRuntime().status();
    return runtime.leave();
  });

  ipcMain.handle(CHANNELS.collabStatus, async () => ensureRuntime().status());

  // Reported from the main process because only it can enumerate interfaces, and the renderer
  // has no business with `node:os`.
  ipcMain.handle(CHANNELS.collabAddresses, async () => localAddresses());

  ipcMain.handle(CHANNELS.collabReencodeInvite, async (_event, address: unknown) => {
    const host = requireString(address, "address");
    const current = ensureRuntime().status();

    if (current.invite === null || current.port === null) return null;

    /*
     * Re-issued from the existing code rather than from a stored token.
     *
     * The token is not kept anywhere this file can see, which is deliberate - so the only way
     * to build a new code is to decode the one already issued and swap the address. If that
     * decode fails, something is wrong enough that handing out a code would be worse than
     * returning nothing.
     */
    const decoded = decodeInvite(current.invite);
    if (decoded === null) return null;

    try {
      return encodeInvite({ ...decoded, host });
    } catch {
      // The address came from the renderer, so an unusable one is possible. `null` rather than a
      // throw: the UI's list of addresses is a convenience and a bad pick is not an error state.
      return null;
    }
  });

  ipcMain.handle(CHANNELS.collabSetRole, async (_event, participantId: unknown, role: unknown) => {
    const id = requireString(participantId, "participantId");
    const next = requireString(role, "role");

    // `host` is refused here as well as in the wire protocol. A session has exactly one host and
    // no path may produce a second.
    if (!isAssignableRole(next)) throw new Error("role must be \"editor\" or \"viewer\".");

    return ensureRuntime().setRole(id, next as Role);
  });

  ipcMain.handle(
    CHANNELS.collabSetTerminalWrite,
    async (_event, participantId: unknown, allowed: unknown) =>
      ensureRuntime().setTerminalWrite(
        requireString(participantId, "participantId"),
        requireBoolean(allowed, "allowed"),
      ),
  );

  ipcMain.handle(CHANNELS.collabOpenDoc, async (_event, path: unknown) =>
    ensureRuntime().openDoc(requireString(path, "path")),
  );

  /*
   * `send`, not `invoke`: this is on the keystroke path.
   *
   * Every character typed in a shared file produces one of these, and a round trip per keystroke
   * would put IPC latency between the key and the screen. The renderer has already applied the
   * edit to its own replica, so there is nothing to wait for - the same reasoning as the LSP
   * document-sync channels.
   */
  ipcMain.on(CHANNELS.collabPushUpdate, (_event, path: unknown, update: unknown) => {
    if (typeof path !== "string" || typeof update !== "string") return;
    runtime?.pushUpdate(path, update);
  });

  ipcMain.handle(CHANNELS.collabSaveDoc, async (_event, path: unknown) =>
    ensureRuntime().saveDoc(requireString(path, "path")),
  );

  ipcMain.on(CHANNELS.collabPresence, (_event, path: unknown, cursor: unknown, selection: unknown) => {
    if (runtime === null) return;
    if (path !== null && typeof path !== "string") return;

    try {
      const position = requirePosition(cursor, "cursor");
      const range =
        selection === null || selection === undefined
          ? null
          : {
              start: requirePosition((selection as Record<string, unknown>)["start"], "selection.start"),
              end: requirePosition((selection as Record<string, unknown>)["end"], "selection.end"),
            };

      runtime.publishPresence(path, position, range);
    } catch {
      // A malformed cursor costs one presence update. Throwing on a `send` channel has nowhere
      // to go - there is no caller waiting - so it would only surface as an unhandled rejection.
    }
  });

  ipcMain.on(CHANNELS.collabRequestCommit, (_event, message: unknown) => {
    if (typeof message !== "string" || message.length === 0) return;
    runtime?.requestCommit(message);
  });

  ipcMain.handle(
    CHANNELS.collabDecideCommit,
    async (_event, id: unknown, approved: unknown, detail: unknown) => {
      ensureRuntime().decideCommit(
        requireString(id, "id"),
        requireBoolean(approved, "approved"),
        requireString(detail, "detail"),
      );
    },
  );
}

/**
 * Tell the session a file changed underneath it.
 *
 * Called from the save path and from anything else that writes a file the host might be sharing -
 * a git checkout, a formatter. Without it, a shared document keeps the text it had before the
 * write and the next save puts it back, silently reverting whatever changed the file.
 */
export async function collabFileChanged(absolutePath: string): Promise<void> {
  if (runtime === null) return;

  const root = workspaceRootOf();
  if (root === null) return;

  /*
   * Absolute to workspace-relative, with forward slashes.
   *
   * `relative` yields backslashes on Windows, and the protocol refuses those outright - so a
   * document keyed from a backslash path would never match the key a guest asked for, and this
   * notification would silently do nothing on the platform this app primarily ships on.
   */
  const relativePath = relative(root, absolutePath).split(sep).join("/");

  // A file outside the shared folder is not part of the session. `..` is the only reliable
  // signal for that from `relative`, and an empty string means the root itself.
  if (relativePath.length === 0 || relativePath.startsWith("../")) return;

  await runtime.reloadDoc(relativePath);
}

/** Shut the session down on quit. A socket left open outlives the window. */
export async function disposeCollab(): Promise<void> {
  await runtime?.dispose();
  runtime = null;
}
