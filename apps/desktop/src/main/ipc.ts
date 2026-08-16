/**
 * The only place the renderer can reach the main process.
 *
 * Each handler validates its own arguments. The renderer is hostile by assumption
 * (brief §1), so "the preload only sends well-formed messages" is not a safety property
 * - a compromised renderer talks to `ipcRenderer` directly.
 */
import { BrowserWindow, app, clipboard, ipcMain } from "electron";
import { restoreSession, saveSession } from "./session.ts";
import {
  clearDraft,
  recordSave,
  historyRead,
  historyVersions,
  recordDraft,
  recoverableDrafts,
} from "./history.ts";
import { CHANNELS } from "../shared/api.ts";
import { getAdRuntime } from "./adRuntime.ts";
import { onSettingsChanged, readSettings, resetSettings, writeSetting } from "./settings.ts";
import { mcpConnection } from "./memory.ts";
import { registerGitIpc } from "./gitIpc.ts";
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
  openWorkspace,
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

export function registerIpc(): void {
  registerGitIpc();

  ipcMain.handle(CHANNELS.workspaceOpen, () => openWorkspace());
  ipcMain.handle(CHANNELS.workspaceCurrent, () => currentWorkspace());

  ipcMain.handle(CHANNELS.fsSaveAs, (_event, text: unknown, suggestedName: unknown) =>
    isString(text) && isString(suggestedName) ? saveTextFileAs(text, suggestedName) : null,
  );

  ipcMain.handle(CHANNELS.workspaceClose, () => {
    setWorkspaceRoot(null);
    // The quick-open index and the git handle were both bound to the old root.
    invalidateFileCache();
  });

  ipcMain.handle(CHANNELS.sessionRestore, () => restoreSession());

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

    void saveSession({
      root: asString(raw["root"]),
      openFiles: Array.isArray(raw["openFiles"])
        ? raw["openFiles"].filter((value): value is string => typeof value === "string")
        : [],
      activeFile: asString(raw["activeFile"]),
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
    if (result.ok) await recordSave(filePath, text);
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

  ipcMain.handle(CHANNELS.memoryConnection, () => mcpConnection());

  ipcMain.handle(CHANNELS.settingsRead, () => readSettings());

  ipcMain.handle(CHANNELS.settingsWrite, (_event, id: unknown, value: unknown) => {
    if (!isString(id)) throw new Error("expected a setting id");
    if (typeof value !== "boolean" && !isString(value)) throw new Error("expected a value");
    return writeSetting(id, value);
  });

  ipcMain.handle(CHANNELS.settingsReset, () => resetSettings());

  onSettingsChanged((values) => broadcast(CHANNELS.settingsChanged, values));

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
}
