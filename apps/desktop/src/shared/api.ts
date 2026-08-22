/**
 * The contextBridge surface: the complete list of things the renderer may ask the main
 * process to do.
 *
 * Brief §1: "all privileged operations behind an explicit `contextBridge` API. The
 * renderer opens untrusted content (repo files, model output, ad creatives) and must be
 * treated as hostile."
 *
 * Shared by main, preload, and renderer so a channel cannot drift between the three.
 * Types only - this file must stay importable from a sandboxed preload.
 */

export interface DirEntry {
  readonly name: string;
  readonly path: string;
  readonly isDirectory: boolean;
}

export interface OpenedWorkspace {
  readonly root: string;
  readonly name: string;
}

/** A folder this editor has opened before, newest first. */
export interface RecentFolderView {
  readonly path: string;
  readonly name: string;
  readonly openedAt: number;
}

/** What the welcome screen and the settings footer say about this build. */
/** What the in-editor report form can file. Mirrors `services/api/src/contract.ts`. */
export type ReportKind = "bug" | "feature" | "help" | "other";

export interface ReportInput {
  readonly kind: ReportKind;
  readonly title: string;
  readonly body: string;
}

export type ReportResult =
  | { readonly ok: true; readonly reportId: string }
  | { readonly ok: false; readonly message: string };

/**
 * Where the updater has got to.
 *
 * `unsupported` covers a dev run and an unpacked build - neither has an update feed, and
 * saying so beats reporting a failure the user cannot act on.
 */
/**
 * A message from the operators - an outage, planned downtime, something people should
 * know. Always human-written and human-sent; nothing generates these from an error.
 */
export interface ServiceNotice {
  readonly noticeId: string;
  readonly severity: "info" | "warning";
  readonly title: string;
  readonly body: string;
}

export type UpdateStatus =
  | { readonly state: "idle" | "checking" | "current" | "failed" | "unsupported" }
  | { readonly state: "downloading"; readonly version?: string; readonly percent?: number }
  | { readonly state: "ready"; readonly version: string };

export interface AppInfo {
  readonly version: string;
  readonly electron: string;
  readonly chrome: string;
  readonly node: string;
  readonly platform: string;
}

export interface FileContent {
  readonly path: string;
  readonly text: string;
  /** Modification time when read, so a save can detect a change underneath it. */
  readonly mtimeMs: number;
}

export interface SaveResult {
  readonly ok: boolean;
  readonly mtimeMs: number;
  readonly reason?: string;
}

/**
 * The outcome of a structural file operation.
 *
 * Always an outcome, never a throw: the renderer has to be able to say what happened
 * whether it worked or not, and a rejection that crosses the bridge loses its message.
 */
export interface FileOpResult {
  readonly ok: boolean;
  readonly message: string;
  /** Where the item ended up, when there is one. */
  readonly path?: string;
  /**
   * A machine-readable cause, where the caller has to branch on it.
   *
   * `trash-failed` is the one that matters: Windows only implements the Recycle Bin on
   * NTFS, so on a FAT32 or removable volume there is nowhere for a deleted file to go.
   * The caller asks again for an explicit permanent delete rather than escalating on its
   * own - quietly turning a recoverable action into an irreversible one is not a fallback.
   */
  readonly code?: "trash-failed";
}

export interface TerminalProfile {
  readonly id: string;
  readonly label: string;
  readonly shell: string;
  readonly args: readonly string[];
}

export interface PlatformInfo {
  readonly platform: NodeJS.Platform;
  /**
   * Reduce-motion is deliberately absent here. Chromium's `prefers-reduced-motion`
   * media query already tracks the OS setting in the renderer, so routing it through
   * IPC would add a second source of truth that can disagree with the CSS.
   */
  readonly isPackaged: boolean;
}

/**
 * A sponsored creative, resolved for display.
 *
 * The logo arrives as a `data:` URL rather than a remote URL. That is the §1 rule made
 * structural: "Creative assets are https only, from an allowlisted host, fetched and
 * cached by us. Never hot-linked from advertiser servers." The bytes are fetched in the
 * main process, cached, and handed over inline - so the renderer never opens a
 * connection to an advertiser, and there is no request that could carry the user's IP.
 */
