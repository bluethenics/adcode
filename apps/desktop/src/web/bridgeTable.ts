/**
 * What the browser's `window.adcode` forwards, method by method.
 *
 * The desktop preload (`src/preload/index.ts`) is the security boundary between the
 * renderer and the main process, and it is never generated or touched for the web. The
 * browser build is built from this table instead, and `test/webBridgeTable.test.ts` reads the
 * preload's source and checks every forwarding line against it in both directions, so a
 * method added to one and not the other fails the suite.
 *
 * `invoke` waits for an answer, `send` is fire-and-forget, `subscribe` listens to a channel
 * the host broadcasts on, and `local` is answered by the browser itself. `fixed` arguments
 * come first, ahead of the caller's: `debug.resume()` is `debugControl("resume")`.
 */
import { CHANNELS, type AdcodeApi } from "../shared/api.ts";

export type BridgeKind = "invoke" | "send" | "subscribe" | "local";

export interface BridgeEntry {
  readonly path: ApiPath;
  readonly kind: BridgeKind;
  readonly channel: string;
  readonly fixed?: readonly string[];
}

type Methods<T> = { [K in keyof T & string]: T[K] extends (...args: never[]) => unknown ? K : never }[keyof T & string];

/** Every `"namespace.method"` of `AdcodeApi`. */
export type ApiPath = { [N in keyof AdcodeApi & string]: `${N}.${Methods<AdcodeApi[N]>}` }[keyof AdcodeApi & string];

