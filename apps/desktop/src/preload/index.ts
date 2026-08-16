/**
 * The contextBridge surface. No logic (brief §2) - every function here forwards to a
 * channel and nothing more, so there is no behaviour on this side of the boundary to
 * get wrong or to attack.
 *
 * Runs in a sandboxed preload, so only `electron`'s own module is available; no Node.
 */
import { contextBridge, ipcRenderer } from "electron";
import { CHANNELS } from "../shared/api.ts";
import type { AdcodeApi } from "../shared/api.ts";

/** Wrap a broadcast channel as a subscribe function that returns its own unsubscribe. */
function subscribe<Args extends unknown[]>(
  channel: string,
  listener: (...args: Args) => void,
): () => void {
  const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]): void => {
    listener(...(args as Args));
  };

  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: AdcodeApi = {
  workspace: {
    open: () => ipcRenderer.invoke(CHANNELS.workspaceOpen),
    current: () => ipcRenderer.invoke(CHANNELS.workspaceCurrent),
    list: (dirPath) => ipcRenderer.invoke(CHANNELS.fsList, dirPath),
  },
  files: {
    read: (filePath) => ipcRenderer.invoke(CHANNELS.fsRead, filePath),
    write: (filePath, text) => ipcRenderer.invoke(CHANNELS.fsWrite, filePath, text),
  },
  terminal: {
    profiles: () => ipcRenderer.invoke(CHANNELS.terminalProfiles),
    create: (options) => ipcRenderer.invoke(CHANNELS.terminalCreate, options),
    write: (id, data) => ipcRenderer.send(CHANNELS.terminalWrite, id, data),
    resize: (id, cols, rows) => ipcRenderer.send(CHANNELS.terminalResize, id, cols, rows),
    dispose: (id) => ipcRenderer.send(CHANNELS.terminalDispose, id),
    onData: (listener) => subscribe(CHANNELS.terminalData, listener),
    onExit: (listener) => subscribe(CHANNELS.terminalExit, listener),
  },
  platform: {
    info: () => ipcRenderer.invoke(CHANNELS.platformInfo),
    onFocusChange: (listener) => subscribe(CHANNELS.windowFocus, listener),
  },
};

contextBridge.exposeInMainWorld("adcode", api);