export interface SponsoredToast {
  readonly creativeId: string;
  readonly advertiser: string;
  readonly headline: string;
  readonly body: string | null;
  readonly logoDataUrl: string | null;
  readonly autoDismissMs: number;
}

/**
 * One frequency preset, as the earnings report shows it.
 *
 * `projectionLabel` is `null` until `/v1/config` has delivered a projections table. Null
 * rather than an estimate computed here: §1 forbids the client computing money, and
 * deviation D1 records that this is exactly why the server sends the table pre-computed.
 */
export interface EarningsPreset {
  readonly preset: string;
  /** True for the preset currently in effect, so the report can mark it. */
  readonly active: boolean;
  readonly minIntervalMs: number;
  readonly dailyCap: number;
  readonly projectionLabel: string | null;
}

export interface EarningsSnapshot {
  /** Preformatted by the ledger. The renderer never does arithmetic on money (§1). */
  readonly availableLabel: string;
  readonly lifetimeLabel: string;
  readonly hasServerBalance: boolean;
  /**
   * Whether ads are running at all.
   *
   * The report has to distinguish "you have earned nothing" from "you turned this off",
   * because the first is a number and the second is a setting.
   */
  readonly enabled: boolean;
  /**
   * Receipts written but not yet accepted by the server.
   *
   * Deliberately *not* labelled as an impression count anywhere in the UI. The receipt queue
   * is an outbox, not a ledger - entries are deleted once posted - so this number goes down
   * when things go right, and presenting it as "ads seen" would make a successful sync look
   * like lost earnings. It is shown as what it is: work waiting to be sent.
   */
  readonly pendingReceipts: number;
  readonly presets: readonly EarningsPreset[];
}

/* ── Live collaboration ────────────────────────────────────────────────────── */

/**
 * Mirrors of `@adcode/collab`'s types, restated here rather than imported.
 *
 * This file has to stay importable from a sandboxed preload, where only `electron`'s own module
 * exists - so it declares its own shapes and imports nothing. The same reason the diagnostics
 * and preview types are restated here.
 */
export type CollabRole = "host" | "editor" | "viewer";

export interface CollabParticipantView {
  readonly id: string;
  readonly name: string;
  readonly role: CollabRole;
  /** Their cursor colour, agreed by join order so every machine draws the same one. */
  readonly colour: string;
  readonly terminalWrite: boolean;
}

export interface CollabCapabilitiesView {
  readonly read: boolean;
  readonly edit: boolean;
  readonly save: boolean;
  readonly commitDirectly: boolean;
  readonly requestCommit: boolean;
  readonly readTerminal: boolean;
  readonly writeTerminal: boolean;
  readonly administer: boolean;
}

export interface CollabStatusView {
  readonly mode: "off" | "hosting" | "joined" | "connecting";
  readonly participants: readonly CollabParticipantView[];
  /** Our own id, so the renderer knows which cursor is its own and does not draw it twice. */
  readonly selfId: string | null;
  /** The invite code. Host only - a guest has nothing to pass on. */
  readonly invite: string | null;
  readonly addresses: readonly string[];
  readonly port: number | null;
  readonly error: string | null;
  /**
   * What *we* may do.
   *
   * Used to disable controls that would be refused anyway. It is a courtesy to the user, not a
   * security measure: the host re-checks every message it receives, because a guest's renderer
   * runs on a machine the host does not administer.
   */
  readonly can: CollabCapabilitiesView | null;
}

export interface CollabPresenceView {
  readonly participantId: string;
  readonly path: string | null;
  readonly cursor: { readonly line: number; readonly column: number };
  readonly selection: {
    readonly start: { readonly line: number; readonly column: number };
    readonly end: { readonly line: number; readonly column: number };
  } | null;
}

export interface CollabCommitRequestView {
  readonly id: string;
  readonly participantId: string;
  readonly participantName: string;
  readonly message: string;
}

