/**
 * The only place the renderer can reach the main process.
 *
 * Each handler validates its own arguments. The renderer is hostile by assumption
 * (brief §1), so "the preload only sends well-formed messages" is not a safety property
 * - a compromised renderer talks to `ipcRenderer` directly.
 */
import { stat } from "node:fs/promises";
import { BrowserWindow, app, clipboard, ipcMain, shell } from "electron";
import {
  detectPreviewProject,
  previewLog,
  previewStatus,
  startPreview,
  stopPreview,
} from "./preview.ts";
import { stripAnsi } from "./devCommand.ts";
import {
  completionAt,
  configureLsp,
  documentChanged,
  documentClosed,
  documentOpened,
  hoverAt,
  languageServerStates,
  setCustomServers,
  setLspEnabled,
  setLspWorkspace,
  toWireCompletion,
} from "./lsp.ts";
import { parseCustomServers } from "@adcode/lsp";
import { restoreSession, saveSession } from "./session.ts";
import {
  clearDraft,
  recordSave,
  historyRead,
  historyVersions,
  recordDraft,
  recoverableDrafts,
} from "./history.ts";
import { CHANNELS, type PreviewStatus, type RuntimeCheckView } from "../shared/api.ts";
import { downloadUrlFor, installCommandFor, runtimeById, runtimeFor } from "../shared/runtimes.ts";
import {
  onKeybindingsChanged,
  readKeybindings,
  resetKeybindings,
  writeKeybinding,
} from "./keybindings.ts";
import { findExecutable } from "./executables.ts";
import { getAdRuntime } from "./adRuntime.ts";
import {
  currentSettings,
  onSettingsChanged,
  readSettings,
  resetSettings,
  writeSetting,
} from "./settings.ts";
import { mcpConnection } from "./memory.ts";
import { registerGitIpc } from "./gitIpc.ts";
import { installApplicationMenu } from "./menu.ts";
import { clearRecents, forgetRecent, recentFolders, rememberRecent } from "./recents.ts";
import { collabFileChanged, disposeCollab, registerCollabIpc } from "./collabIpc.ts";
import { invalidateFileCache } from "./sourceControl.ts";
import {
  aiApplyHunks,
  aiCancel,
  aiReset,
  aiSend,
  aiStatus,
  clearProviderKey,
  setProviderKey,
} from "./ai.ts";
import {
  createTerminal,
  detectProfiles,
  disposeTerminal,
  resizeTerminal,
  writeTerminal,
} from "./terminal.ts";
import {
  currentWorkspace,
  listDirectory,
  onWorkspaceRootChanged,
  openWorkspace,
  openWorkspaceAt,
  pickFileToOpen,
  readTextFile,
  saveTextFileAs,
  setWorkspaceRoot,
  writeTextFile,
} from "./workspace.ts";
import {
  copyEntry,
  createFile,
  createFolder,
  deleteEntry,
  duplicateEntry,
  importEntry,
  moveEntry,
  renameEntry,
  revealEntry,
  trashEntry,
} from "./fileOps.ts";

const isString = (value: unknown): value is string => typeof value === "string";
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function broadcast(channel: string, ...args: unknown[]): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, ...args);
  }
}

/**
 * The preview's state can change without the renderer asking - closing a folder stops the
 * server. The toolbar has to hear about that, or it sits there offering to open a URL that
 * no longer answers.
 */
function broadcastPreview(status: PreviewStatus): void {
  broadcast(CHANNELS.previewChanged, status);
}

/**
 * The address is ours or it is not opened.
 *
 * A project's dev server chooses its own port and prints its own address, and that string
 * ends up here on its way to `shell.openExternal`. `startsWith("http://127.0.0.1:")` was
 * enough while ADCode bound the socket itself; it is not enough now that the string came
 * out of somebody else's stdout. Parsed rather than pattern-matched, because
 * `http://127.0.0.1:3000@evil.example` starts with exactly the right prefix.
 */
