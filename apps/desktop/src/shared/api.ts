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

export interface EarningsSnapshot {
  /** Preformatted by the ledger. The renderer never does arithmetic on money (§1). */
  readonly availableLabel: string;
  readonly lifetimeLabel: string;
  readonly hasServerBalance: boolean;
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
  gitBranches: "git:branches",
  gitCheckout: "git:checkout",
  gitCreateBranch: "git:create-branch",
  gitLog: "git:log",
  gitFileHistory: "git:file-history",
  gitBlame: "git:blame",
  gitLineChanges: "git:line-changes",
  gitDiff: "git:diff",
  gitShowFile: "git:show-file",
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
} as const;

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
export interface SessionStateView {
  readonly root: string | null;
  readonly openFiles: readonly string[];
  readonly activeFile: string | null;
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
    close(): Promise<void>;
    current(): Promise<OpenedWorkspace | null>;
    list(dirPath: string): Promise<DirEntry[]>;
  };
  readonly files: {
    read(filePath: string): Promise<FileContent>;
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
    /** Menu choices arrive here; the renderer's command registry runs them. */
    onCommand(listener: (command: string) => void): () => void;
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
    /** Zen, full-screen, and presentation mode (§8.3). */
    setSuppressed(suppressed: boolean): void;
  };
}