export const BRIDGE = [
  { path: "browser.view", kind: "invoke", channel: CHANNELS.browserView },
  { path: "browser.read", kind: "invoke", channel: CHANNELS.browserRead },
  { path: "browser.onChanged", kind: "subscribe", channel: CHANNELS.browserChanged },
  // workspace
  { path: "workspace.open", kind: "invoke", channel: CHANNELS.workspaceOpen },
  { path: "workspace.openPath", kind: "invoke", channel: CHANNELS.workspaceOpenPath },
  { path: "workspace.createProject", kind: "invoke", channel: CHANNELS.workspaceCreateProject },
  { path: "workspace.recents", kind: "invoke", channel: CHANNELS.workspaceRecents },
  { path: "workspace.forgetRecent", kind: "invoke", channel: CHANNELS.workspaceForgetRecent },
  { path: "workspace.clearRecents", kind: "invoke", channel: CHANNELS.workspaceClearRecents },
  { path: "workspace.close", kind: "invoke", channel: CHANNELS.workspaceClose },
  { path: "workspace.current", kind: "invoke", channel: CHANNELS.workspaceCurrent },
  { path: "workspace.list", kind: "invoke", channel: CHANNELS.fsList },
  { path: "workspace.onFilesChanged", kind: "subscribe", channel: CHANNELS.workspaceFilesChanged },
  { path: "workspace.onChanged", kind: "subscribe", channel: CHANNELS.workspaceChanged },

  // app
  { path: "app.info", kind: "invoke", channel: CHANNELS.appInfo },

  // files
  { path: "files.read", kind: "invoke", channel: CHANNELS.fsRead },
  { path: "files.readImage", kind: "invoke", channel: CHANNELS.fsReadImage },
  { path: "files.openDialog", kind: "invoke", channel: CHANNELS.filesOpenDialog },
  { path: "files.write", kind: "invoke", channel: CHANNELS.fsWrite },
  { path: "files.saveAs", kind: "invoke", channel: CHANNELS.fsSaveAs },
  { path: "files.createFile", kind: "invoke", channel: CHANNELS.fsCreateFile },
  { path: "files.createFolder", kind: "invoke", channel: CHANNELS.fsCreateFolder },
  { path: "files.rename", kind: "invoke", channel: CHANNELS.fsRename },
  { path: "files.trash", kind: "invoke", channel: CHANNELS.fsTrash },
  { path: "files.delete", kind: "invoke", channel: CHANNELS.fsDelete },
  { path: "files.reveal", kind: "invoke", channel: CHANNELS.fsReveal },
  { path: "files.duplicate", kind: "invoke", channel: CHANNELS.fsDuplicate },
  { path: "files.copy", kind: "invoke", channel: CHANNELS.fsCopy },
  { path: "files.move", kind: "invoke", channel: CHANNELS.fsMove },
  { path: "files.importFrom", kind: "invoke", channel: CHANNELS.fsImport },
  { path: "files.pathForDropped", kind: "local", channel: "" },

  // debug
  { path: "debug.state", kind: "invoke", channel: CHANNELS.debugState },
  { path: "debug.start", kind: "invoke", channel: CHANNELS.debugStart },
  { path: "debug.stop", kind: "invoke", channel: CHANNELS.debugStop },
  { path: "debug.resume", kind: "invoke", channel: CHANNELS.debugControl, fixed: ["resume"] },
  { path: "debug.stepOver", kind: "invoke", channel: CHANNELS.debugControl, fixed: ["stepOver"] },
  { path: "debug.stepInto", kind: "invoke", channel: CHANNELS.debugControl, fixed: ["stepInto"] },
  { path: "debug.stepOut", kind: "invoke", channel: CHANNELS.debugControl, fixed: ["stepOut"] },
  { path: "debug.pause", kind: "invoke", channel: CHANNELS.debugControl, fixed: ["pause"] },
  { path: "debug.toggleBreakpoint", kind: "invoke", channel: CHANNELS.debugToggleBreakpoint },
  { path: "debug.breakpoints", kind: "invoke", channel: CHANNELS.debugBreakpoints },
  { path: "debug.scopes", kind: "invoke", channel: CHANNELS.debugScopes },
  { path: "debug.properties", kind: "invoke", channel: CHANNELS.debugProperties },
  { path: "debug.evaluate", kind: "invoke", channel: CHANNELS.debugEvaluate },
  { path: "debug.onState", kind: "subscribe", channel: CHANNELS.debugState },

  // chat
  { path: "chat.sessions", kind: "invoke", channel: CHANNELS.aiSessions },
  { path: "chat.resume", kind: "invoke", channel: CHANNELS.aiResumeSession },
  { path: "chat.rename", kind: "invoke", channel: CHANNELS.aiRenameSession },
  { path: "chat.remove", kind: "invoke", channel: CHANNELS.aiDeleteSession },
  { path: "chat.clear", kind: "invoke", channel: CHANNELS.aiClearSessions },
  { path: "chat.current", kind: "invoke", channel: CHANNELS.aiSessionChanged },
  { path: "chat.onChanged", kind: "subscribe", channel: CHANNELS.aiSessionChanged },

  // clipboard
  { path: "clipboard.writeText", kind: "invoke", channel: CHANNELS.clipboardWrite },
  { path: "clipboard.readText", kind: "invoke", channel: CHANNELS.clipboardRead },

  // terminal
  { path: "terminal.profiles", kind: "invoke", channel: CHANNELS.terminalProfiles },
  { path: "terminal.create", kind: "invoke", channel: CHANNELS.terminalCreate },
  { path: "terminal.write", kind: "send", channel: CHANNELS.terminalWrite },
  { path: "terminal.resize", kind: "send", channel: CHANNELS.terminalResize },
  { path: "terminal.dispose", kind: "send", channel: CHANNELS.terminalDispose },
  { path: "terminal.openLink", kind: "invoke", channel: CHANNELS.terminalOpenLink },
  { path: "terminal.onData", kind: "subscribe", channel: CHANNELS.terminalData },
  { path: "terminal.onExit", kind: "subscribe", channel: CHANNELS.terminalExit },

  // platform
  { path: "platform.info", kind: "invoke", channel: CHANNELS.platformInfo },
  { path: "platform.onFocusChange", kind: "subscribe", channel: CHANNELS.windowFocus },

  // preview
  { path: "preview.start", kind: "invoke", channel: CHANNELS.previewStart },
  { path: "preview.stop", kind: "invoke", channel: CHANNELS.previewStop },
  { path: "preview.status", kind: "invoke", channel: CHANNELS.previewStatus },
  { path: "preview.detect", kind: "invoke", channel: CHANNELS.previewDetect },
  { path: "preview.log", kind: "invoke", channel: CHANNELS.previewLog },
  { path: "preview.openExternal", kind: "invoke", channel: CHANNELS.previewOpenExternal },
  { path: "preview.onChange", kind: "subscribe", channel: CHANNELS.previewChanged },
  { path: "preview.onOutput", kind: "subscribe", channel: CHANNELS.previewOutput },

  // ports
  { path: "ports.list", kind: "invoke", channel: CHANNELS.portsList },
  { path: "ports.stop", kind: "invoke", channel: CHANNELS.portsStop },
  { path: "ports.open", kind: "invoke", channel: CHANNELS.portsOpen },

  // output
  { path: "output.history", kind: "invoke", channel: CHANNELS.outputHistory },
  { path: "output.onAppend", kind: "subscribe", channel: CHANNELS.outputAppend },

  // language
  { path: "language.opened", kind: "send", channel: CHANNELS.lspOpened },
  { path: "language.changed", kind: "send", channel: CHANNELS.lspChanged },
  { path: "language.closed", kind: "send", channel: CHANNELS.lspClosed },
  { path: "language.completion", kind: "invoke", channel: CHANNELS.lspCompletion },
  { path: "language.hover", kind: "invoke", channel: CHANNELS.lspHover },
  { path: "language.formatting", kind: "invoke", channel: CHANNELS.lspFormatting },
  { path: "language.definition", kind: "invoke", channel: CHANNELS.lspDefinition },
  { path: "language.states", kind: "invoke", channel: CHANNELS.lspStates },
  { path: "language.onDiagnostics", kind: "subscribe", channel: CHANNELS.lspDiagnostics },
  { path: "language.onState", kind: "subscribe", channel: CHANNELS.lspStateChanged },

  // memory
  { path: "memory.connection", kind: "invoke", channel: CHANNELS.memoryConnection },
  { path: "memory.list", kind: "invoke", channel: CHANNELS.memoryList },
  { path: "memory.write", kind: "invoke", channel: CHANNELS.memoryWrite },
  { path: "memory.remove", kind: "invoke", channel: CHANNELS.memoryRemove },

  // ai
  { path: "ai.controls", kind: "invoke", channel: CHANNELS.aiControlsRead },
  { path: "ai.control", kind: "invoke", channel: CHANNELS.aiControlsAction },
  { path: "ai.previewSkill", kind: "invoke", channel: CHANNELS.aiControlsPreviewSkill },
  { path: "ai.pickConnectorFile", kind: "invoke", channel: CHANNELS.aiConnectorsPick },
  { path: "ai.openAgentSettings", kind: "invoke", channel: CHANNELS.aiAgentSettingsOpen },
  { path: "ai.onControlsChanged", kind: "subscribe", channel: CHANNELS.aiControlsChanged },
  { path: "ai.status", kind: "invoke", channel: CHANNELS.aiProviders },
  { path: "ai.onStatusChanged", kind: "subscribe", channel: CHANNELS.aiProvidersChanged },
  { path: "ai.setKey", kind: "invoke", channel: CHANNELS.aiSetKey },
  { path: "ai.clearKey", kind: "invoke", channel: CHANNELS.aiClearKey },
  { path: "ai.checkKey", kind: "invoke", channel: CHANNELS.aiCheckKey },
  { path: "ai.quickConnect", kind: "invoke", channel: CHANNELS.aiQuickConnect },
  { path: "ai.detectOllama", kind: "invoke", channel: CHANNELS.aiDetectOllama },
  { path: "ai.startOllama", kind: "invoke", channel: CHANNELS.aiStartOllama },
  { path: "ai.openKeyPage", kind: "invoke", channel: CHANNELS.aiOpenKeyPage },
  { path: "ai.send", kind: "invoke", channel: CHANNELS.aiSend },
  { path: "ai.complete", kind: "invoke", channel: CHANNELS.aiCompletion },
  { path: "ai.cancelCompletion", kind: "send", channel: CHANNELS.aiCancelCompletion },
  { path: "ai.inlineEdit", kind: "invoke", channel: CHANNELS.aiInlineEdit },
  { path: "ai.cancelInlineEdit", kind: "send", channel: CHANNELS.aiCancelInlineEdit },
  { path: "ai.cancel", kind: "send", channel: CHANNELS.aiCancel },
  { path: "ai.reset", kind: "send", channel: CHANNELS.aiReset },
  { path: "ai.runs", kind: "invoke", channel: CHANNELS.aiRunsList },
  { path: "ai.onRunsChanged", kind: "subscribe", channel: CHANNELS.aiRunsChanged },
  { path: "ai.liveTurn", kind: "invoke", channel: CHANNELS.aiLiveTurnState },
  { path: "ai.compact", kind: "invoke", channel: CHANNELS.aiCompact },
  { path: "ai.contextUsage", kind: "invoke", channel: CHANNELS.aiContextUsage },
  { path: "ai.answerAnyway", kind: "send", channel: CHANNELS.aiAnswerAnyway },
  { path: "ai.onEvent", kind: "subscribe", channel: CHANNELS.aiEvent },
  { path: "ai.onProposedEdit", kind: "subscribe", channel: CHANNELS.aiProposedEdit },
  { path: "ai.onCheckpoint", kind: "subscribe", channel: CHANNELS.aiCheckpoint },
  { path: "ai.checkpoints", kind: "invoke", channel: CHANNELS.aiCheckpoints },
  { path: "ai.undoCheckpoint", kind: "invoke", channel: CHANNELS.aiCheckpointUndo },
  { path: "ai.onQuestion", kind: "subscribe", channel: CHANNELS.aiQuestion },
  { path: "ai.onQuestionDone", kind: "subscribe", channel: CHANNELS.aiQuestionDone },
  { path: "ai.answerQuestion", kind: "send", channel: CHANNELS.aiQuestionAnswer },

  // aiWorkspace
  { path: "aiWorkspace.list", kind: "invoke", channel: CHANNELS.aiWorkspaceList },
  { path: "aiWorkspace.current", kind: "invoke", channel: CHANNELS.aiWorkspaceCurrent },
  { path: "aiWorkspace.changes", kind: "invoke", channel: CHANNELS.aiWorkspaceChanges },
  { path: "aiWorkspace.traces", kind: "invoke", channel: CHANNELS.aiWorkspaceTraces },
  { path: "aiWorkspace.apply", kind: "invoke", channel: CHANNELS.aiWorkspaceApply },
  { path: "aiWorkspace.discard", kind: "invoke", channel: CHANNELS.aiWorkspaceDiscard },
  { path: "aiWorkspace.remove", kind: "invoke", channel: CHANNELS.aiWorkspaceRemove },
  { path: "aiWorkspace.rollback", kind: "invoke", channel: CHANNELS.aiWorkspaceRollback },
  { path: "aiWorkspace.onChanged", kind: "subscribe", channel: CHANNELS.aiWorkspaceChanged },

  // aiTeam
  { path: "aiTeam.suggest", kind: "invoke", channel: CHANNELS.aiTeamSuggest },
  { path: "aiTeam.configure", kind: "invoke", channel: CHANNELS.aiTeamConfigure },
  { path: "aiTeam.list", kind: "invoke", channel: CHANNELS.aiTeamList },
  { path: "aiTeam.read", kind: "invoke", channel: CHANNELS.aiTeamRead },
  { path: "aiTeam.start", kind: "invoke", channel: CHANNELS.aiTeamStart },
  { path: "aiTeam.cancel", kind: "invoke", channel: CHANNELS.aiTeamCancel },
  { path: "aiTeam.remove", kind: "invoke", channel: CHANNELS.aiTeamRemove },
  { path: "aiTeam.traces", kind: "invoke", channel: CHANNELS.aiTeamTraces },
  { path: "aiTeam.onRemoved", kind: "subscribe", channel: CHANNELS.aiTeamRemoved },
  { path: "aiTeam.onChanged", kind: "subscribe", channel: CHANNELS.aiTeamChanged },

  // aiLive
  { path: "aiLive.onEvent", kind: "subscribe", channel: CHANNELS.aiLive },

  // aiUsage
  { path: "aiUsage.audience", kind: "invoke", channel: CHANNELS.aiAudience },
  { path: "aiUsage.feedback", kind: "invoke", channel: CHANNELS.aiModelFeedback },
  { path: "aiUsage.allowance", kind: "invoke", channel: CHANNELS.aiUsageAllowance },
  { path: "aiUsage.read", kind: "invoke", channel: CHANNELS.aiUsageRead },
  { path: "aiUsage.clear", kind: "invoke", channel: CHANNELS.aiUsageClear },
  { path: "aiUsage.onChanged", kind: "subscribe", channel: CHANNELS.aiUsageChanged },

  // aiAutomation
  { path: "aiAutomation.create", kind: "invoke", channel: CHANNELS.aiAutomationCreate },
  { path: "aiAutomation.list", kind: "invoke", channel: CHANNELS.aiAutomationList },
  { path: "aiAutomation.claimDue", kind: "invoke", channel: CHANNELS.aiAutomationClaim },
  { path: "aiAutomation.complete", kind: "invoke", channel: CHANNELS.aiAutomationComplete },
  { path: "aiAutomation.miss", kind: "invoke", channel: CHANNELS.aiAutomationMiss },
  { path: "aiAutomation.retry", kind: "invoke", channel: CHANNELS.aiAutomationRetry },
  { path: "aiAutomation.cancel", kind: "invoke", channel: CHANNELS.aiAutomationCancel },
  { path: "aiAutomation.confirmMissed", kind: "invoke", channel: CHANNELS.aiAutomationConfirmMissed },
  { path: "aiAutomation.markDueMissed", kind: "invoke", channel: CHANNELS.aiAutomationMarkDueMissed },
  { path: "aiAutomation.onChanged", kind: "subscribe", channel: CHANNELS.aiAutomationChanged },

  // git
  { path: "git.status", kind: "invoke", channel: CHANNELS.gitStatus },
  { path: "git.stage", kind: "invoke", channel: CHANNELS.gitStage },
  { path: "git.unstage", kind: "invoke", channel: CHANNELS.gitUnstage },
  { path: "git.discard", kind: "invoke", channel: CHANNELS.gitDiscard },
  { path: "git.commit", kind: "invoke", channel: CHANNELS.gitCommit },
  { path: "git.push", kind: "invoke", channel: CHANNELS.gitPush },
  { path: "git.pull", kind: "invoke", channel: CHANNELS.gitPull },
  { path: "git.fetch", kind: "invoke", channel: CHANNELS.gitFetch },
  { path: "git.init", kind: "invoke", channel: CHANNELS.gitInit },
  { path: "git.trust", kind: "invoke", channel: CHANNELS.gitTrust },
  { path: "git.identity", kind: "invoke", channel: CHANNELS.gitIdentity },
  { path: "git.setIdentity", kind: "invoke", channel: CHANNELS.gitSetIdentity },
  { path: "git.clone", kind: "invoke", channel: CHANNELS.gitClone },
  { path: "git.addRemote", kind: "invoke", channel: CHANNELS.gitAddRemote },
  { path: "git.remotes", kind: "invoke", channel: CHANNELS.gitRemotes },
  { path: "git.openGitHub", kind: "invoke", channel: CHANNELS.gitOpenGitHub },
  { path: "git.branches", kind: "invoke", channel: CHANNELS.gitBranches },
  { path: "git.checkout", kind: "invoke", channel: CHANNELS.gitCheckout },
  { path: "git.createBranch", kind: "invoke", channel: CHANNELS.gitCreateBranch },
  { path: "git.log", kind: "invoke", channel: CHANNELS.gitLog },
  { path: "git.fileHistory", kind: "invoke", channel: CHANNELS.gitFileHistory },
  { path: "git.lineChanges", kind: "invoke", channel: CHANNELS.gitLineChanges },
  { path: "git.blame", kind: "invoke", channel: CHANNELS.gitBlame },
  { path: "git.diff", kind: "invoke", channel: CHANNELS.gitDiff },
  { path: "git.showFile", kind: "invoke", channel: CHANNELS.gitShowFile },
  { path: "git.commitDetail", kind: "invoke", channel: CHANNELS.gitCommitDetail },
  { path: "git.commitFileDiff", kind: "invoke", channel: CHANNELS.gitCommitFileDiff },
  { path: "git.restoreFile", kind: "invoke", channel: CHANNELS.gitRestoreFile },

  // keybindings
  { path: "keybindings.read", kind: "invoke", channel: CHANNELS.keybindingsRead },
  { path: "keybindings.write", kind: "invoke", channel: CHANNELS.keybindingsWrite },
  { path: "keybindings.reset", kind: "invoke", channel: CHANNELS.keybindingsReset },
  { path: "keybindings.onChanged", kind: "subscribe", channel: CHANNELS.keybindingsChanged },

  // runtime
  { path: "runtime.check", kind: "invoke", channel: CHANNELS.runtimeCheck },
  { path: "runtime.openInstall", kind: "invoke", channel: CHANNELS.runtimeOpenInstall },

  // search
  { path: "search.run", kind: "invoke", channel: CHANNELS.searchRun },
  { path: "search.replace", kind: "invoke", channel: CHANNELS.searchReplace },
  { path: "search.quickOpen", kind: "invoke", channel: CHANNELS.quickOpen },

  // window
  { path: "window.onCommand", kind: "subscribe", channel: CHANNELS.menuCommand },
  { path: "window.toggleFullScreen", kind: "send", channel: CHANNELS.windowFullScreen },
  { path: "window.toggleDevTools", kind: "send", channel: CHANNELS.windowDevTools },
  { path: "window.zoom", kind: "send", channel: CHANNELS.windowZoom },
  { path: "window.setZoom", kind: "send", channel: CHANNELS.windowSetZoom },
  { path: "window.openIde", kind: "invoke", channel: CHANNELS.windowOpenIde },
  { path: "window.openVibe", kind: "invoke", channel: CHANNELS.windowOpenVibe },
  { path: "window.ready", kind: "send", channel: CHANNELS.windowRendererReady },

  // history
  { path: "history.versions", kind: "invoke", channel: CHANNELS.historyVersions },
  { path: "history.read", kind: "invoke", channel: CHANNELS.historyRead },
  { path: "history.draft", kind: "send", channel: CHANNELS.historyDraft },
  { path: "history.clearDraft", kind: "send", channel: CHANNELS.historyClearDraft },
  { path: "history.drafts", kind: "invoke", channel: CHANNELS.historyDrafts },

  // session
  { path: "session.restore", kind: "invoke", channel: CHANNELS.sessionRestore },
  { path: "session.save", kind: "send", channel: CHANNELS.sessionSave },
  { path: "session.onOpenIntent", kind: "subscribe", channel: CHANNELS.sessionOpenIntent },

  // settings
  { path: "settings.read", kind: "invoke", channel: CHANNELS.settingsRead },
  { path: "settings.write", kind: "invoke", channel: CHANNELS.settingsWrite },
  { path: "settings.reset", kind: "invoke", channel: CHANNELS.settingsReset },
  { path: "settings.onChanged", kind: "subscribe", channel: CHANNELS.settingsChanged },

  // account
  { path: "account.status", kind: "invoke", channel: CHANNELS.accountStatus },
  { path: "account.link", kind: "invoke", channel: CHANNELS.accountLink },
  { path: "account.linkEmail", kind: "invoke", channel: CHANNELS.accountLinkEmail },
  { path: "account.onChanged", kind: "subscribe", channel: CHANNELS.accountChanged },
  { path: "account.signOut", kind: "invoke", channel: CHANNELS.accountSignOut },
  { path: "account.signInInstead", kind: "invoke", channel: CHANNELS.accountSignInInstead },
  { path: "account.cancelLink", kind: "invoke", channel: CHANNELS.accountCancelLink },
  { path: "account.onDeviceCode", kind: "subscribe", channel: CHANNELS.accountDeviceCode },

  // notices
  { path: "notices.onShow", kind: "subscribe", channel: CHANNELS.serviceNotice },

  // releases
  { path: "releases.onAnnouncement", kind: "subscribe", channel: CHANNELS.releaseAnnouncement },
  { path: "releases.markSeen", kind: "invoke", channel: CHANNELS.releaseMarkSeen },
  { path: "releases.list", kind: "invoke", channel: CHANNELS.releaseList },

  // licences
  { path: "licences.read", kind: "invoke", channel: CHANNELS.licencesRead },

  // updates
  { path: "updates.status", kind: "invoke", channel: CHANNELS.updateStatus },
  { path: "updates.check", kind: "invoke", channel: CHANNELS.updateCheck },
  { path: "updates.onChanged", kind: "subscribe", channel: CHANNELS.updateChanged },
  { path: "updates.install", kind: "invoke", channel: CHANNELS.updateInstall },
  { path: "updates.claimNotice", kind: "invoke", channel: CHANNELS.updateClaimNotice },
  { path: "updates.onPrepare", kind: "subscribe", channel: CHANNELS.updatePrepare },
  { path: "updates.onPrepareCancel", kind: "subscribe", channel: CHANNELS.updatePrepareCancel },
  { path: "updates.prepared", kind: "invoke", channel: CHANNELS.updatePrepared },

  // support
  { path: "support.submitReport", kind: "invoke", channel: CHANNELS.supportSubmitReport },

  // dialogs
  { path: "dialogs.onConfirmRequest", kind: "subscribe", channel: CHANNELS.dialogConfirmRequest },
  { path: "dialogs.onConfirmCancel", kind: "subscribe", channel: CHANNELS.dialogConfirmCancel },
  { path: "dialogs.answerConfirm", kind: "send", channel: CHANNELS.dialogConfirmAnswer },

  // debugLog
  { path: "debugLog.record", kind: "send", channel: CHANNELS.debugRecord },
  { path: "debugLog.report", kind: "invoke", channel: CHANNELS.debugReport },
  { path: "debugLog.summary", kind: "invoke", channel: CHANNELS.debugSummary },
  { path: "debugLog.copy", kind: "invoke", channel: CHANNELS.debugCopy },
  { path: "debugLog.save", kind: "invoke", channel: CHANNELS.debugSave },

  // onboarding
  { path: "onboarding.completed", kind: "invoke", channel: CHANNELS.onboardingState },
  { path: "onboarding.complete", kind: "invoke", channel: CHANNELS.onboardingComplete },

  // pinPrompt
  { path: "pinPrompt.offer", kind: "invoke", channel: CHANNELS.pinPromptOffer },
  { path: "pinPrompt.shown", kind: "send", channel: CHANNELS.pinPromptShown },
  { path: "pinPrompt.settle", kind: "invoke", channel: CHANNELS.pinPromptSettle },
  { path: "pinPrompt.pin", kind: "invoke", channel: CHANNELS.pinPromptPin },

  // activity
  { path: "activity.report", kind: "send", channel: CHANNELS.activityReport },

  // milestones
  { path: "milestones.record", kind: "send", channel: CHANNELS.milestoneRecord },

  // referrals
  { path: "referrals.get", kind: "invoke", channel: CHANNELS.referralsGet },
  { path: "referrals.claim", kind: "invoke", channel: CHANNELS.referralsClaim },
  { path: "referrals.checkClipboard", kind: "invoke", channel: CHANNELS.referralsCheckClipboard },
  { path: "referrals.setShowName", kind: "invoke", channel: CHANNELS.referralsSetShowName },
  { path: "referrals.share", kind: "invoke", channel: CHANNELS.referralsShare },
  { path: "referrals.onShareMoment", kind: "subscribe", channel: CHANNELS.referralsShareMoment },

  // rating
  { path: "rating.onAsk", kind: "subscribe", channel: CHANNELS.ratingAsk },
  { path: "rating.open", kind: "invoke", channel: CHANNELS.ratingOpen },

  // ads
  { path: "ads.onShow", kind: "subscribe", channel: CHANNELS.adShow },
  { path: "ads.onEarnings", kind: "subscribe", channel: CHANNELS.earningsChanged },
  { path: "ads.painted", kind: "send", channel: CHANNELS.adPainted },
  { path: "ads.dismissed", kind: "send", channel: CHANNELS.adDismissed },
  { path: "ads.clicked", kind: "send", channel: CHANNELS.adClicked },
  { path: "ads.refreshEarnings", kind: "invoke", channel: CHANNELS.adRefreshEarnings },
  { path: "ads.setSuppressed", kind: "send", channel: CHANNELS.adSuppressionChanged },
  { path: "ads.reportSignals", kind: "send", channel: CHANNELS.adSignals },

  // collab
  { path: "collab.host", kind: "invoke", channel: CHANNELS.collabHost },
  { path: "collab.join", kind: "invoke", channel: CHANNELS.collabJoin },
  { path: "collab.leave", kind: "invoke", channel: CHANNELS.collabLeave },
  { path: "collab.status", kind: "invoke", channel: CHANNELS.collabStatus },
  { path: "collab.addresses", kind: "invoke", channel: CHANNELS.collabAddresses },
  { path: "collab.reencodeInvite", kind: "invoke", channel: CHANNELS.collabReencodeInvite },
  { path: "collab.setRole", kind: "invoke", channel: CHANNELS.collabSetRole },
  { path: "collab.setTerminalWrite", kind: "invoke", channel: CHANNELS.collabSetTerminalWrite },
  { path: "collab.openDoc", kind: "invoke", channel: CHANNELS.collabOpenDoc },
  { path: "collab.pushUpdate", kind: "send", channel: CHANNELS.collabPushUpdate },
  { path: "collab.saveDoc", kind: "invoke", channel: CHANNELS.collabSaveDoc },
  { path: "collab.presence", kind: "send", channel: CHANNELS.collabPresence },
  { path: "collab.requestCommit", kind: "send", channel: CHANNELS.collabRequestCommit },
  { path: "collab.decideCommit", kind: "invoke", channel: CHANNELS.collabDecideCommit },
  { path: "collab.onStatus", kind: "subscribe", channel: CHANNELS.collabStatusChanged },
  { path: "collab.onDocUpdate", kind: "subscribe", channel: CHANNELS.collabDocUpdate },
  { path: "collab.onPresence", kind: "subscribe", channel: CHANNELS.collabPresenceChanged },
  { path: "collab.onCommitRequest", kind: "subscribe", channel: CHANNELS.collabCommitRequested },
  { path: "collab.onNotice", kind: "subscribe", channel: CHANNELS.collabNotice },
] as const satisfies readonly BridgeEntry[];

/*
 * A compile error here names the `AdcodeApi` methods the table is missing. The test above
 * catches the same drift from the preload's side; this catches it from the type's.
 */
type Missing = Exclude<ApiPath, (typeof BRIDGE)[number]["path"]>;
const everyMethodCovered: [Missing] extends [never] ? true : Missing = true;
void everyMethodCovered;