function isLoopback(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

    return ["127.0.0.1", "localhost", "[::1]", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * The dev server's output, streamed to whoever is showing the log drawer.
 *
 * Status changes arrive on the same path because a project preview's URL is not known when
 * `start` returns - it appears when the toolchain prints it, which can be a minute later.
 */
/**
 * §4's escape hatch, applied.
 *
 * Both rows restart every running server, because neither can be honoured by one that is
 * already up: turning the client off has to stop them, and changing the custom list changes
 * which program a language should be talking to. They start again on the next edit.
 */
function applyLanguageSettings(values: Record<string, unknown>): void {
  const enabled = values["adcode.language.lspClient"] !== false;
  const custom = values["adcode.language.customServers"];

  setCustomServers(
    enabled && typeof custom === "string" ? parseCustomServers(custom) : [],
  );
  setLspEnabled(enabled);
}

const previewEvents = {
  onStatus: (status: PreviewStatus) => broadcastPreview(status),
  onOutput: (chunk: string) => broadcast(CHANNELS.previewOutput, stripAnsi(chunk)),
};

export function registerIpc(): void {
  registerGitIpc();
  registerCollabIpc({ workspaceRoot: () => currentWorkspace()?.root ?? null });

  /*
   * A session shares one folder, so changing the folder ends the session.
   *
   * Subscribed at the source for the same reason the LSP notification below is: the route that
   * gets forgotten is session restore, because no user action triggers it. Leaving a session
   * running across a folder change would leave guests editing documents backed by files the
   * host is no longer looking at.
   */
  onWorkspaceRootChanged(() => {
    void disposeCollab();
  });

  /*
   * Language servers are per-workspace: rust-analyzer indexes a crate, pyright resolves
   * against a project root. Pointing an existing one at a new folder is not something the
   * protocol supports, so the old servers stop and new ones start on demand.
   *
   * Subscribed at the source rather than wired into each handler. The three routes that
   * change the root are the open dialog, closing the folder, and session restore - and
   * restore is the one that gets forgotten, because no user action triggers it, so the
   * per-handler version worked everywhere except on every launch after the first.
   */
  onWorkspaceRootChanged((root) => setLspWorkspace(root));
  setLspWorkspace(currentWorkspace()?.root ?? null);

  /*
   * The recent folders are part of the menu now, so every change to the list has to
   * reach the menu the main process owns.
   *
   * Fire-and-forget, and never allowed to fail the operation it follows: rebuilding a menu
   * is a cosmetic consequence of opening a folder, and a folder that opened successfully
   * must not report an error because the File menu could not be redrawn afterwards.
   */
  const rebuildMenu = (): void => {
    void installApplicationMenu().catch(() => {
      /* the menu keeps whatever it had */
    });
  };

  const remember = async (root: string): Promise<void> => {
    await rememberRecent(root);
    rebuildMenu();
  };

  ipcMain.handle(CHANNELS.workspaceOpen, async () => {
    const opened = await openWorkspace();
    if (opened !== null) await remember(opened.root);
    return opened;
  });

  ipcMain.handle(CHANNELS.workspaceOpenPath, async (_event, root: unknown) => {
    if (!isString(root)) throw new Error("expected a folder path");

    /*
     * Checked before opening, so a stale recents row cannot set the workspace to a path that
     * is not there. Without this the tree would render empty against a root that does not
     * exist, which reads as the folder being empty rather than gone.
     */
    try {
      const info = await stat(root);
      if (!info.isDirectory()) return null;
    } catch {
      return null;
    }

    const opened = openWorkspaceAt(root);
    if (opened !== null) await remember(opened.root);
    return opened;
  });

  ipcMain.handle(CHANNELS.workspaceCurrent, () => currentWorkspace());
  ipcMain.handle(CHANNELS.workspaceRecents, () => recentFolders());

  ipcMain.handle(CHANNELS.workspaceForgetRecent, (_event, root: unknown) =>
    isString(root) ? forgetRecent(root).finally(rebuildMenu) : recentFolders(),
  );

  ipcMain.handle(CHANNELS.workspaceClearRecents, () => clearRecents().finally(rebuildMenu));

  ipcMain.handle(CHANNELS.filesOpenDialog, () => pickFileToOpen());

  ipcMain.handle(CHANNELS.appInfo, () => ({
    version: app.getVersion(),
    electron: process.versions["electron"] ?? "",
    chrome: process.versions["chrome"] ?? "",
    node: process.versions["node"] ?? "",
    platform: `${process.platform}-${process.arch}`,
  }));

  ipcMain.handle(CHANNELS.fsSaveAs, (_event, text: unknown, suggestedName: unknown) =>
    isString(text) && isString(suggestedName) ? saveTextFileAs(text, suggestedName) : null,
  );

  ipcMain.handle(CHANNELS.workspaceClose, async () => {
    setWorkspaceRoot(null);
    // The quick-open index and the git handle were both bound to the old root. The
    // language servers were too, and `onWorkspaceRootChanged` above has already heard.
    invalidateFileCache();

    // So was the preview. Left running it would keep serving a folder the user has closed,
    // over a URL that is still live in whatever browser tab they opened it in - and in
    // project mode it would leave a dev server holding a port for the rest of the session.
    broadcastPreview(await stopPreview());
  });

  ipcMain.handle(CHANNELS.sessionRestore, async () => {
    const restored = await restoreSession();

    /*
     * A restored folder counts as recently opened.
     *
     * Without this the list stays empty for anyone who only ever reopens the same project,
     * because restoring never goes through the open dialog - so the one feature meant to save
     * them from the folder picker would be blank for exactly the person who needs it least
     * often and notice it most.
     */
    if (restored.root !== null) await remember(restored.root);

    return restored;
  });

  /* ── Window ───────────────────────────────────────────────────────────── */

  ipcMain.on(CHANNELS.windowFullScreen, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    window?.setFullScreen(!window.isFullScreen());
  });

  ipcMain.on(CHANNELS.windowDevTools, (event) => {
    event.sender.toggleDevTools();
  });

  ipcMain.on(CHANNELS.windowZoom, (event, direction: unknown) => {
    if (typeof direction !== "number") return;

    // Electron's zoom level is logarithmic; ±0.5 steps land on the same sequence of sizes
    // the browser's own zoom uses, and clamping stops the UI from becoming unusable.
    const next = direction === 0 ? 0 : event.sender.getZoomLevel() + Math.sign(direction) * 0.5;
    event.sender.setZoomLevel(Math.max(-3, Math.min(4, next)));
  });

  ipcMain.handle(CHANNELS.historyVersions, (_event, path: unknown) =>
    typeof path === "string" ? historyVersions(path) : [],
  );

  ipcMain.handle(CHANNELS.historyRead, (_event, path: unknown, id: unknown) =>
    typeof path === "string" && typeof id === "string" ? historyRead(path, id) : null,
  );

  ipcMain.handle(CHANNELS.historyDrafts, () => recoverableDrafts());

  ipcMain.on(CHANNELS.historyDraft, (_event, path: unknown, text: unknown) => {
    if (typeof path === "string" && typeof text === "string") void recordDraft(path, text);
  });

  ipcMain.on(CHANNELS.historyClearDraft, (_event, path: unknown) => {
    if (typeof path === "string") void clearDraft(path);
  });

  ipcMain.on(CHANNELS.sessionSave, (_event, state: unknown) => {
    const raw = (state ?? {}) as Record<string, unknown>;
    const asString = (value: unknown): string | null =>
      typeof value === "string" && value.length > 0 ? value : null;

    // Shape only. `sessionStore` decides what a usable layout is, and the renderer
    // clamps it to the real window - neither of which this layer can judge.
    const layout = raw["layout"];

    void saveSession({
      root: asString(raw["root"]),
      openFiles: Array.isArray(raw["openFiles"])
        ? raw["openFiles"].filter((value): value is string => typeof value === "string")
        : [],
      activeFile: asString(raw["activeFile"]),
      ...(typeof layout === "object" && layout !== null
        ? {
            layout: {
              sidebarWidth: Number((layout as Record<string, unknown>)["sidebarWidth"]),
              panelHeight: Number((layout as Record<string, unknown>)["panelHeight"]),
            },
          }
        : {}),
    });
  });

  ipcMain.handle(CHANNELS.fsList, (_event, dirPath: unknown) => {
    if (!isString(dirPath)) throw new Error("expected a path");
    return listDirectory(dirPath);
  });

  ipcMain.handle(CHANNELS.fsRead, (_event, filePath: unknown) => {
    if (!isString(filePath)) throw new Error("expected a path");
    return readTextFile(filePath);
  });

  ipcMain.handle(CHANNELS.fsWrite, async (_event, filePath: unknown, text: unknown) => {
    if (!isString(filePath) || !isString(text)) throw new Error("expected a path and text");

    const result = await writeTextFile(filePath, text);
    // §4: local history records what was saved, not what was attempted - and a failed
    // save leaves the draft in place, because the unsaved text is still the only copy.
    if (result.ok) {
      await recordSave(filePath, text);

      /*
       * Tell any running session the file moved underneath it.
       *
       * This is the ordinary save path - the one a host uses when they press Ctrl+S on a file
       * they happen to be sharing. Without this the shared document keeps the text it had
       * before the write, and the next save from any peer puts it back, silently reverting
       * whatever just landed on disk.
       */
      await collabFileChanged(filePath);
    }
    return result;
  });

  /*
   * Structural file operations.
   *
   * The arguments are only shape-checked here; `fileOps` owns the rules that matter -
   * the name is one storable segment, the path stays inside the workspace, and neither
   * the workspace root nor anything in `.git` can be renamed or deleted. Each returns an
   * outcome rather than throwing, so the renderer always has something to report.
   */
  ipcMain.handle(CHANNELS.fsCreateFile, (_event, parentDir: unknown, name: unknown) =>
    createFile(parentDir, name),
  );

  ipcMain.handle(CHANNELS.fsCreateFolder, (_event, parentDir: unknown, name: unknown) =>
    createFolder(parentDir, name),
  );

  ipcMain.handle(CHANNELS.fsRename, (_event, target: unknown, name: unknown) =>
    renameEntry(target, name),
  );

  ipcMain.handle(CHANNELS.fsTrash, (_event, target: unknown) => trashEntry(target));

  ipcMain.handle(CHANNELS.fsDelete, (_event, target: unknown) => deleteEntry(target));

  ipcMain.handle(CHANNELS.fsDuplicate, (_event, target: unknown) => duplicateEntry(target));

  ipcMain.handle(CHANNELS.fsCopy, (_event, source: unknown, targetDir: unknown) =>
    copyEntry(source, targetDir),
  );

  ipcMain.handle(CHANNELS.fsMove, (_event, source: unknown, targetDir: unknown) =>
    moveEntry(source, targetDir),
  );

  ipcMain.handle(CHANNELS.fsImport, (_event, source: unknown, targetDir: unknown) =>
    importEntry(source, targetDir),
  );

  ipcMain.handle(CHANNELS.fsReveal, (_event, target: unknown) => revealEntry(target));

  ipcMain.handle(CHANNELS.clipboardWrite, (_event, text: unknown) => {
    if (!isString(text)) throw new Error("expected text");
    clipboard.writeText(text);
  });

  ipcMain.handle(CHANNELS.terminalProfiles, () => detectProfiles());

  ipcMain.handle(CHANNELS.terminalCreate, (_event, options: unknown) => {
    const o = (options ?? {}) as Record<string, unknown>;
    if (!isFiniteNumber(o["cols"]) || !isFiniteNumber(o["rows"])) {
      throw new Error("expected cols and rows");
    }

    return createTerminal(
      {
        ...(isString(o["profileId"]) ? { profileId: o["profileId"] } : {}),
        ...(isString(o["cwd"]) ? { cwd: o["cwd"] } : {}),
        cols: o["cols"],
        rows: o["rows"],
      },
      {
        onData: (id, data) => broadcast(CHANNELS.terminalData, id, data),
        onExit: (id, exitCode) => broadcast(CHANNELS.terminalExit, id, exitCode),
      },
    );
  });

  ipcMain.on(CHANNELS.terminalWrite, (_event, id: unknown, data: unknown) => {
    if (isString(id) && isString(data)) writeTerminal(id, data);
  });

  ipcMain.on(CHANNELS.terminalResize, (_event, id: unknown, cols: unknown, rows: unknown) => {
    if (isString(id) && isFiniteNumber(cols) && isFiniteNumber(rows)) resizeTerminal(id, cols, rows);
  });

  ipcMain.on(CHANNELS.terminalDispose, (_event, id: unknown) => {
    if (isString(id)) disposeTerminal(id);
  });

  ipcMain.handle(CHANNELS.platformInfo, () => ({
    platform: process.platform,
    isPackaged: app.isPackaged,
  }));

  /* ── Live preview ─────────────────────────────────────────────────────── */

  ipcMain.handle(CHANNELS.previewStart, async (_event, mode: unknown) => {
    // The renderer is hostile by assumption: anything that is not one of the two known
    // modes is read as "no preference" rather than passed along.
    const requested = mode === "static" || mode === "project" ? mode : undefined;

    const status = await startPreview(currentWorkspace()?.root ?? null, requested, previewEvents);
    broadcastPreview(status);
    return status;
  });

  ipcMain.handle(CHANNELS.previewStop, async () => {
    const status = await stopPreview();
    broadcastPreview(status);
    return status;
  });

  ipcMain.handle(CHANNELS.previewStatus, () => previewStatus());
  ipcMain.handle(CHANNELS.previewLog, () => previewLog());

  ipcMain.handle(CHANNELS.previewDetect, () =>
    detectPreviewProject(currentWorkspace()?.root ?? null),
  );

  /*
   * The renderer names the intent and supplies nothing. Accepting a URL here would hand a
   * compromised renderer `shell.openExternal(anything)`, which is a way out of the sandbox
   * wearing the costume of a convenience - and the only address worth opening is the one
   * this process just bound anyway.
   */
  ipcMain.handle(CHANNELS.previewOpenExternal, async () => {
    const { url } = previewStatus();
    if (url === null || !isLoopback(url)) return;

    await shell.openExternal(url);
  });

  /* ── Runtimes ─────────────────────────────────────────────────────────── */

  /*
   * "Is Python installed?", asked before the Run button types anything.
   *
   * The lookup is `findExecutable`, the same PATH-and-PATHEXT walk the language servers
   * use - which matters on Windows, where an npm-installed tool is a `.cmd` shim that
   * `spawn` cannot see without consulting PATHEXT. A check that reported "not installed"
   * for a program the user has would be worse than no check at all.
   *
   * A command with no entry in the table returns null: ADCode has nothing useful to say
   * about it, and the run goes ahead untouched.
   */
  ipcMain.handle(CHANNELS.runtimeCheck, (_event, command: unknown): RuntimeCheckView | null => {
    if (!isString(command)) return null;

    const runtime = runtimeFor(command);
    if (runtime === null) return null;

    return {
      id: runtime.id,
      label: runtime.label,
      command,
      found: findExecutable(command, process.platform) !== null,
      url: downloadUrlFor(runtime, process.platform),
      install: installCommandFor(runtime, process.platform),
    };
  });

  /*
   * The renderer names a runtime; this process owns the address.
   *
   * Same rule as `preview:open-external` above, for the same reason: a handler that opened
   * whatever URL it was handed would be a way out of the sandbox wearing the costume of a
   * convenience. The id is looked up here, and the result is checked to be https even
   * though every entry in the table already is - the check is what keeps that true.
   */
  ipcMain.handle(CHANNELS.runtimeOpenInstall, async (_event, id: unknown) => {
    if (!isString(id)) return;

    const runtime = runtimeById(id);
    if (runtime === null) return;

    const url = downloadUrlFor(runtime, process.platform);
    if (!url.startsWith("https://")) return;

    await shell.openExternal(url);
  });

  /* ── Language servers ─────────────────────────────────────────────────── */

  /*
   * Every handler validates its own arguments, and these more carefully than most: they
   * are on the keystroke path, they name a file and a language, and what they reach is a
   * subprocess. A malformed path here would be forwarded to a language server as a URI.
   */
  ipcMain.on(CHANNELS.lspOpened, (_event, path: unknown, languageId: unknown, text: unknown) => {
    if (isString(path) && isString(languageId) && isString(text)) {
      documentOpened(path, languageId, text);
    }
  });

  ipcMain.on(CHANNELS.lspChanged, (_event, path: unknown, languageId: unknown, text: unknown) => {
    if (isString(path) && isString(languageId) && isString(text)) {
      documentChanged(path, languageId, text);
    }
  });

  ipcMain.on(CHANNELS.lspClosed, (_event, path: unknown, languageId: unknown) => {
    if (isString(path) && isString(languageId)) documentClosed(path, languageId);
  });

  ipcMain.handle(
    CHANNELS.lspCompletion,
    async (_event, path: unknown, languageId: unknown, line: unknown, column: unknown) => {
      if (!isString(path) || !isString(languageId)) return [];
      if (!isFiniteNumber(line) || !isFiniteNumber(column)) return [];

      const items = await completionAt(path, languageId, line, column);
      return items.map(toWireCompletion).filter((item) => item !== null);
    },
  );

  ipcMain.handle(
    CHANNELS.lspHover,
    (_event, path: unknown, languageId: unknown, line: unknown, column: unknown) => {
      if (!isString(path) || !isString(languageId)) return null;
      if (!isFiniteNumber(line) || !isFiniteNumber(column)) return null;

      return hoverAt(path, languageId, line, column);
    },
  );

  ipcMain.handle(CHANNELS.lspStates, () => languageServerStates());

  configureLsp({
    onDiagnostics: (file, diagnostics) => broadcast(CHANNELS.lspDiagnostics, file, diagnostics),
    onState: (list) => broadcast(CHANNELS.lspStateChanged, list),
  });

  ipcMain.handle(CHANNELS.memoryConnection, () => mcpConnection());

  ipcMain.handle(CHANNELS.settingsRead, () => readSettings());

  ipcMain.handle(CHANNELS.settingsWrite, (_event, id: unknown, value: unknown) => {
    if (!isString(id)) throw new Error("expected a setting id");
    if (typeof value !== "boolean" && !isString(value)) throw new Error("expected a value");
    return writeSetting(id, value);
  });

  ipcMain.handle(CHANNELS.settingsReset, () => resetSettings());

  /* ── Keyboard shortcuts ───────────────────────────────────────────────── */

  ipcMain.handle(CHANNELS.keybindingsRead, () => readKeybindings());

  ipcMain.handle(CHANNELS.keybindingsWrite, (_event, command: unknown, chord: unknown) => {
    if (!isString(command)) throw new Error("expected a command id");
    if (chord !== null && !isString(chord)) throw new Error("expected a chord or null");

    // The store validates the chord itself and drops an unbindable one. Doing it there
    // rather than here is what makes a hand-edited file safe too, and there is no second
    // rule for what counts as bindable.
    return writeKeybinding(command, chord);
  });

  ipcMain.handle(CHANNELS.keybindingsReset, (_event, command: unknown) =>
    resetKeybindings(isString(command) ? command : undefined),
  );

  /*
   * Every change rebuilds the application menu.
   *
   * Not an optimisation to skip: Electron registers accelerators from the menu, so until
   * this runs the old chord is still live and the new one does nothing. Rebuilding is the
   * whole mechanism by which a remap takes effect without a restart.
   */
  onKeybindingsChanged((overrides) => {
    broadcast(CHANNELS.keybindingsChanged, overrides);
    void installApplicationMenu();
  });


  onSettingsChanged((values) => {
    broadcast(CHANNELS.settingsChanged, values);
    applyLanguageSettings(values);
  });

  // The cached values rather than a read: this runs during registration, and the first
  // `onSettingsChanged` will correct it the moment the file has actually been loaded.
  applyLanguageSettings(currentSettings());

  ipcMain.handle(CHANNELS.aiProviders, () => aiStatus());

  ipcMain.handle(CHANNELS.aiSetKey, (_event, provider: unknown, key: unknown) => {
    if (!isString(provider) || !isString(key)) throw new Error("expected a provider and key");
    return setProviderKey(provider, key);
  });

  ipcMain.handle(CHANNELS.aiClearKey, (_event, provider: unknown) => {
    if (!isString(provider)) throw new Error("expected a provider");
    return clearProviderKey(provider);
  });

  ipcMain.handle(CHANNELS.aiSend, (_event, text: unknown) => {
    if (!isString(text)) throw new Error("expected text");
    return aiSend(text);
  });

  ipcMain.on(CHANNELS.aiCancel, () => aiCancel());
  ipcMain.on(CHANNELS.aiReset, () => aiReset());

  ipcMain.handle(CHANNELS.aiApplyHunks, (_event, path: unknown, ids: unknown) => {
    if (!isString(path)) throw new Error("expected a path");
    if (!Array.isArray(ids) || !ids.every(isString)) throw new Error("expected hunk ids");
    return aiApplyHunks(path, ids);
  });

  const ads = getAdRuntime();

  ipcMain.on(CHANNELS.adPainted, (_event, creativeId: unknown) => {
    if (isString(creativeId)) ads.notePainted(creativeId);
  });

  ipcMain.on(CHANNELS.adDismissed, (_event, creativeId: unknown) => {
    if (isString(creativeId)) ads.noteDismissed(creativeId);
  });

  ipcMain.on(CHANNELS.adClicked, (_event, creativeId: unknown) => {
    if (isString(creativeId)) ads.noteClicked(creativeId);
  });

  ipcMain.on(CHANNELS.adSuppressionChanged, (_event, suppressed: unknown) => {
    if (typeof suppressed === "boolean") ads.setSuppressed(suppressed);
  });

  ipcMain.handle(CHANNELS.adRefreshEarnings, () => ads.refreshEarnings());
}
