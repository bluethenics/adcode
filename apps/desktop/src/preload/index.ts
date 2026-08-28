/**
 * The contextBridge surface. No logic (brief §2) - every function here forwards to a
 * channel and nothing more, so there is no behaviour on this side of the boundary to
 * get wrong or to attack.
 *
 * Runs in a sandboxed preload, so only `electron`'s own module is available; no Node.
 */
import { contextBridge, ipcRenderer, webUtils } from "electron";
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
    openPath: (root) => ipcRenderer.invoke(CHANNELS.workspaceOpenPath, root),
    recents: () => ipcRenderer.invoke(CHANNELS.workspaceRecents),
    forgetRecent: (root) => ipcRenderer.invoke(CHANNELS.workspaceForgetRecent, root),
    clearRecents: () => ipcRenderer.invoke(CHANNELS.workspaceClearRecents),
    close: () => ipcRenderer.invoke(CHANNELS.workspaceClose),
    current: () => ipcRenderer.invoke(CHANNELS.workspaceCurrent),
    list: (dirPath) => ipcRenderer.invoke(CHANNELS.fsList, dirPath),
  },
  app: {
    info: () => ipcRenderer.invoke(CHANNELS.appInfo),
  },
  files: {
    read: (filePath) => ipcRenderer.invoke(CHANNELS.fsRead, filePath),
    openDialog: () => ipcRenderer.invoke(CHANNELS.filesOpenDialog),
    write: (filePath, text) => ipcRenderer.invoke(CHANNELS.fsWrite, filePath, text),
    saveAs: (text, suggestedName) => ipcRenderer.invoke(CHANNELS.fsSaveAs, text, suggestedName),
    createFile: (parentDir, name) => ipcRenderer.invoke(CHANNELS.fsCreateFile, parentDir, name),
    createFolder: (parentDir, name) => ipcRenderer.invoke(CHANNELS.fsCreateFolder, parentDir, name),
    rename: (target, name) => ipcRenderer.invoke(CHANNELS.fsRename, target, name),
    trash: (target) => ipcRenderer.invoke(CHANNELS.fsTrash, target),
    delete: (target) => ipcRenderer.invoke(CHANNELS.fsDelete, target),
    reveal: (target) => ipcRenderer.invoke(CHANNELS.fsReveal, target),
    duplicate: (target) => ipcRenderer.invoke(CHANNELS.fsDuplicate, target),
    copy: (source, targetDir) => ipcRenderer.invoke(CHANNELS.fsCopy, source, targetDir),
    move: (source, targetDir) => ipcRenderer.invoke(CHANNELS.fsMove, source, targetDir),
    importFrom: (source, targetDir) => ipcRenderer.invoke(CHANNELS.fsImport, source, targetDir),
    pathForDropped: (file) => webUtils.getPathForFile(file),
  },
  debug: {
    state: () => ipcRenderer.invoke(CHANNELS.debugState),
    start: (path, languageId) => ipcRenderer.invoke(CHANNELS.debugStart, path, languageId),
    stop: () => ipcRenderer.invoke(CHANNELS.debugStop),
    // One channel with a verb rather than five channels: the main process validates the
    // verb against a closed set, and the bridge surface stays small.
    resume: () => ipcRenderer.invoke(CHANNELS.debugControl, "resume"),
    stepOver: () => ipcRenderer.invoke(CHANNELS.debugControl, "stepOver"),
    stepInto: () => ipcRenderer.invoke(CHANNELS.debugControl, "stepInto"),
    stepOut: () => ipcRenderer.invoke(CHANNELS.debugControl, "stepOut"),
    pause: () => ipcRenderer.invoke(CHANNELS.debugControl, "pause"),
    toggleBreakpoint: (path, line) =>
      ipcRenderer.invoke(CHANNELS.debugToggleBreakpoint, path, line),
    breakpoints: () => ipcRenderer.invoke(CHANNELS.debugBreakpoints),
    scopes: (frameId) => ipcRenderer.invoke(CHANNELS.debugScopes, frameId),
    properties: (objectId) => ipcRenderer.invoke(CHANNELS.debugProperties, objectId),
    evaluate: (frameId, expression) => ipcRenderer.invoke(CHANNELS.debugEvaluate, frameId, expression),
    onState: (listener) => subscribe(CHANNELS.debugState, listener),
  },
  chat: {
    sessions: () => ipcRenderer.invoke(CHANNELS.aiSessions),
    resume: (id) => ipcRenderer.invoke(CHANNELS.aiResumeSession, id),
    rename: (id, title) => ipcRenderer.invoke(CHANNELS.aiRenameSession, id, title),
    remove: (id) => ipcRenderer.invoke(CHANNELS.aiDeleteSession, id),
    clear: () => ipcRenderer.invoke(CHANNELS.aiClearSessions),
    current: () => ipcRenderer.invoke(CHANNELS.aiSessionChanged),
    onChanged: (listener) => subscribe(CHANNELS.aiSessionChanged, listener),
  },
  clipboard: {
    writeText: (text) => ipcRenderer.invoke(CHANNELS.clipboardWrite, text),
    readText: () => ipcRenderer.invoke(CHANNELS.clipboardRead),
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
  preview: {
    start: (mode) => ipcRenderer.invoke(CHANNELS.previewStart, mode),
    stop: () => ipcRenderer.invoke(CHANNELS.previewStop),
    status: () => ipcRenderer.invoke(CHANNELS.previewStatus),
    detect: () => ipcRenderer.invoke(CHANNELS.previewDetect),
    log: () => ipcRenderer.invoke(CHANNELS.previewLog),
    openExternal: () => ipcRenderer.invoke(CHANNELS.previewOpenExternal),
    onChange: (listener) => subscribe(CHANNELS.previewChanged, listener),
    onOutput: (listener) => subscribe(CHANNELS.previewOutput, listener),
  },
  ports: {
    list: () => ipcRenderer.invoke(CHANNELS.portsList),
    stop: (pid) => ipcRenderer.invoke(CHANNELS.portsStop, pid),
    open: (port) => ipcRenderer.invoke(CHANNELS.portsOpen, port),
  },
  output: {
    history: () => ipcRenderer.invoke(CHANNELS.outputHistory),
    onAppend: (listener) => subscribe(CHANNELS.outputAppend, listener),
  },
  language: {
    // `send`, not `invoke`: document synchronisation sits on the keystroke path, and §7 is
    // explicit that nothing the user types may wait on anything.
    opened: (path, languageId, text) => ipcRenderer.send(CHANNELS.lspOpened, path, languageId, text),
    changed: (path, languageId, text) => ipcRenderer.send(CHANNELS.lspChanged, path, languageId, text),
    closed: (path, languageId) => ipcRenderer.send(CHANNELS.lspClosed, path, languageId),
    completion: (path, languageId, line, column) =>
      ipcRenderer.invoke(CHANNELS.lspCompletion, path, languageId, line, column),
    hover: (path, languageId, line, column) =>
      ipcRenderer.invoke(CHANNELS.lspHover, path, languageId, line, column),
    formatting: (path, languageId, options) =>
      ipcRenderer.invoke(CHANNELS.lspFormatting, path, languageId, options),
    definition: (path, languageId, line, column) =>
      ipcRenderer.invoke(CHANNELS.lspDefinition, path, languageId, line, column),
    states: () => ipcRenderer.invoke(CHANNELS.lspStates),
    onDiagnostics: (listener) => subscribe(CHANNELS.lspDiagnostics, listener),
    onState: (listener) => subscribe(CHANNELS.lspStateChanged, listener),
  },
  memory: {
    connection: () => ipcRenderer.invoke(CHANNELS.memoryConnection),
  },
  ai: {
    status: () => ipcRenderer.invoke(CHANNELS.aiProviders),
    setKey: (provider, key) => ipcRenderer.invoke(CHANNELS.aiSetKey, provider, key),
    clearKey: (provider) => ipcRenderer.invoke(CHANNELS.aiClearKey, provider),
    checkKey: (provider, key) => ipcRenderer.invoke(CHANNELS.aiCheckKey, provider, key),
    send: (text) => ipcRenderer.invoke(CHANNELS.aiSend, text),
    complete: (input) => ipcRenderer.invoke(CHANNELS.aiCompletion, input),
    cancelCompletion: (requestId) => ipcRenderer.send(CHANNELS.aiCancelCompletion, requestId),
    cancel: () => ipcRenderer.send(CHANNELS.aiCancel),
    reset: () => ipcRenderer.send(CHANNELS.aiReset),
    onEvent: (listener) => subscribe(CHANNELS.aiEvent, listener),
    onProposedEdit: (listener) => subscribe(CHANNELS.aiProposedEdit, listener),
    applyHunks: (path, ids) => ipcRenderer.invoke(CHANNELS.aiApplyHunks, path, ids),
  },
  aiWorkspace: {
    list: () => ipcRenderer.invoke(CHANNELS.aiWorkspaceList),
    current: () => ipcRenderer.invoke(CHANNELS.aiWorkspaceCurrent),
    changes: (taskId) => ipcRenderer.invoke(CHANNELS.aiWorkspaceChanges, taskId),
    traces: (taskId) => ipcRenderer.invoke(CHANNELS.aiWorkspaceTraces, taskId),
    apply: (taskId, selections) =>
      ipcRenderer.invoke(CHANNELS.aiWorkspaceApply, taskId, selections),
    discard: (taskId) => ipcRenderer.invoke(CHANNELS.aiWorkspaceDiscard, taskId),
    rollback: (taskId) => ipcRenderer.invoke(CHANNELS.aiWorkspaceRollback, taskId),
    onChanged: (listener) => subscribe(CHANNELS.aiWorkspaceChanged, listener),
  },
  aiTeam: {
    suggest: (input) => ipcRenderer.invoke(CHANNELS.aiTeamSuggest, input),
    configure: (input) => ipcRenderer.invoke(CHANNELS.aiTeamConfigure, input),
    list: () => ipcRenderer.invoke(CHANNELS.aiTeamList),
    read: (id) => ipcRenderer.invoke(CHANNELS.aiTeamRead, id),
    start: (id) => ipcRenderer.invoke(CHANNELS.aiTeamStart, id),
    cancel: (id) => ipcRenderer.invoke(CHANNELS.aiTeamCancel, id),
    traces: (id) => ipcRenderer.invoke(CHANNELS.aiTeamTraces, id),
    onChanged: (listener) => subscribe(CHANNELS.aiTeamChanged, listener),
  },
  aiAutomation: {
    create: (input) => ipcRenderer.invoke(CHANNELS.aiAutomationCreate, input),
    list: () => ipcRenderer.invoke(CHANNELS.aiAutomationList),
    claimDue: () => ipcRenderer.invoke(CHANNELS.aiAutomationClaim),
    complete: (id) => ipcRenderer.invoke(CHANNELS.aiAutomationComplete, id),
    retry: (id, reason, dueAt) => ipcRenderer.invoke(CHANNELS.aiAutomationRetry, id, reason, dueAt),
    cancel: (id) => ipcRenderer.invoke(CHANNELS.aiAutomationCancel, id),
    confirmMissed: (id) => ipcRenderer.invoke(CHANNELS.aiAutomationConfirmMissed, id),
    markDueMissed: () => ipcRenderer.invoke(CHANNELS.aiAutomationMarkDueMissed),
    onChanged: (listener) => subscribe(CHANNELS.aiAutomationChanged, listener),
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
    addRemote: (name, url) => ipcRenderer.invoke(CHANNELS.gitAddRemote, name, url),
    remotes: () => ipcRenderer.invoke(CHANNELS.gitRemotes),
    branches: () => ipcRenderer.invoke(CHANNELS.gitBranches),
    checkout: (ref) => ipcRenderer.invoke(CHANNELS.gitCheckout, ref),
    createBranch: (name) => ipcRenderer.invoke(CHANNELS.gitCreateBranch, name),
    log: (limit) => ipcRenderer.invoke(CHANNELS.gitLog, limit),
    fileHistory: (path) => ipcRenderer.invoke(CHANNELS.gitFileHistory, path),
    lineChanges: (path) => ipcRenderer.invoke(CHANNELS.gitLineChanges, path),
    blame: (path) => ipcRenderer.invoke(CHANNELS.gitBlame, path),
    diff: (path) => ipcRenderer.invoke(CHANNELS.gitDiff, path),
    showFile: (ref, path) => ipcRenderer.invoke(CHANNELS.gitShowFile, ref, path),
    commitDetail: (ref) => ipcRenderer.invoke(CHANNELS.gitCommitDetail, ref),
    commitFileDiff: (ref, path) => ipcRenderer.invoke(CHANNELS.gitCommitFileDiff, ref, path),
    restoreFile: (ref, path) => ipcRenderer.invoke(CHANNELS.gitRestoreFile, ref, path),
  },
  keybindings: {
    read: () => ipcRenderer.invoke(CHANNELS.keybindingsRead),
    write: (command, chord) => ipcRenderer.invoke(CHANNELS.keybindingsWrite, command, chord),
    reset: (command) => ipcRenderer.invoke(CHANNELS.keybindingsReset, command),
    onChanged: (listener) => subscribe(CHANNELS.keybindingsChanged, listener),
  },
  runtime: {
    check: (command) => ipcRenderer.invoke(CHANNELS.runtimeCheck, command),
    openInstall: (id) => ipcRenderer.invoke(CHANNELS.runtimeOpenInstall, id),
  },
  search: {
    run: (query) => ipcRenderer.invoke(CHANNELS.searchRun, query),
    replace: (query, replacement) =>
      ipcRenderer.invoke(CHANNELS.searchReplace, query, replacement),
    quickOpen: (query) => ipcRenderer.invoke(CHANNELS.quickOpen, query),
  },
  window: {
    onCommand: (listener) => subscribe(CHANNELS.menuCommand, listener),
    toggleFullScreen: () => ipcRenderer.send(CHANNELS.windowFullScreen),
    toggleDevTools: () => ipcRenderer.send(CHANNELS.windowDevTools),
    zoom: (direction) => ipcRenderer.send(CHANNELS.windowZoom, direction),
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
  account: {
    status: () => ipcRenderer.invoke(CHANNELS.accountStatus),
    link: (provider) => ipcRenderer.invoke(CHANNELS.accountLink, provider),
    linkEmail: (email, password) => ipcRenderer.invoke(CHANNELS.accountLinkEmail, email, password),
    onChanged: (listener) => subscribe(CHANNELS.accountChanged, listener),
    signOut: () => ipcRenderer.invoke(CHANNELS.accountSignOut),
    signInInstead: () => ipcRenderer.invoke(CHANNELS.accountSignInInstead),
    cancelLink: () => ipcRenderer.invoke(CHANNELS.accountCancelLink),
    onDeviceCode: (listener) => subscribe(CHANNELS.accountDeviceCode, listener),
  },
  notices: {
    onShow: (listener) => subscribe(CHANNELS.serviceNotice, listener),
  },
  releases: {
    onAnnouncement: (listener) => subscribe(CHANNELS.releaseAnnouncement, listener),
    markSeen: (versions) => ipcRenderer.invoke(CHANNELS.releaseMarkSeen, versions),
    list: () => ipcRenderer.invoke(CHANNELS.releaseList),
  },
  updates: {
    status: () => ipcRenderer.invoke(CHANNELS.updateStatus),
    onChanged: (listener) => subscribe(CHANNELS.updateChanged, listener),
  },
  support: {
    submitReport: (input) => ipcRenderer.invoke(CHANNELS.supportSubmitReport, input),
  },
  onboarding: {
    completed: () => ipcRenderer.invoke(CHANNELS.onboardingState),
    complete: () => ipcRenderer.invoke(CHANNELS.onboardingComplete),
  },
  activity: {
    // `send`, not `invoke`: the renderer has nothing to wait for, and a counter flush
    // must never be able to hold up a keystroke.
    report: (deltas) => ipcRenderer.send(CHANNELS.activityReport, deltas),
  },
  ads: {
    onShow: (listener) => subscribe(CHANNELS.adShow, listener),
    onEarnings: (listener) => subscribe(CHANNELS.earningsChanged, listener),
    painted: (creativeId) => ipcRenderer.send(CHANNELS.adPainted, creativeId),
    dismissed: (creativeId) => ipcRenderer.send(CHANNELS.adDismissed, creativeId),
    clicked: (creativeId) => ipcRenderer.send(CHANNELS.adClicked, creativeId),
    refreshEarnings: () => ipcRenderer.invoke(CHANNELS.adRefreshEarnings),
    setSuppressed: (suppressed) => ipcRenderer.send(CHANNELS.adSuppressionChanged, suppressed),
    reportSignals: (signals) => ipcRenderer.send(CHANNELS.adSignals, signals),
  },
  collab: {
    host: (options) => ipcRenderer.invoke(CHANNELS.collabHost, options),
    join: (code, displayName) => ipcRenderer.invoke(CHANNELS.collabJoin, code, displayName),
    leave: () => ipcRenderer.invoke(CHANNELS.collabLeave),
    status: () => ipcRenderer.invoke(CHANNELS.collabStatus),
    addresses: () => ipcRenderer.invoke(CHANNELS.collabAddresses),
    reencodeInvite: (address) => ipcRenderer.invoke(CHANNELS.collabReencodeInvite, address),
    setRole: (participantId, role) => ipcRenderer.invoke(CHANNELS.collabSetRole, participantId, role),
    setTerminalWrite: (participantId, allowed) =>
      ipcRenderer.invoke(CHANNELS.collabSetTerminalWrite, participantId, allowed),
    openDoc: (path) => ipcRenderer.invoke(CHANNELS.collabOpenDoc, path),
    // Fire-and-forget, both of these: they sit on the keystroke path, and a round trip per
    // character would put IPC latency between the key and the screen.
    pushUpdate: (path, update) => ipcRenderer.send(CHANNELS.collabPushUpdate, path, update),
    saveDoc: (path) => ipcRenderer.invoke(CHANNELS.collabSaveDoc, path),
    presence: (path, cursor, selection) =>
      ipcRenderer.send(CHANNELS.collabPresence, path, cursor, selection),
    requestCommit: (message) => ipcRenderer.send(CHANNELS.collabRequestCommit, message),
    decideCommit: (id, approved, detail) =>
      ipcRenderer.invoke(CHANNELS.collabDecideCommit, id, approved, detail),
    onStatus: (listener) => subscribe(CHANNELS.collabStatusChanged, listener),
    onDocUpdate: (listener) => subscribe(CHANNELS.collabDocUpdate, listener),
    onPresence: (listener) => subscribe(CHANNELS.collabPresenceChanged, listener),
    onCommitRequest: (listener) => subscribe(CHANNELS.collabCommitRequested, listener),
    onNotice: (listener) => subscribe(CHANNELS.collabNotice, listener),
  },
};

contextBridge.exposeInMainWorld("adcode", api);
