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
  memory: {
    connection: () => ipcRenderer.invoke(CHANNELS.memoryConnection),
  },
  ai: {
    status: () => ipcRenderer.invoke(CHANNELS.aiProviders),
    setKey: (provider, key) => ipcRenderer.invoke(CHANNELS.aiSetKey, provider, key),
    clearKey: (provider) => ipcRenderer.invoke(CHANNELS.aiClearKey, provider),
    send: (text) => ipcRenderer.invoke(CHANNELS.aiSend, text),
    cancel: () => ipcRenderer.send(CHANNELS.aiCancel),
    reset: () => ipcRenderer.send(CHANNELS.aiReset),
    onEvent: (listener) => subscribe(CHANNELS.aiEvent, listener),
    onProposedEdit: (listener) => subscribe(CHANNELS.aiProposedEdit, listener),
    applyHunks: (path, ids) => ipcRenderer.invoke(CHANNELS.aiApplyHunks, path, ids),
  },
  git: {
    status: () => ipcRenderer.invoke(CHANNELS.gitStatus),
    stage: (paths) => ipcRenderer.invoke(CHANNELS.gitStage, paths),
    unstage: (paths) => ipcRenderer.invoke(CHANNELS.gitUnstage, paths),
    discard: (paths) => ipcRenderer.invoke(CHANNELS.gitDiscard, paths),
    commit: (message) => ipcRenderer.invoke(CHANNELS.gitCommit, message),
    push: () => ipcRenderer.invoke(CHANNELS.gitPush),
    pull: () => ipcRenderer.invoke(CHANNELS.gitPull),
    fetch: () => ipcRenderer.invoke(CHANNELS.gitFetch),
    init: () => ipcRenderer.invoke(CHANNELS.gitInit),
    clone: (url, target) => ipcRenderer.invoke(CHANNELS.gitClone, url, target),
    branches: () => ipcRenderer.invoke(CHANNELS.gitBranches),
    checkout: (ref) => ipcRenderer.invoke(CHANNELS.gitCheckout, ref),
    createBranch: (name) => ipcRenderer.invoke(CHANNELS.gitCreateBranch, name),
    log: (limit) => ipcRenderer.invoke(CHANNELS.gitLog, limit),
    fileHistory: (path) => ipcRenderer.invoke(CHANNELS.gitFileHistory, path),
    lineChanges: (path) => ipcRenderer.invoke(CHANNELS.gitLineChanges, path),
    blame: (path) => ipcRenderer.invoke(CHANNELS.gitBlame, path),
    diff: (path) => ipcRenderer.invoke(CHANNELS.gitDiff, path),
    showFile: (ref, path) => ipcRenderer.invoke(CHANNELS.gitShowFile, ref, path),
  },
  search: {
    run: (query) => ipcRenderer.invoke(CHANNELS.searchRun, query),
    replace: (query, replacement) =>
      ipcRenderer.invoke(CHANNELS.searchReplace, query, replacement),
    quickOpen: (query) => ipcRenderer.invoke(CHANNELS.quickOpen, query),
  },
  history: {
    versions: (path) => ipcRenderer.invoke(CHANNELS.historyVersions, path),
    read: (path, id) => ipcRenderer.invoke(CHANNELS.historyRead, path, id),
    // Fire-and-forget: a draft is written while the user is typing, and nothing in the
    // editor should wait on it.
    draft: (path, text) => ipcRenderer.send(CHANNELS.historyDraft, path, text),
    clearDraft: (path) => ipcRenderer.send(CHANNELS.historyClearDraft, path),
    drafts: () => ipcRenderer.invoke(CHANNELS.historyDrafts),
  },
  session: {
    restore: () => ipcRenderer.invoke(CHANNELS.sessionRestore),
    // Fire-and-forget: the renderer saves this on every tab change, and waiting on a
    // disk write to close a tab would be felt.
    save: (state) => ipcRenderer.send(CHANNELS.sessionSave, state),
  },
  settings: {
    read: () => ipcRenderer.invoke(CHANNELS.settingsRead),
    write: (id, value) => ipcRenderer.invoke(CHANNELS.settingsWrite, id, value),
    reset: () => ipcRenderer.invoke(CHANNELS.settingsReset),
    onChanged: (listener) => subscribe(CHANNELS.settingsChanged, listener),
  },
  ads: {
    onShow: (listener) => subscribe(CHANNELS.adShow, listener),
    onEarnings: (listener) => subscribe(CHANNELS.earningsChanged, listener),
    painted: (creativeId) => ipcRenderer.send(CHANNELS.adPainted, creativeId),
    dismissed: (creativeId) => ipcRenderer.send(CHANNELS.adDismissed, creativeId),
    clicked: (creativeId) => ipcRenderer.send(CHANNELS.adClicked, creativeId),
    setSuppressed: (suppressed) => ipcRenderer.send(CHANNELS.adSuppressionChanged, suppressed),
  },
};

contextBridge.exposeInMainWorld("adcode", api);