/** Every channel name in one place, so main and preload cannot disagree. */
export const CHANNELS = {
  workspaceOpen: "workspace:open",
  workspaceCurrent: "workspace:current",
  fsList: "fs:list",
  fsRead: "fs:read",
  fsWrite: "fs:write",
  fsCreateFile: "fs:create-file",
  fsCreateFolder: "fs:create-folder",
  fsRename: "fs:rename",
  fsTrash: "fs:trash",
  fsDelete: "fs:delete",
  fsDuplicate: "fs:duplicate",
  fsCopy: "fs:copy",
  fsMove: "fs:move",
  fsImport: "fs:import",
  fsReveal: "fs:reveal",
  clipboardWrite: "clipboard:write",
  terminalCreate: "terminal:create",
  terminalWrite: "terminal:write",
  terminalResize: "terminal:resize",
  terminalDispose: "terminal:dispose",
  terminalProfiles: "terminal:profiles",
  terminalData: "terminal:data",
  terminalExit: "terminal:exit",
  platformInfo: "platform:info",
  windowFocus: "window:focus",
  adShow: "ads:show",
  adPainted: "ads:painted",
  adDismissed: "ads:dismissed",
  adClicked: "ads:clicked",
  adSuppressionChanged: "ads:suppression",
  adRefreshEarnings: "ads:refresh-earnings",
  earningsChanged: "ads:earnings",
  settingsRead: "settings:read",
  settingsWrite: "settings:write",
  settingsReset: "settings:reset",
  settingsChanged: "settings:changed",
  memoryConnection: "memory:connection",
  aiProviders: "ai:providers",
  aiSetKey: "ai:set-key",
  aiClearKey: "ai:clear-key",
  aiSend: "ai:send",
  aiCancel: "ai:cancel",
  aiReset: "ai:reset",
  aiEvent: "ai:event",
  aiProposedEdit: "ai:proposed-edit",
  aiApplyHunks: "ai:apply-hunks",
  gitStatus: "git:status",
  gitStage: "git:stage",
  gitUnstage: "git:unstage",
  gitDiscard: "git:discard",
  gitCommit: "git:commit",
  gitPush: "git:push",
  gitPull: "git:pull",
  gitFetch: "git:fetch",
  gitInit: "git:init",
  gitClone: "git:clone",
  gitAddRemote: "git:add-remote",
  gitRemotes: "git:remotes",
  gitBranches: "git:branches",
  gitCheckout: "git:checkout",
  gitCreateBranch: "git:create-branch",
  gitLog: "git:log",
  gitFileHistory: "git:file-history",
  gitBlame: "git:blame",
  gitLineChanges: "git:line-changes",
  gitDiff: "git:diff",
  gitShowFile: "git:show-file",
  gitCommitDetail: "git:commit-detail",
  gitCommitFileDiff: "git:commit-file-diff",
  gitRestoreFile: "git:restore-file",
  searchRun: "search:run",
  quickOpen: "search:quick-open",
  searchReplace: "search:replace",
  sessionRestore: "session:restore",
  sessionSave: "session:save",
  historyVersions: "history:versions",
  historyRead: "history:read",
  historyDraft: "history:draft",
  historyClearDraft: "history:clear-draft",
  historyDrafts: "history:drafts",
  fsSaveAs: "fs:save-as",
  workspaceClose: "workspace:close",
  menuCommand: "menu:command",
  windowFullScreen: "window:full-screen",
  windowDevTools: "window:dev-tools",
  windowZoom: "window:zoom",
  previewStart: "preview:start",
  previewStop: "preview:stop",
  previewStatus: "preview:status",
  previewOpenExternal: "preview:open-external",
  previewChanged: "preview:changed",
  previewDetect: "preview:detect",
  previewLog: "preview:log",
  previewOutput: "preview:output",
  lspOpened: "lsp:opened",
  lspChanged: "lsp:changed",
  lspClosed: "lsp:closed",
  lspCompletion: "lsp:completion",
  lspHover: "lsp:hover",
  lspStates: "lsp:states",
  lspDiagnostics: "lsp:diagnostics",
  lspStateChanged: "lsp:state-changed",
  collabHost: "collab:host",
  collabJoin: "collab:join",
  collabLeave: "collab:leave",
  collabStatus: "collab:status",
  collabSetRole: "collab:set-role",
  collabSetTerminalWrite: "collab:set-terminal-write",
  collabOpenDoc: "collab:open-doc",
  collabPushUpdate: "collab:push-update",
  collabSaveDoc: "collab:save-doc",
  collabPresence: "collab:presence",
  collabRequestCommit: "collab:request-commit",
  collabDecideCommit: "collab:decide-commit",
  collabStatusChanged: "collab:status-changed",
  collabDocUpdate: "collab:doc-update",
  collabPresenceChanged: "collab:presence-changed",
  collabCommitRequested: "collab:commit-requested",
  collabNotice: "collab:notice",
  collabAddresses: "collab:addresses",
  collabReencodeInvite: "collab:reencode-invite",
  workspaceOpenPath: "workspace:open-path",
  workspaceRecents: "workspace:recents",
  workspaceForgetRecent: "workspace:forget-recent",
  workspaceClearRecents: "workspace:clear-recents",
  filesOpenDialog: "fs:open-dialog",
  appInfo: "app:info",
  supportSubmitReport: "support:submit-report",
  updateStatus: "update:status",
  serviceNotice: "notice:show",
  updateChanged: "update:changed",
} as const;

