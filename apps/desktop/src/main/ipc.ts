/**
 * The only place the renderer can reach the main process.
 *
 * Each handler validates its own arguments. The renderer is hostile by assumption
 * (brief §1), so "the preload only sends well-formed messages" is not a safety property
 * - a compromised renderer talks to `ipcRenderer` directly.
 */
import { BrowserWindow, app, ipcMain } from "electron";
import { restoreSession, saveSession } from "./session.ts";
import { CHANNELS } from "../shared/api.ts";
import { getAdRuntime } from "./adRuntime.ts";
import { onSettingsChanged, readSettings, resetSettings, writeSetting } from "./settings.ts";
import { mcpConnection } from "./memory.ts";
import { registerGitIpc } from "./gitIpc.ts";
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
  writeTextFile,
} from "./workspace.ts";

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

  ipcMain.handle(CHANNELS.sessionRestore, () => restoreSession());

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

  ipcMain.handle(CHANNELS.fsWrite, (_event, filePath: unknown, text: unknown) => {
    if (!isString(filePath) || !isString(text)) throw new Error("expected a path and text");
    return writeTextFile(filePath, text);
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