/**
 * Which of the two preview engines is in charge.
 *
 * `static` is ADCode's own file server over the folder. `project` runs the project's own
 * dev script and watches for the address it prints. They are genuinely different things
 * and the bar says which one is running, because "why isn't my React app working" and "why
 * isn't my HTML file loading" have completely different answers.
 */
export type PreviewMode = "static" | "project";

/**
 * The live preview's state.
 *
 * `error` carries the reason a start failed, and is shown to the user as written. A preview
 * that is simply not there, with no explanation, is the failure mode this field exists to
 * prevent.
 */
export interface PreviewStatus {
  readonly running: boolean;
  readonly url: string | null;
  readonly root: string | null;
  readonly error: string | null;
  readonly mode: PreviewMode;
  /** Project mode: what is being run, e.g. "Vite · npm run dev". */
  readonly label: string | null;
  /** Project mode: the process is up but has not announced an address yet. */
  readonly starting: boolean;
}

/** What `preview.detect()` found, or null when the folder has no dev script. */
export interface PreviewProject {
  readonly label: string;
}

/**
 * What a language server is doing, per language.
 *
 * `missing` is the common case and is not a failure: most people have not installed a Rust
 * toolchain. `detail` then carries the exact command that would change that, which is the
 * whole difference between "this editor has no Rust support" and "this editor needs one
 * more install".
 */
export interface LanguageServerState {
  readonly languageId: string;
  readonly label: string;
  readonly status: "starting" | "running" | "missing" | "failed";
  readonly detail: string | null;
}

/** Mirrors @adcode/diagnostics' `Diagnostic`, so the preload imports no package. */
export interface LanguageDiagnostic {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly severity: "error" | "warning" | "info";
  readonly source: string;
  readonly code: string;
  readonly message: string;
}

/**
 * A completion, flattened for the wire.
 *
 * Deliberately not the server's own object. A language server's reply is arbitrary JSON
 * from a subprocess, and forwarding it whole would hand the renderer a shape nothing has
 * checked - so it is reduced here to the fields the suggest widget actually reads.
 */
export interface LanguageCompletion {
  readonly label: string;
  readonly kind: number | null;
  readonly detail: string | null;
  readonly documentation: string | null;
  readonly insertText: string;
  readonly isSnippet: boolean;
  readonly sortText: string | null;
}

/** Mirrors @adcode/git's shapes, so the renderer needs no import from that package. */
export interface GitStatusView {
  readonly branch: string | null;
  readonly upstream: string | null;
  readonly ahead: number;
  readonly behind: number;
  readonly isRepo: boolean;
  readonly isClean: boolean;
  readonly hasConflicts: boolean;
  readonly entries: ReadonlyArray<{
    readonly path: string;
    readonly staged: string;
    readonly worktree: string;
    readonly isConflicted: boolean;
  }>;
}

export interface GitCommitView {
  readonly hash: string;
  readonly shortHash: string;
  readonly subject: string;
  readonly author: string;
  readonly date: string;
}

/** One file as a commit changed it. */
export interface GitCommitFileView {
  readonly path: string;
  readonly kind: "none" | "added" | "modified" | "deleted" | "renamed" | "untracked";
  readonly added: number;
  readonly removed: number;
}

export interface GitCommitDetailView extends GitCommitView {
  readonly body: string;
  readonly files: readonly GitCommitFileView[];
}

export interface GitBranchView {
  readonly name: string;
  readonly current: boolean;
  readonly upstream: string | null;
}

export interface GitOutcome {
  readonly ok: boolean;
  readonly message: string;
}

export interface LineChangeView {
  readonly kind: "added" | "modified" | "deleted";
  readonly startLine: number;
  readonly lineCount: number;
}

export interface BlameLineView {
  readonly line: number;
  readonly hash: string;
  readonly author: string;
  readonly date: string;
  readonly summary: string;
}

export interface SearchHitView {
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly text: string;
  readonly matchLength: number;
}

/** One saved version of a file, kept locally (§4's "local file history"). */
export interface HistoryEntryView {
  readonly id: string;
  readonly savedAt: string;
  readonly bytes: number;
}

/** An unsaved buffer found after an unexpected exit (§4's "crash recovery"). */
export interface RecoveredDraftView {
  readonly path: string;
  readonly text: string;
  readonly savedAt: string;
}

/** What the shell reopens on launch (§4's "Restore workspace"). */
/** Sizes the user dragged the workbench to. Pixels. */
export interface LayoutView {
  readonly sidebarWidth: number;
  readonly panelHeight: number;
}

export interface SessionStateView {
  readonly root: string | null;
  readonly openFiles: readonly string[];
  readonly activeFile: string | null;
  /** Absent in sessions written before the layout was adjustable. */
  readonly layout?: LayoutView;
}

export interface SearchQueryView {
  readonly pattern: string;
  readonly isRegex?: boolean;
  readonly caseSensitive?: boolean;
  readonly wholeWord?: boolean;
  readonly include?: string;
  readonly exclude?: string;
}

export interface ReplaceSummaryView {
  readonly files: number;
  readonly replacements: number;
}

export interface QuickOpenHit {
  readonly path: string;
  readonly positions: readonly number[];
}

/** One provider, as the chat widget's model picker needs to see it. */
export interface AiProviderInfo {
  readonly id: string;
  readonly displayName: string;
  readonly models: readonly string[];
  /** False until the user supplies a key. Ollama needs none, so it is always true. */
  readonly hasKey: boolean;
  readonly needsKey: boolean;
}

export interface AiStatus {
  readonly providers: readonly AiProviderInfo[];
  readonly activeProvider: string;
  readonly activeModel: string;
  readonly ready: boolean;
}

/** A hunk of a proposed change, as rendered in the inline diff widget. */
export interface DiffHunkView {
  readonly id: string;
  readonly startLine: number;
  readonly original: readonly string[];
  readonly replacement: readonly string[];
}

export interface ProposedEditView {
  readonly path: string;
  readonly displayPath: string;
  readonly summary: string;
  readonly hunks: readonly DiffHunkView[];
}

/**
 * Everything a user needs to connect an external agent to the shared memory.
 *
 * §5.2 is blunt about why this is surfaced in the app rather than left to documentation:
 * "a user who has to figure out MCP configuration by themselves will not do it, and the
 * entire feature dies there."
 */
export interface McpConnectionInfo {
  /** The exact command to run, ready to paste. */
  readonly command: string;
  /** Where the memory lives on disk, so the user can go and look at it. */
  readonly storePath: string | null;
  /** False when no folder is open, since the store is per-workspace. */
  readonly available: boolean;
}

/** What `window.adcode` exposes. Nothing else crosses the boundary. */
export interface AdcodeApi {
  readonly workspace: {
    open(): Promise<OpenedWorkspace | null>;
    /** Open a known folder without a dialog - the recents list and the welcome screen. */
    openPath(root: string): Promise<OpenedWorkspace | null>;
    close(): Promise<void>;
    current(): Promise<OpenedWorkspace | null>;
    list(dirPath: string): Promise<DirEntry[]>;
    /** Folders opened before, newest first, with the ones that no longer exist removed. */
    recents(): Promise<readonly RecentFolderView[]>;
    forgetRecent(root: string): Promise<readonly RecentFolderView[]>;
    clearRecents(): Promise<void>;
  };
  /** Version and runtime, for the welcome screen and the settings footer. */
  readonly app: {
    info(): Promise<AppInfo>;
  };
  readonly files: {
    read(filePath: string): Promise<FileContent>;
    /** Ask for a file to open; resolves to its path, or null if cancelled. */
    openDialog(): Promise<string | null>;
    write(filePath: string, text: string): Promise<SaveResult>;
    /** Ask where to put it; resolves to the chosen path, or null if cancelled. */
    saveAs(text: string, suggestedName: string): Promise<string | null>;
    /** Structural changes. `name` is one path segment; the main process validates it. */
    createFile(parentDir: string, name: string): Promise<FileOpResult>;
    createFolder(parentDir: string, name: string): Promise<FileOpResult>;
    rename(target: string, name: string): Promise<FileOpResult>;
    /** To the Recycle Bin, not `rm` - deleting the wrong row stays recoverable. */
    trash(target: string): Promise<FileOpResult>;
    /** Irreversible. Only for when `trash` reports `trash-failed` and the user agrees. */
    delete(target: string): Promise<FileOpResult>;
    reveal(target: string): Promise<FileOpResult>;
    duplicate(target: string): Promise<FileOpResult>;
    copy(source: string, targetDir: string): Promise<FileOpResult>;
    move(source: string, targetDir: string): Promise<FileOpResult>;
    /** Copy something from outside the workspace in - a drop from the file manager. */
    importFrom(source: string, targetDir: string): Promise<FileOpResult>;
    /**
     * The real path behind a dropped `File`.
     *
     * `File.path` was removed in Electron 32; `webUtils.getPathForFile` replaces it and
     * has to be called on this side of the bridge, with the object itself.
     */
    pathForDropped(file: File): string;
  };
  /**
   * Electron's clipboard rather than `navigator.clipboard`, which needs a secure context
   * the app's custom protocol does not reliably provide.
   */
  readonly clipboard: {
    writeText(text: string): Promise<void>;
  };
  readonly terminal: {
    profiles(): Promise<TerminalProfile[]>;
    create(options: { profileId?: string; cwd?: string; cols: number; rows: number }): Promise<string>;
    write(id: string, data: string): void;
    resize(id: string, cols: number, rows: number): void;
    dispose(id: string): void;
    onData(listener: (id: string, data: string) => void): () => void;
    onExit(listener: (id: string, exitCode: number) => void): () => void;
  };
  readonly platform: {
    info(): Promise<PlatformInfo>;
    onFocusChange(listener: (focused: boolean) => void): () => void;
  };
  /**
   * The built-in static server over the open folder (slice 2 of the learner surfaces).
   *
   * `openExternal` takes no URL: the renderer names the intent, and the main process
   * supplies the address from the server it actually started. A renderer that could hand
   * over an arbitrary URL to `shell.openExternal` would be a way out of the sandbox
   * dressed as a convenience.
   */
  readonly preview: {
    /** Omit the mode to let ADCode pick: the project's dev script when there is one. */
    start(mode?: PreviewMode): Promise<PreviewStatus>;
    stop(): Promise<PreviewStatus>;
    status(): Promise<PreviewStatus>;
    /** What running this project would start, without starting it. */
    detect(): Promise<PreviewProject | null>;
    openExternal(): Promise<void>;
    onChange(listener: (status: PreviewStatus) => void): () => void;
    /**
     * The dev server's own output.
     *
     * Surfaced rather than swallowed: when a project fails to start, the toolchain's own
     * words are the useful thing, and every message we could invent instead is worse.
     */
    onOutput(listener: (chunk: string) => void): () => void;
    log(): Promise<string>;
  };
  /**
   * Language intelligence from a real language server (§4's Language group).
   *
   * Document synchronisation is fire-and-forget: the renderer tells the main process what
   * changed and never waits, because everything here sits on the keystroke path and §7 is
   * explicit that nothing the user types may wait on anything.
   */
  readonly language: {
    opened(path: string, languageId: string, text: string): void;
    changed(path: string, languageId: string, text: string): void;
    closed(path: string, languageId: string): void;
    completion(
      path: string,
      languageId: string,
      line: number,
      column: number,
    ): Promise<LanguageCompletion[]>;
    hover(path: string, languageId: string, line: number, column: number): Promise<string | null>;
    states(): Promise<LanguageServerState[]>;
    onDiagnostics(listener: (file: string, diagnostics: LanguageDiagnostic[]) => void): () => void;
    onState(listener: (states: LanguageServerState[]) => void): () => void;
  };
  readonly memory: {
    connection(): Promise<McpConnectionInfo>;
  };
  readonly ai: {
    status(): Promise<AiStatus>;
    setKey(provider: string, key: string): Promise<AiStatus>;
    clearKey(provider: string): Promise<AiStatus>;
    send(text: string): Promise<void>;
    cancel(): void;
    reset(): void;
    /** The agent's workings, live - this is what the trace widget renders (§5.3). */
    onEvent(listener: (event: unknown) => void): () => void;
    onProposedEdit(listener: (edit: ProposedEditView) => void): () => void;
    applyHunks(path: string, acceptedHunkIds: readonly string[]): Promise<boolean>;
  };
  readonly git: {
    status(): Promise<GitStatusView>;
    stage(paths: readonly string[]): Promise<GitOutcome>;
    unstage(paths: readonly string[]): Promise<GitOutcome>;
    discard(paths: readonly string[]): Promise<GitOutcome>;
    commit(message: string): Promise<GitOutcome>;
    push(): Promise<GitOutcome>;
    pull(): Promise<GitOutcome>;
    fetch(): Promise<GitOutcome>;
    init(): Promise<GitOutcome>;
    clone(url: string, target: string): Promise<GitOutcome>;
    /** Connect this repository to a remote, or correct the URL of one it already has. */
    addRemote(name: string, url: string): Promise<GitOutcome>;
    /** The remotes configured, so the panel can offer to add one when there are none. */
    remotes(): Promise<readonly { readonly name: string; readonly url: string }[]>;
    branches(): Promise<GitBranchView[]>;
    checkout(ref: string): Promise<GitOutcome>;
    createBranch(name: string): Promise<GitOutcome>;
    log(limit?: number): Promise<GitCommitView[]>;
    fileHistory(path: string): Promise<GitCommitView[]>;
    lineChanges(path: string): Promise<LineChangeView[]>;
    blame(path: string): Promise<BlameLineView[]>;
    diff(path?: string): Promise<string>;
    /** A file as it was at a revision, or null if it was not there. */
    showFile(ref: string, path: string): Promise<string | null>;
    commitDetail(ref: string): Promise<GitCommitDetailView | null>;
    commitFileDiff(ref: string, path: string): Promise<string>;
    /**
     * Put one file back as it was at a commit.
     *
     * Lands as an uncommitted working-tree change; nothing already committed is
     * rewritten, so a restore chosen by mistake is undone by discarding it.
     */
    restoreFile(ref: string, path: string): Promise<GitOutcome>;
  };
  readonly search: {
    run(query: SearchQueryView): Promise<SearchHitView[]>;
    /** §4's "global regex search and replace". Returns what it changed. */
    replace(query: SearchQueryView, replacement: string): Promise<ReplaceSummaryView>;
    quickOpen(query: string): Promise<QuickOpenHit[]>;
  };
  readonly session: {
    restore(): Promise<SessionStateView>;
    save(state: SessionStateView): void;
  };
  readonly window: {
    /**
     * Menu choices arrive here; the renderer's command registry runs them.
     *
     * `arg` is what the command is being asked to act on - a recent folder's path, so
     * far. It is absent for every command that acts on the current state instead.
     */
    onCommand(listener: (command: string, arg?: string) => void): () => void;
    toggleFullScreen(): void;
    toggleDevTools(): void;
    /** `+1`, `-1`, or `0` to reset. */
    zoom(direction: number): void;
  };
  readonly history: {
    versions(path: string): Promise<HistoryEntryView[]>;
    read(path: string, id: string): Promise<string | null>;
    /** Keep a copy of an unsaved buffer, in case the editor does not come back. */
    draft(path: string, text: string): void;
    clearDraft(path: string): void;
    drafts(): Promise<RecoveredDraftView[]>;
  };
  readonly settings: {
    read(): Promise<Record<string, boolean | string>>;
    write(id: string, value: boolean | string): Promise<Record<string, boolean | string>>;
    reset(): Promise<Record<string, boolean | string>>;
    onChanged(listener: (values: Record<string, boolean | string>) => void): () => void;
  };
  readonly notices: {
    onShow(listener: (notices: readonly ServiceNotice[]) => void): () => void;
  };
  readonly updates: {
    status(): Promise<UpdateStatus>;
    onChanged(listener: (status: UpdateStatus) => void): () => void;
  };
  readonly support: {
    /** Never rejects: a failure comes back as `{ ok: false, message }` to show the user. */
    submitReport(input: ReportInput): Promise<ReportResult>;
  };
  readonly ads: {
    /** The main process asks the renderer to show a toast. */
    onShow(listener: (toast: SponsoredToast) => void): () => void;
    onEarnings(listener: (earnings: EarningsSnapshot) => void): () => void;
    /**
     * The toast actually painted. One of the three conditions §1 requires before an
     * impression may be reported; the renderer is the only place that knows it.
     */
    painted(creativeId: string): void;
    dismissed(creativeId: string): void;
    clicked(creativeId: string): void;
    /**
     * Ask the server for the balance now.
     *
     * The tick refreshes it every sixty seconds anyway; this is how the report's refresh button
     * answers "is this stuck?" without the user waiting one out.
     */
    refreshEarnings(): Promise<EarningsSnapshot>;
    /** Zen, full-screen, and presentation mode (§8.3). */
    setSuppressed(suppressed: boolean): void;
  };
  /**
   * Live collaboration.
   *
   * The transport runs in the main process, and that follows from the CSP rather than from
   * taste - exactly as it does for the ad client. §1 requires `connect-src 'self'`, and a
   * renderer under that policy cannot open a socket to another machine at all. So the renderer's
   * job here is to draw a roster, bind Monaco to a document, and paint other people's cursors.
   */
  readonly collab: {
    /**
     * Start sharing the open folder.
     *
     * `bind: "lan"` publishes to the local network. It is never a default anywhere in this
     * codebase and the caller has to ask for it - see `lanTransport.ts` for why that matters.
     */
    host(options: {
      bind: "lan" | "loopback";
      port: number;
      displayName: string;
    }): Promise<CollabStatusView>;
    join(code: string, displayName: string): Promise<CollabStatusView>;
    leave(): Promise<CollabStatusView>;
    status(): Promise<CollabStatusView>;
    /** Every address the session could be reached on, so the user can pick the right one. */
    addresses(): Promise<readonly string[]>;
    /** Re-issue the invite code against a different local address. */
    reencodeInvite(address: string): Promise<string | null>;
    setRole(participantId: string, role: CollabRole): Promise<CollabStatusView>;
    setTerminalWrite(participantId: string, allowed: boolean): Promise<CollabStatusView>;
    /**
     * Join a document, receiving its state as base64 for the renderer's Yjs replica.
     *
     * `null` when the path is not shareable - outside the folder, or unreadable. The renderer
     * treats that as "edit this file normally, alone", never as an error worth a dialog.
     */
    openDoc(path: string): Promise<string | null>;
    /** A local edit, as a base64 Yjs update. Fire-and-forget: it sits on the keystroke path. */
    pushUpdate(path: string, update: string): void;
    saveDoc(path: string): Promise<boolean>;
    presence(
      path: string | null,
      cursor: { line: number; column: number },
      selection: { start: { line: number; column: number }; end: { line: number; column: number } } | null,
    ): void;
    /** A guest asking the host to commit. The host approves or declines. */
    requestCommit(message: string): void;
    decideCommit(id: string, approved: boolean, detail: string): void;
    onStatus(listener: (status: CollabStatusView) => void): () => void;
    onDocUpdate(listener: (path: string, update: string) => void): () => void;
    onPresence(listener: (presence: readonly CollabPresenceView[]) => void): () => void;
    onCommitRequest(listener: (request: CollabCommitRequestView) => void): () => void;
    onNotice(listener: (detail: string) => void): () => void;
  };
}
