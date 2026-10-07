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

/**
 * An IDE surface another window may ask it to reveal, and the command that reveals it.
 *
 * A closed list rather than any command name: one window must not be able to run arbitrary
 * commands in another, only point it at a view.
 */
export const IDE_VIEW_COMMANDS = {
  explorer: "view.explorer",
  search: "view.search",
} as const;
export type IdeView = keyof typeof IDE_VIEW_COMMANDS;

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

import type { ActivityDelta } from "./activity.ts";
import type { MilestoneName } from "./milestones.ts";
import type { AssistantControlAction, AssistantControlsView } from "./assistantControls.ts";
import type { McpNodeCheck } from "./mcpNode.ts";

export type { ActivityDelta };

/**
 * A theme, once it has been resolved.
 *
 * The *setting* has a fourth value, `system`, which is a way of declining to choose;
 * by the time anything paints, that has become one of these three. Midnight is not
 * "dark with different numbers" - it is the website's palette, and it inverts the
 * accent, so the editor and the terminal each need their own colours for it rather
 * than being handed `dark` and told to cope.
 */
export type ThemeChoice = "light" | "dark" | "midnight";

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
/**
 * Whether this machine's earnings are attached to a real account.
 *
 * `anonymous` is the normal starting state, not an error: you earn from first launch with
 * no sign-up. Linking is what makes the balance reachable from the web dashboard and, in
 * time, withdrawable.
 */
export type AccountState =
  | {
      readonly state: "anonymous";
      /**
       * The account id ads are actually served to.
       *
       * Surfaced because an anonymous account has nothing else to identify it by, and the
       * admin panel's "queue a test ad" needs to name one. Its user picker searches by
       * name and address - which is everything an anonymous account does not have - so
       * without this there was no way to discover which account the editor was running
       * as, and a card queued against the wrong one waited forever while the admin screen
       * said "Queued". Pseudonymous by design (§8.4): it identifies a machine's earnings,
       * not a person.
       */
      readonly uid?: string;
    }
  /** No Firebase key in this build, or pointed at a dev server. Offer nothing. */
  | { readonly state: "unavailable" }
  | {
      readonly state: "linked";
      readonly email: string | null;
      readonly displayName: string | null;
      readonly photoUrl: string | null;
      readonly providers: readonly string[];
      readonly uid?: string;
    };

export type LinkOutcome =
  | { readonly ok: true; readonly state: AccountState }
  /**
   * The credential is good, but it belongs to an account that already exists, and this
   * machine has unclaimed earnings that signing in as that account would leave behind.
   *
   * Only raised when there is something to lose: with a zero balance the main process
   * signs in without asking, because there is no decision to put to anyone. The
   * credential is held for a moment so answering "yes" does not mean a second trip
   * through the browser; `account.signInInstead()` spends it.
   */
  | {
      readonly ok: false;
      readonly decide: "sign-in-instead";
      readonly message: string;
      /** Formatted for display, e.g. `$1.23`. */
      readonly unclaimed: string;
    }
  | { readonly ok: false; readonly message: string };

/** GitHub's device flow shows the user a code to type on github.com. */
export interface DeviceCode {
  readonly userCode: string;
  readonly verificationUri: string;
}

export interface ServiceNotice {
  readonly noticeId: string;
  readonly severity: "info" | "warning";
  readonly title: string;
  readonly body: string;
}

/** A release note, as the main process hands it to the window. */
export interface ReleaseNote {
  readonly version: string;
  readonly title: string;
  readonly body: string;
  readonly highlights: readonly string[];
  /** The admin asked for this one to be shown to people, not just written down. */
  readonly announce: boolean;
  /** Security or data loss: worth interrupting a working user for. */
  readonly critical: boolean;
  readonly publishedAt: number | null;
}

/**
 * Everything the window needs to decide whether to mention a new version.
 *
 * The decision itself lives in `@adcode/release` and runs in the renderer, because the
 * renderer is the only side that knows whether somebody is mid-keystroke. Main supplies
 * the facts it owns - what shipped, what this build is, what has already been shown.
 */
export interface ReleaseAnnouncement {
  readonly releases: readonly ReleaseNote[];
  readonly currentVersion: string;
  readonly seenVersions: readonly string[];
  /** False only on a machine that has never opened ADCode before. */
  readonly hasRunBefore: boolean;
}

export type UpdateStatus =
  | { readonly state: "idle" | "checking" | "current" | "failed" | "unsupported" }
  | { readonly state: "downloading"; readonly version?: string; readonly percent?: number }
  | {
      readonly state: "ready";
      readonly version: string;
      /**
       * Whether "Restart now" is offered. Windows only: its installer waits for the old
       * process before reopening, while an AppImage relaunches at once into ADCode's own
       * single-instance lock. Elsewhere the update installs when ADCode is closed.
       */
      readonly restartable?: boolean;
    };

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

/**
 * An image file, read for preview.
 *
 * Text goes over `fs:read` as UTF-8; bytes cannot, so images travel as a `data:` URL
 * the renderer can put straight into an `<img>`. The main process names the media type
 * from the extension, and refuses anything it does not recognise.
 */
export interface FileImageContent {
  readonly path: string;
  readonly dataUrl: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
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

/** What the pin card says, once the main process has decided it should say anything. */
export interface PinPromptContentView {
  readonly title: string;
  readonly body: string;
  /** The manual route, in order. Always present: it is the answer on two of three platforms. */
  readonly steps: readonly string[];
  /**
   * The label on a button that really pins, or null where the operating system forbids
   * one - which is Windows and macOS always, and Linux outside a GNOME session or without
   * an installed desktop entry. See `main/pinPromptPolicy.ts` for why.
   */
  readonly pinLabel: string | null;
  readonly howLabel: string;
}

export type PinPromptOffer =
  | { readonly ask: false }
  | { readonly ask: true; readonly content: PinPromptContentView };

/** The outcome of a pin attempt. Always an outcome, never a throw, like `FileOpResult`. */
export interface PinResult {
  readonly ok: boolean;
  readonly message: string;
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
 * What the editor knows about itself that the ad client needs.
 *
 * These three arrive together because they come from one place - the shell - and travel
 * one way. The ad client asks for them through `IdeSignals`, and until this channel
 * existed nothing ever answered: `languageIds` and `filenames` were permanently empty,
 * so every serve request went out untargeted and the whole tag vocabulary was dead in
 * the shipped app; `themeKind` was permanently `"dark"`, so a light-theme user got the
 * dark logo and every receipt reported a theme the user was not using.
 *
 * `themeKind` is two-valued where the app's own `ThemeChoice` is three: midnight is a
 * dark theme, and an advertiser's light/dark artwork is the only thing this decides.
 *
 * Filenames are basenames, never paths - the tagger is documented to see basenames only
 * (§8.2), and sending a path would put the user's directory layout on the wire for no
 * gain.
 */
export interface AdSignals {
  readonly themeKind: "light" | "dark";
  /** Open editors' language ids. Never file contents. */
  readonly languageIds: readonly string[];
  /** Basenames of the open editors and the workspace root. Never full paths. */
  readonly filenames: readonly string[];
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

/**
 * This account's invite, as `GET /v1/referrals` describes it. Money stays a decimal string
 * of micros, as everywhere the client shows money: §1, the client never computes it.
 */
export interface ReferralView {
  readonly code: string;
  readonly link: string;
  readonly showName: boolean;
  /** Exactly what this account's invite page says at the top. */
  readonly inviterPreview: string;
  /** Whether this account came in through an invite. */
  readonly claimed: boolean;
  /** The first name of whoever invited it, when they let it show. */
  readonly invitedBy: string | null;
  readonly canClaim: boolean;
  readonly claimEndsAt: number;
  readonly people: { readonly claimed: number; readonly seen: number; readonly cameBack: number };
  readonly advertisers: number;
  readonly earnedMicros: string;
  readonly last30Micros: string;
  readonly rates: { readonly userPercent: number; readonly advertiserPercent: number; readonly windowDays: number };
}

/**
 * Why a claim did not go through. The first four are the server's; `invalid` is text that
 * is not a code, `offline` is no answer, `unavailable` is a service without invites yet.
 */
export type InviteClaimError = "unknown-code" | "already-claimed" | "too-late" | "own-code" | "invalid" | "offline" | "unavailable";
export type InviteClaimResult = { readonly ok: true; readonly inviterName: string | null } | { readonly ok: false; readonly error: InviteClaimError };
/** The welcome's clipboard look. Never the clipboard's contents: those stay in main. */
export type ClipboardInviteResult = { readonly claimed: true; readonly inviterName: string | null } | { readonly claimed: false };

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
  /**
   * Why no card has appeared, or `null` when nothing is standing in the way.
   *
   * The scheduler has always known this - it returns a reason with every refusal - and
   * it went nowhere but a debug log. So "I queued an ad and it never came" had no answer
   * short of reading source: the honest reply is usually "you are eight minutes into a
   * ten-minute gap", and there was no way for the app to say so.
   *
   * One of the `SuppressReason` values from `@adcode/ads`, kept as a plain string here
   * because `shared/` must not import a package (the dependency firewall forbids it).
   */
  readonly suppressedReason: string | null;
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
/**
 * One TCP port something is listening on.
 *
 * `own` is the difference between "stop the live server you started" and "kill a process
 * you did not" - the renderer confirms the second and not the first.
 */
export interface ListeningPort {
  readonly port: number;
  readonly pid: number | null;
  /** The process image name, when the platform's tools reported one. */
  readonly process: string | null;
  /** The bound address: `127.0.0.1`, `0.0.0.0`, `::` and so on. */
  readonly address: string;
  /** A URL safe to open - a wildcard bind becomes `localhost`, never `0.0.0.0`. */
  readonly url: string;
  /** What ADCode calls it, when ADCode started it. */
  readonly label: string | null;
  readonly own: boolean;
}

/**
 * The Output panel's channels.
 *
 * A closed set rather than free-form strings: every one of these is a place in the main
 * process that already produced text and previously threw it away. Adding a channel means
 * finding a real source for it, which is the point - an empty dropdown entry is worse than
 * no entry.
 */
export type OutputChannelId = "dev-server" | "live-server" | "language-server" | "git";

export interface OutputLine {
  readonly channel: OutputChannelId;
  readonly text: string;
}

export const CHANNELS = {
  workspaceOpen: "workspace:open",
  workspaceCurrent: "workspace:current",
  fsList: "fs:list",
  fsRead: "fs:read",
  fsReadImage: "fs:read-image",
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
  clipboardRead: "clipboard:read",
  terminalCreate: "terminal:create",
  terminalWrite: "terminal:write",
  terminalResize: "terminal:resize",
  terminalDispose: "terminal:dispose",
  terminalProfiles: "terminal:profiles",
  terminalOpenLink: "terminal:open-link",
  terminalData: "terminal:data",
  terminalExit: "terminal:exit",
  platformInfo: "platform:info",
  windowFocus: "window:focus",
  adShow: "ads:show",
  adPainted: "ads:painted",
  adDismissed: "ads:dismissed",
  adClicked: "ads:clicked",
  adSuppressionChanged: "ads:suppression",
  adSignals: "ads:signals",
  adRefreshEarnings: "ads:refresh-earnings",
  earningsChanged: "ads:earnings",
  settingsRead: "settings:read",
  settingsWrite: "settings:write",
  settingsReset: "settings:reset",
  settingsChanged: "settings:changed",
  memoryConnection: "memory:connection",
  memoryList: "memory:list",
  memoryWrite: "memory:write",
  memoryRemove: "memory:remove",
  aiProviders: "ai:providers",
  aiSetKey: "ai:set-key",
  aiClearKey: "ai:clear-key",
  aiSend: "ai:send",
  aiControlsRead: "ai-controls:read",
  aiControlsAction: "ai-controls:action",
  aiControlsPreviewSkill: "ai-controls:preview-skill",
  aiControlsChanged: "ai-controls:changed",
  aiCompletion: "ai:completion",
  aiCancelCompletion: "ai:cancel-completion",
  aiInlineEdit: "ai:inline-edit",
  aiCancelInlineEdit: "ai:cancel-inline-edit",
  aiCancel: "ai:cancel",
  aiReset: "ai:reset",
  aiAnswerAnyway: "ai:answer-anyway",
  aiEvent: "ai:event",
  aiCompact: "ai:compact",
  aiContextUsage: "ai:context-usage",
  aiProposedEdit: "ai:proposed-edit",
  aiSessionChanged: "ai:session-changed",
  aiSessions: "ai:sessions",
  aiResumeSession: "ai:resume-session",
  aiRenameSession: "ai:rename-session",
  aiDeleteSession: "ai:delete-session",
  aiClearSessions: "ai:clear-sessions",
  aiCheckKey: "ai:check-key",
  aiQuickConnect: "ai:quick-connect",
  aiDetectOllama: "ai:detect-ollama",
  aiStartOllama: "ai:start-ollama",
  aiOpenKeyPage: "ai:open-key-page",
  aiCheckpoint: "ai:checkpoint",
  aiCheckpointUndo: "ai:checkpoint-undo",
  aiWorkspaceList: "ai-workspace:list",
  aiWorkspaceCurrent: "ai-workspace:current",
  aiWorkspaceChanges: "ai-workspace:changes",
  aiWorkspaceTraces: "ai-workspace:traces",
  aiWorkspaceApply: "ai-workspace:apply",
  aiWorkspaceDiscard: "ai-workspace:discard",
  aiWorkspaceRemove: "ai-workspace:remove",
  aiWorkspaceRollback: "ai-workspace:rollback",
  aiWorkspaceChanged: "ai-workspace:changed",
  aiTeamSuggest: "ai-team:suggest",
  aiTeamConfigure: "ai-team:configure",
  aiTeamList: "ai-team:list",
  aiTeamRead: "ai-team:read",
  aiTeamStart: "ai-team:start",
  aiTeamCancel: "ai-team:cancel",
  aiTeamTraces: "ai-team:traces",
  aiTeamChanged: "ai-team:changed",
  aiAutomationCreate: "ai-automation:create",
  aiAutomationList: "ai-automation:list",
  aiAutomationClaim: "ai-automation:claim",
  aiAutomationComplete: "ai-automation:complete",
  aiAutomationMiss: "ai-automation:miss",
  aiAutomationRetry: "ai-automation:retry",
  aiAutomationCancel: "ai-automation:cancel",
  aiAutomationConfirmMissed: "ai-automation:confirm-missed",
  aiAutomationMarkDueMissed: "ai-automation:mark-due-missed",
  aiAutomationChanged: "ai-automation:changed",
  gitStatus: "git:status",
  gitStage: "git:stage",
  gitUnstage: "git:unstage",
  gitDiscard: "git:discard",
  gitCommit: "git:commit",
  gitPush: "git:push",
  gitPull: "git:pull",
  gitFetch: "git:fetch",
  gitInit: "git:init",
  gitTrust: "git:trust",
  gitIdentity: "git:identity",
  gitSetIdentity: "git:set-identity",
  gitClone: "git:clone",
  gitAddRemote: "git:add-remote",
  gitRemotes: "git:remotes",
  gitOpenGitHub: "git:open-github",
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
  sessionOpenIntent: "session:open-intent",
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
  windowOpenIde: "window:open-ide",
  windowOpenVibe: "window:open-vibe",
  windowRendererReady: "window:renderer-ready",
  workspaceChanged: "workspace:changed",
  previewStart: "preview:start",
  previewStop: "preview:stop",
  previewStatus: "preview:status",
  previewOpenExternal: "preview:open-external",
  previewChanged: "preview:changed",
  previewDetect: "preview:detect",
  previewLog: "preview:log",
  previewOutput: "preview:output",
  portsList: "ports:list",
  portsStop: "ports:stop",
  portsOpen: "ports:open",
  outputHistory: "output:history",
  outputAppend: "output:append",
  lspOpened: "lsp:opened",
  lspChanged: "lsp:changed",
  lspClosed: "lsp:closed",
  lspCompletion: "lsp:completion",
  lspFormatting: "lsp:formatting",
  lspDefinition: "lsp:definition",

  debugState: "debug:state",
  debugStart: "debug:start",
  debugStop: "debug:stop",
  debugControl: "debug:control",
  debugToggleBreakpoint: "debug:toggle-breakpoint",
  debugEvaluate: "debug:evaluate",
  debugBreakpoints: "debug:breakpoints",
  debugScopes: "debug:scopes",
  debugProperties: "debug:properties",
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
  workspaceCreateProject: "workspace:create-project",
  workspaceRecents: "workspace:recents",
  workspaceFilesChanged: "workspace:files-changed",
  workspaceForgetRecent: "workspace:forget-recent",
  workspaceClearRecents: "workspace:clear-recents",
  filesOpenDialog: "fs:open-dialog",
  appInfo: "app:info",
  supportSubmitReport: "support:submit-report",
  dialogConfirmRequest: "dialog:confirm-request",
  dialogConfirmAnswer: "dialog:confirm-answer",
  dialogConfirmCancel: "dialog:confirm-cancel",
  debugRecord: "debug:record",
  debugReport: "debug:report",
  debugSummary: "debug:summary",
  debugCopy: "debug:copy",
  debugSave: "debug:save",
  activityReport: "activity:report",
  milestoneRecord: "milestone:record",
  referralsGet: "referrals:get",
  referralsClaim: "referrals:claim",
  referralsCheckClipboard: "referrals:check-clipboard",
  referralsSetShowName: "referrals:set-show-name",
  onboardingState: "onboarding:state",
  onboardingComplete: "onboarding:complete",
  pinPromptOffer: "pin:offer",
  pinPromptShown: "pin:shown",
  pinPromptSettle: "pin:settle",
  pinPromptPin: "pin:pin",
  updateStatus: "update:status",
  updateCheck: "update:check",
  updateInstall: "update:install",
  updateClaimNotice: "update:claim-notice",
  serviceNotice: "notice:show",
  releaseAnnouncement: "release:announcement",
  releaseMarkSeen: "release:mark-seen",
  releaseList: "release:list",
  licencesRead: "licences:read",
  accountStatus: "account:status",
  accountChanged: "account:changed",
  accountLink: "account:link",
  accountLinkEmail: "account:link-email",
  accountDeviceCode: "account:device-code",
  accountSignOut: "account:sign-out",
  accountCancelLink: "account:cancel-link",
  accountSignInInstead: "account:sign-in-instead",
  updateChanged: "update:changed",
  runtimeCheck: "runtime:check",
  runtimeOpenInstall: "runtime:open-install",
  keybindingsRead: "keybindings:read",
  keybindingsWrite: "keybindings:write",
  keybindingsReset: "keybindings:reset",
  keybindingsChanged: "keybindings:changed",
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
  /** A repository is there, but git refuses it until the folder is trusted (see `git.trust`). */
  readonly untrusted?: boolean;
  readonly isClean: boolean;
  readonly hasConflicts: boolean;
  readonly entries: ReadonlyArray<{
    readonly path: string;
    readonly staged: string;
    readonly worktree: string;
    readonly isConflicted: boolean;
    /** Uncommitted added lines, staged and worktree combined; null means New or binary. */
    readonly added: number | null;
    /** Uncommitted removed lines, staged and worktree combined; null means New or binary. */
    readonly removed: number | null;
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
  /** `identity`: git does not know who is committing - offer the name and email form. */
  readonly reason?: "identity";
}

/** Who git records commits as, and what to prefill when it cannot tell. */
export interface GitIdentityView {
  readonly name: string | null;
  readonly email: string | null;
  readonly complete: boolean;
  readonly suggestedName: string | null;
  readonly suggestedEmails: readonly string[];
  /** A key git ignores that was meant as `user.email` - `user.mail` is the usual slip. */
  readonly typo: { readonly key: string; readonly value: string } | null;
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
export type SidebarViewView =
  | "explorer"
  | "search"
  | "structure"
  | "scm"
  | "earnings"
  | "features"
  | "settings";

export interface LayoutView {
  readonly sidebarWidth: number;
  readonly panelHeight: number;
  readonly sidebarView?: SidebarViewView;
}

export interface SessionStateView {
  readonly root: string | null;
  readonly openFiles: readonly string[];
  readonly activeFile: string | null;
  /** Absent in sessions written before the layout was adjustable. */
  readonly layout?: LayoutView;
  /** Absent in sessions written before the working mode was restored. */
  readonly workspaceMode?: "vibe" | "code";
}

/**
 * What the main process found when asked whether a program is installed.
 *
 * `found: false` is the interesting case and is not an error - most people have not
 * installed a Rust toolchain, and saying so plainly is the whole feature. `label`, `url`
 * and `install` come from the main process's own copy of the runtime table, so the renderer
 * displays them rather than choosing them.
 */
export interface RuntimeCheckView {
  readonly id: string;
  readonly label: string;
  /** The executable that was looked for, as it appears on the command line. */
  readonly command: string;
  readonly found: boolean;
  /** The download page, chosen for this platform. Shown, never sent back. */
  readonly url: string;
  /** A one-line install command for this platform, or null when there is no good one. */
  readonly install: string | null;
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
export interface AiModelInfo {
  readonly id: string;
  readonly name: string;
  /** An agent needs tool calls; a model without them is a chat box. */
  readonly toolCall: boolean;
  readonly reasoning: boolean;
  /** The model this provider starts on. At most one per provider, and listed first. */
  readonly recommended?: boolean;
  /** Tokens it reads at once, where published. */
  readonly contextWindow?: number | null;
  /** USD per million tokens, where published. */
  readonly inputPrice?: number | null;
  readonly outputPrice?: number | null;
  /** Costs nothing per token (an OpenRouter `:free` model, or one on this computer). */
  readonly free?: boolean;
  /** The provider has a free tier that covers it (Google's Flash models). */
  readonly freeTier?: boolean;
  /** Released in the last 45 days. */
  readonly isNew?: boolean;
  readonly releaseDate?: string | null;
  /** Picked out in the admin panel. */
  readonly featured?: boolean;
  /** The admin panel's line about it ("Best for big builds"). */
  readonly note?: string;
}

/** What is true of Ollama on this computer right now - asked, never assumed. */
export interface LocalModelsView {
  readonly installed: boolean;
  readonly running: boolean;
  /** The models it has pulled, embeddings left out. */
  readonly models: readonly string[];
}

export interface AiProviderInfo {
  readonly id: string;
  readonly displayName: string;
  readonly models: readonly AiModelInfo[];
  /** False until the user supplies a key. The local option needs none. */
  readonly hasKey: boolean;
  readonly needsKey: boolean;
  /** For Ollama: whether it is installed, running, and which models it has. */
  readonly local?: LocalModelsView;
  /**
   * Whether this editor can talk to it, and how.
   *
   * `unsupported` means no address is known for it - the custom endpoint covers those, so
   * it is a statement about what has been checked rather than about what exists.
   */
  readonly transport: "native" | "openai-compatible" | "unsupported";
  /** Where to read about getting a key. */
  readonly doc: string | null;
}

export interface AiConnectionInfo {
 readonly id: string; readonly name: string; readonly baseUrl: string; readonly model: string; readonly rpm: number;
 readonly queued: number; readonly cooldownUntil: number; readonly nextStartAt: number;
}

/**
 * The three documents behind Help > Open Source Licences.
 *
 * Each is null when its file could not be read: a source checkout that has never been
 * packaged has no third-party file, and a damaged install may have none of them. The
 * window says which, rather than showing an empty pane - and what it says depends on
 * `packaged`, because "run the generator" is advice only for someone with the source.
 */
export interface LicenceDocuments {
  readonly licence: string | null;
  readonly notice: string | null;
  readonly thirdParty: string | null;
  /** `app.isPackaged`: an installed build, as opposed to a source checkout. */
  readonly packaged: boolean;
}

export interface AiStatus {
  readonly connections?: readonly AiConnectionInfo[];
  readonly providers: readonly AiProviderInfo[];
  readonly activeProvider: string;
  readonly activeModel: string;
  readonly ready: boolean;
  /** Set when Provider is Custom. */
  readonly customBaseUrl: string;
  /** The day the bundled catalogue was taken, for a list that may have aged. */
  readonly catalogueTakenOn: string;
  /** True once a live catalogue has replaced the bundled one this session. */
  readonly catalogueIsLive: boolean;
  /** Reasoning effort as chosen in Connect a model; absent means Auto. */
  readonly effort?: string;
}

export interface ChatMessageView {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly at: number;
}

export interface ChatSessionView {
  readonly id: string;
  readonly title: string;
  readonly renamed: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly messages: readonly ChatMessageView[];
  /** The latest compaction summary; it stands for the first `coversUntil` messages. */
  readonly summary?: { readonly text: string; readonly coversUntil: number; readonly at: number } | null;
}

/** How full the chat's context is. Token counts are estimates. */
export interface AiContextUsageView {
  readonly tokens: number;
  readonly contextWindow: number;
  /** The share of the context at which the conversation compacts. */
  readonly thresholdPercent: number;
  readonly autoCompact: boolean;
}

export interface AiCompactResultView {
  readonly ok: boolean;
  readonly message: string;
  readonly summary?: string;
}

/** What checking a key actually found out. */
export type AiKeyCheck =
  | { readonly ok: true; readonly detail: string }
  | { readonly ok: false; readonly message: string };

/** What quick connect did: switched to a working model, or left everything as it was. */
export type AiQuickConnectResult =
  | { readonly ok: true; readonly provider: string; readonly model: string; readonly status: AiStatus }
  | { readonly ok: false; readonly message: string };

/** A hunk of a proposed change, as rendered in the inline diff widget. */
export interface DiffHunkView {
  readonly id: string;
  readonly startLine: number;
  readonly original: readonly string[];
  readonly replacement: readonly string[];
}

/** A yes/no the main process asks through the window's own themed dialog (main/themedConfirm.ts). */
export interface ThemedConfirmRequest {
  readonly title: string;
  readonly body?: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly danger?: boolean;
}

/** One automatic-mode turn's edits, undoable from the chat. Paths are workspace-relative. */
export interface AiCheckpointView {
  readonly id: string;
  readonly createdAt: number;
  /** `deleted`: the turn deleted the file, or moved it away from this path. */
  readonly files: ReadonlyArray<{ readonly path: string; readonly created: boolean; readonly deleted?: boolean }>;
}

export interface AiUndoResultView {
  readonly ok: boolean;
  readonly restored: readonly string[];
  /** Files edited since the turn; nothing was changed when this is non-empty. */
  readonly conflicts: readonly string[];
  readonly message: string;
}

export interface ProposedEditView {
  readonly taskId: string;
  readonly relativePath: string;
  readonly path: string;
  readonly displayPath: string;
  readonly summary: string;
  readonly hunks: readonly DiffHunkView[];
}

export type AiWorkspaceTaskStateView =
  | "preparing"
  | "ready"
  | "running"
  | "paused"
  | "review"
  | "applying"
  | "applied"
  | "conflict"
  | "discarded"
  | "failed"
  | "rolling-back"
  | "rolled-back";

/** Renderer-safe task metadata. Absolute workspace and sandbox paths never cross IPC. */
export interface AiWorkspaceTaskView {
  readonly id: string;
  readonly prompt: string;
  readonly mode: "single" | "team";
  readonly reviewPolicy: "review" | "trusted";
  readonly state: AiWorkspaceTaskStateView;
  readonly sandboxKind: "git-worktree" | "shadow-copy" | null;
  readonly changedPaths: readonly string[];
  readonly usedTokens: number;
  /** Null means unlimited: this task never pauses for tokens. */
  readonly tokenLimit: number | null;
  readonly usedCostMicros: number;
  readonly costMicrosLimit: number;
  readonly checkpointPaths: readonly string[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface AiWorkspaceChangeView {
  readonly path: string;
  /** The file does not exist in the project until this change is applied. */
  readonly isNew: boolean;
  readonly hunks: readonly DiffHunkView[];
}

export interface AiWorkspaceTraceView {
  readonly id: string;
  readonly at: number;
  readonly kind: string;
  readonly summary: string;
  readonly detail: string;
  readonly outcome: "pending" | "ok" | "blocked" | "failed";
}

export interface AiWorkspaceApplySelectionView {
  readonly path: string;
  readonly acceptedHunkIds: readonly string[];
}

export interface AiWorkspaceActionView {
  readonly ok: boolean;
  readonly task: AiWorkspaceTaskView;
  readonly conflicts: readonly string[];
  readonly message: string;
}

export interface AiAutomationCreateInputView {
  readonly message: string;
  readonly targetId: string;
  readonly targetLabel: string;
  readonly dueAt: number;
}

/** Bounded, path-free context for one cancellable ghost-text request. */
/** Ctrl+E in the editor: rewrite the selection (or insert at the cursor) from one instruction. */
export interface AiInlineEditInputView {
  readonly instruction: string;
  readonly languageId: string;
  /** Workspace-relative display path, for the model's orientation only. */
  readonly path: string;
  readonly before: string;
  readonly selection: string;
  readonly after: string;
}

export type AiInlineEditResultView =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly error: string };

export interface AiCompletionInputView {
  readonly requestId: number;
  readonly languageId: string;
  readonly prefix: string;
  readonly suffix: string;
}

/**
 * One file attached to an assistant turn, as it crosses the IPC boundary.
 *
 * Images travel as base64 for the provider adapters; text documents travel as
 * text so the main process never has to read the user's disk for them. Filenames
 * ride along for labels and session markers - never paths, which would leak the
 * shape of the user's filesystem into logs and session files.
 */
/**
 * What the user is looking at when they send: the active file, where the cursor is, what is
 * selected, and which other files are open. Rides with one send; the main process folds it
 * into the per-turn host context so "this file" and "this function" mean something.
 * Paths are workspace-relative display paths, never absolute ones.
 */
export interface AiEditorContextView {
  readonly mode: "vibe" | "code";
  readonly activeFile: string | null;
  readonly languageId: string | null;
  readonly cursorLine: number | null;
  readonly selection: { readonly startLine: number; readonly endLine: number; readonly text: string } | null;
  readonly openFiles: readonly string[];
  /** Errors and warnings Monaco currently reports in the active file. */
  readonly problems: readonly string[];
}

export interface AiAttachmentView {
  readonly name: string;
  readonly kind: "image" | "text";
  readonly mediaType: string;
  readonly data: string;
}

export interface AiAutomationView extends AiAutomationCreateInputView {
  readonly id: string;
  readonly state: "pending" | "delivering" | "missed" | "delivered" | "cancelled";
  readonly attempts: number;
  readonly lastError: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface AiTeamRoleInputView {
 readonly route?: { readonly provider: string; readonly model: string };
  readonly id: string;
  readonly label: string;
  readonly objective: string;
  /** Which tools this agent may use; the main process filters to exactly these. Absent = all. */
  readonly toolAccess?: "all" | "read-only" | readonly string[];
}

export interface AiTeamNodeInputView {
  readonly id: string;
  readonly title: string;
  readonly objective: string;
  readonly roleId: string;
  readonly dependsOn: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  readonly fileHints: readonly string[];
}

export interface AiTeamConfigureInputView {
  /** A board run is one agent on one task ("solo"); a Team is two to four. Absent = Team. */
  readonly kind?: "team" | "solo";
  /** Race mode: solo runs on one task share a group (`race-…`) so they can be compared. */
  readonly group?: string;
  readonly prompt: string;
  readonly acceptanceCriteria: readonly string[];
  readonly roles: readonly AiTeamRoleInputView[];
  readonly nodes: readonly AiTeamNodeInputView[];
  readonly concurrency: number;
  readonly claims: readonly {
    readonly nodeId: string;
    readonly path: string;
    readonly scope: "file" | "directory";
    readonly exclusive?: boolean;
  }[];
  readonly tokenLimit: number;
  readonly costMicrosLimit: number;
}

export interface AiTeamSuggestionInputView {
  readonly prompt: string;
  readonly contextTokens: number;
  readonly fileHints: readonly string[];
}

export interface AiTeamSuggestionView {
  readonly dismissalKey: string;
  readonly reasons: readonly string[];
  readonly roles: readonly {
    readonly id: string;
    readonly label: string;
    readonly objective: string;
    readonly fileHints: readonly string[];
  }[];
  readonly estimatedSequentialMinutes: { readonly min: number; readonly max: number };
  readonly estimatedParallelMinutes: { readonly min: number; readonly max: number };
  readonly estimatedTokens: { readonly min: number; readonly max: number };
}

export type AiTeamStateView =
  | "configured"
  | "preparing"
  | "running"
  | "paused"
  | "merging"
  | "review"
  | "conflict"
  | "completed"
  | "failed"
  | "cancelled";

export interface AiTeamConflictView {
  readonly path: string;
  readonly reason: "different-base" | "overlapping-hunks";
  readonly proposals: readonly {
    readonly nodeId: string;
    readonly hunks: readonly DiffHunkView[];
  }[];
}

/** Renderer-safe parent summary. Workspace roots, child ids, and base revisions stay privileged. */
export interface AiTeamView {
  readonly id: string;
  readonly kind: "team" | "solo";
  /** The race this run belongs to, or null. */
  readonly group: string | null;
  /** Why a finished run was held for review instead of applied automatically, or null. */
  readonly hold: string | null;
  /** Project files this run has edited so far - for collision warnings between live runs. */
  readonly touchedPaths: readonly string[];
  readonly state: AiTeamStateView;
  readonly prompt: string;
  readonly acceptanceCriteria: readonly string[];
  readonly concurrency: number;
  readonly roles: readonly AiTeamRoleInputView[];
  readonly nodes: readonly (AiTeamNodeInputView & {
    readonly state: "pending" | "running" | "paused" | "completed" | "failed" | "blocked";
    readonly failure: string | null;
  })[];
  readonly handoffs: readonly {
    readonly nodeId: string;
    readonly summary: string;
    readonly changedPaths: readonly string[];
    readonly completedAt: number;
  }[];
  readonly routes: Readonly<Record<string, {
    readonly providerId: string;
    readonly modelId: string;
    readonly reason: string;
    readonly priceKnown: boolean;
    readonly blendedCostMicrosPerMillion: number | null;
  }>>;
  readonly budget: {
    readonly usedTokens: number;
    readonly tokenLimit: number;
    readonly reservedTokens: number;
    readonly usedCostMicros: number;
    readonly costMicrosLimit: number;
    readonly reservedCostMicros: number;
  };
  readonly merge: {
    readonly state: "idle" | "queued" | "merging" | "review" | "conflict" | "completed";
    readonly combinedTaskId: string | null;
    readonly conflicts: readonly AiTeamConflictView[];
  };
  readonly baseKind: "git-revision" | "shadow-base" | null;
  /** What each running node is doing right now, in plain words ("Editing src/app.ts"). */
  readonly activity: Readonly<Record<string, { readonly text: string; readonly at: number }>>;
  readonly confirmedAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface AiTeamTraceView {
  readonly id: string;
  readonly nodeId: string | null;
  /** Child workspaces belong to roles, which may execute more than one task node. */
  readonly roleId?: string;
  readonly at: number;
  readonly kind: string;
  readonly summary: string;
  readonly detail: string;
  readonly outcome: "pending" | "ok" | "blocked" | "failed";
}

/**
 * Everything a user needs to connect an external agent to the shared memory.
 *
 * §5.2 is blunt about why this is surfaced in the app rather than left to documentation:
 * "a user who has to figure out MCP configuration by themselves will not do it, and the
 * entire feature dies there."
 */
export interface McpConnectionInfo {
  /** The exact command to run, ready to paste - or, when `available` is false, why there is none. */
  readonly command: string;
  /** Where the memory lives on disk, so the user can go and look at it. */
  readonly storePath: string | null;
  /**
   * False when no folder is open, since the store is per-workspace, or when this copy of
   * ADCode has no server script for the command to point at.
   */
  readonly available: boolean;
  /** The `node` the command will run with, as far as ADCode can tell (`shared/mcpNode.ts`). */
  readonly node: McpNodeCheck;
}

/** One saved project memory, as the Tools page shows it. */
export interface MemoryItemView {
  readonly name: string;
  readonly description: string;
  readonly type: "decision" | "convention" | "preference" | "session";
  /** ISO date, `YYYY-MM-DD`. */
  readonly created: string;
  /** Which agents have written it ("adcode-chat", "you", or an external agent's name). */
  readonly agents: readonly string[];
  readonly body: string;
}

/** A memory written by hand. Session notes are the assistant's own log, so not writable here. */
export interface MemoryWriteInputView {
  readonly name: string;
  readonly description: string;
  readonly type: "decision" | "convention" | "preference";
  readonly body: string;
}

/** What `window.adcode` exposes. Nothing else crosses the boundary. */
/* ── Debugging ─────────────────────────────────────────────────────────────── */

export interface DebugFrameView {
  readonly id: string;
  readonly name: string;
  /** Absolute path, or null for a frame inside the runtime's own internals. */
  readonly path: string | null;
  readonly line: number;
  readonly column: number;
}

export type DebugStateView =
  | { readonly state: "idle" | "starting" | "running" }
  | {
      readonly state: "paused";
      readonly reason: "breakpoint" | "step" | "exception" | "entry" | "pause" | "other";
      readonly frames: readonly DebugFrameView[];
    }
  | { readonly state: "stopped"; readonly exitCode: number | null }
  /** Could not start, carrying something the user can act on. */
  | { readonly state: "failed"; readonly message: string };

/** What evaluating an expression in a paused frame produced. */
export interface DebugEvaluationView {
  readonly value: string;
  readonly type: string;
  /** True for a thrown exception or a refusal, so the console can style it as one. */
  readonly error: boolean;
}

export interface DebugScopeView {
  readonly name: string;
  readonly kind: string;
  readonly objectId: string | null;
}

export interface DebugVariableView {
  readonly name: string;
  /** Already rendered - the panel never formats a value itself. */
  readonly value: string;
  readonly type: string;
  readonly objectId?: string;
}

export interface BreakpointView {
  readonly path: string;
  readonly line: number;
}

/** Where a language server says a symbol is defined. */
export interface LanguageLocation {
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly endLine: number;
  readonly endColumn: number;
}

/** One edit a language server wants applied, in the editor's one-based coordinates. */
export interface LanguageTextEdit {
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly text: string;
}

export interface AdcodeApi {
  readonly workspace: {
    open(): Promise<OpenedWorkspace | null>;
    /** Open a known folder without a dialog - the recents list and the welcome screen. */
    openPath(root: string): Promise<OpenedWorkspace | null>;
    /**
     * Make an empty folder for a new project in Documents/ADCode Projects, named after the
     * idea, and open it. For people who arrive with an idea rather than a folder.
     */
    createProject(idea: string): Promise<OpenedWorkspace | null>;
    close(): Promise<void>;
    current(): Promise<OpenedWorkspace | null>;
    list(dirPath: string): Promise<DirEntry[]>;
    /** Folders opened before, newest first, with the ones that no longer exist removed. */
    recents(): Promise<readonly RecentFolderView[]>;
    forgetRecent(root: string): Promise<readonly RecentFolderView[]>;
    clearRecents(): Promise<void>;
    /** Fired by direct AI edits and commands. Paths are workspace-relative; empty means "rescan the root". */
    onFilesChanged(listener: (paths: readonly string[]) => void): () => void;
    onChanged(listener: (workspace: OpenedWorkspace | null) => void): () => void;
  };
  /** Version and runtime, for the welcome screen and the settings footer. */
  readonly app: {
    info(): Promise<AppInfo>;
  };
  readonly files: {
    read(filePath: string): Promise<FileContent>;
    /** Read an image file as a `data:` URL for preview. Throws when not an image. */
    readImage(filePath: string): Promise<FileImageContent>;
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
    /**
     * The clipboard's text, or an empty string.
     *
     * Exists because pasting into the terminal needs it and `navigator.clipboard.readText`
     * is refused in this renderer - reading the clipboard is gated behind a secure context
     * and a permission prompt that a custom protocol does not satisfy.
     */
    readText(): Promise<string>;
  };
  readonly terminal: {
    profiles(): Promise<TerminalProfile[]>;
    create(options: { profileId?: string; cwd?: string; cols: number; rows: number }): Promise<string>;
    write(id: string, data: string): void;
    resize(id: string, cols: number, rows: number): void;
    dispose(id: string): void;
    /**
     * Open a link clicked in the terminal, in the system browser.
     *
     * The terminal's links come out of the user's own shell output, so passing a URL here
     * is unavoidable - the main process answers by parsing it and opening only http and
     * https, which is as tight as a link the user clicked can be held to.
     */
    openLink(url: string): Promise<void>;
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
   * What is listening on this machine.
   *
   * Exists because "something is already using port 3000" is a wall beginners hit
   * constantly and have no tool for; until now the only answer ADCode could give was
   * whatever error the thing that failed to start happened to print.
   */
  readonly ports: {
    list(): Promise<ListeningPort[]>;
    /**
     * Stop whatever holds a port.
     *
     * Takes a pid rather than a port number so the renderer can only stop a process it
     * was actually shown, and the main process refuses its own pid regardless.
     */
    stop(pid: number): Promise<{ ok: boolean; error?: string }>;
    /**
     * Open a port in the real browser.
     *
     * Takes a port number, not a URL, for the same reason `preview.openExternal` takes
     * nothing: a renderer that can hand `shell.openExternal` an arbitrary string is a way
     * out of the sandbox dressed as a convenience. The main process builds a loopback URL
     * from the number and will not build anything else.
     */
    open(port: number): Promise<void>;
  };
  /**
   * Log channels, for the Output panel.
   *
   * `history` exists because the panel is usually opened *after* the thing worth reading
   * has already been printed - a language server that failed to start does not print it
   * again because somebody finally looked.
   */
  readonly output: {
    history(): Promise<OutputLine[]>;
    onAppend(listener: (line: OutputLine) => void): () => void;
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
    /**
     * Ask the language server to format a document.
     *
     * `null` means no server answered with edits, and the caller should fall back to the
     * built-in formatter. An empty array is a real answer: a server formatted the file and
     * found nothing to change.
     */
    formatting(
      path: string,
      languageId: string,
      options: { tabSize: number; insertSpaces: boolean },
    ): Promise<LanguageTextEdit[] | null>;
    /**
     * Where a symbol is defined, according to a language server.
     *
     * `null` means no server answered. The caller falls back to searching by name and the
     * UI says which of the two produced the answer.
     */
    definition(
      path: string,
      languageId: string,
      line: number,
      column: number,
    ): Promise<LanguageLocation[] | null>;
    states(): Promise<LanguageServerState[]>;
    onDiagnostics(listener: (file: string, diagnostics: LanguageDiagnostic[]) => void): () => void;
    onState(listener: (states: LanguageServerState[]) => void): () => void;
  };
  readonly memory: {
    connection(): Promise<McpConnectionInfo>;
    /** Every memory for the open project, newest first. Empty when no folder is open. */
    list(): Promise<readonly MemoryItemView[]>;
    /** Create or replace a memory by name. Null when the input is refused or no folder is open. */
    write(input: MemoryWriteInputView): Promise<MemoryItemView | null>;
    remove(name: string): Promise<boolean>;
  };
  readonly ai: {
    controls(): Promise<AssistantControlsView>;
    control(action: AssistantControlAction): Promise<AssistantControlsView>;
    previewSkill(id: string): Promise<string>;
    onControlsChanged(listener: () => void): () => void;
    status(): Promise<AiStatus>;
    setKey(provider: string, key: string): Promise<AiStatus>;
    clearKey(provider: string): Promise<AiStatus>;
    /**
     * Check a key by using it.
     *
     * One real request against the model that would actually be used. A key can be
     * well-formed and still refused - revoked, wrong account, no credit - and finding that
     * out when it is pasted is the point of the Connect screen.
     */
    checkKey(provider: string, key: string): Promise<AiKeyCheck>;
    /**
     * Check a key against a named model and, only if it answers, save it and switch to it.
     * `model` null picks the provider's first model with tool use. Ollama needs no key.
     */
    quickConnect(provider: string, key: string, model: string | null): Promise<AiQuickConnectResult>;
    /** Whether Ollama is running here, and the models it has. Never throws. */
    detectOllama(): Promise<{ running: boolean; models: string[] }>;
    /** Start an installed Ollama, wait for it to answer, and return the status that follows. */
    startOllama(): Promise<AiStatus>;
    /** Open AI Studio's key page, or Ollama's download page, in the system browser. */
    openKeyPage(intent: "gemini" | "ollama"): Promise<void>;
    /**
     * True when the turn reached a normal provider completion.
     *
     * Attachments ride with this turn only: images as multimodal parts, text
     * documents inlined as fenced context. History replays stay text-only.
     */
    send(text: string, attachments?: readonly AiAttachmentView[], editor?: AiEditorContextView | null): Promise<boolean>;
    complete(input: AiCompletionInputView): Promise<string | null>;
    cancelCompletion(requestId: number): void;
    /** One tool-free rewrite of an editor selection; the result lands in the buffer for review. */
    inlineEdit(input: AiInlineEditInputView): Promise<AiInlineEditResultView>;
    cancelInlineEdit(): void;
    cancel(): void;
    reset(): void;
    /** Summarise the older part of the conversation now, optionally with a focus. */
    compact(focus?: string): Promise<AiCompactResultView>;
    contextUsage(): Promise<AiContextUsageView>;
    /** Answer the next turn without file tools, once (see aiAnswerAnyway). */
    answerAnyway(): void;
    /** The agent's workings, live - this is what the trace widget renders (§5.3). */
    onEvent(listener: (event: unknown) => void): () => void;
    /** Review mode only: a staged edit is waiting. The turn's changes are offered for Apply when it ends. */
    onProposedEdit(listener: (edit: ProposedEditView) => void): () => void;
    /** A turn in "Apply automatically" mode changed files; `undoCheckpoint` puts them back. */
    onCheckpoint(listener: (checkpoint: AiCheckpointView) => void): () => void;
    undoCheckpoint(id: string, force: boolean): Promise<AiUndoResultView>;
  };
  readonly aiWorkspace: {
    list(): Promise<readonly AiWorkspaceTaskView[]>;
    current(): Promise<AiWorkspaceTaskView | null>;
    changes(taskId: string): Promise<readonly AiWorkspaceChangeView[]>;
    traces(taskId: string): Promise<readonly AiWorkspaceTraceView[]>;
    apply(
      taskId: string,
      selections: readonly AiWorkspaceApplySelectionView[],
    ): Promise<AiWorkspaceActionView>;
    discard(taskId: string): Promise<AiWorkspaceTaskView | null>;
    /** Delete a task completely. False when it is already gone. */
    remove(taskId: string): Promise<boolean>;
    rollback(taskId: string): Promise<AiWorkspaceActionView>;
    /**
     * A task in the open folder changed. Null means there is no task to show - the last
     * one was removed, or the change was to a task this window cannot act on.
     */
    onChanged(listener: (task: AiWorkspaceTaskView | null) => void): () => void;
  };
  readonly aiTeam: {
    suggest(input: AiTeamSuggestionInputView): Promise<AiTeamSuggestionView | null>;
    configure(input: AiTeamConfigureInputView): Promise<AiTeamView>;
    list(): Promise<readonly AiTeamView[]>;
    read(id: string): Promise<AiTeamView | null>;
    start(id: string): Promise<AiTeamView>;
    cancel(id: string): Promise<AiTeamView>;
    traces(id: string): Promise<readonly AiTeamTraceView[]>;
    onChanged(listener: (team: AiTeamView) => void): () => void;
  };
  readonly aiAutomation: {
    create(input: AiAutomationCreateInputView): Promise<AiAutomationView>;
    list(): Promise<readonly AiAutomationView[]>;
    claimDue(): Promise<AiAutomationView | null>;
    complete(id: string): Promise<AiAutomationView>;
    miss(id: string, reason: string): Promise<AiAutomationView>;
    retry(id: string, reason: string, dueAt: number): Promise<AiAutomationView>;
    cancel(id: string): Promise<AiAutomationView>;
    confirmMissed(id: string): Promise<AiAutomationView>;
    markDueMissed(): Promise<void>;
    onChanged(listener: (item: AiAutomationView) => void): () => void;
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
    /**
     * Let git use the open folder's repository when it refuses it for "dubious ownership"
     * (a FAT32 or exFAT drive, or a folder another account made). Adds the folder to
     * `safe.directory` in the global git config. Only ever on the user's explicit choice.
     */
    trust(): Promise<GitOutcome>;
    /** Who commits are recorded as: the open folder's repository, or the global config when none is open. */
    identity(): Promise<GitIdentityView>;
    /** Save the name and email commits are recorded under, for this project or every project. */
    setIdentity(name: string, email: string, scope: "local" | "global"): Promise<GitOutcome>;
    clone(url: string, target: string): Promise<GitOutcome>;
    /** Connect this repository to a remote, or correct the URL of one it already has. */
    addRemote(name: string, url: string): Promise<GitOutcome>;
    /** The remotes configured, so the panel can offer to add one when there are none. */
    remotes(): Promise<readonly { readonly name: string; readonly url: string }[]>;
    openGitHub(remote: string, destination: import("./githubRepository.ts").GitHubDestination): Promise<GitOutcome>;
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
  readonly keybindings: {
    /** `commandId` to chord, or to `null` where the user has cleared one. */
    read(): Promise<Record<string, string | null>>;
    write(command: string, chord: string | null): Promise<Record<string, string | null>>;
    /** One command, or - with no argument - every override. */
    reset(command?: string): Promise<Record<string, string | null>>;
    onChanged(listener: (overrides: Record<string, string | null>) => void): () => void;
  };
  readonly runtime: {
    /**
     * Is the program this command needs installed?
     *
     * `null` when ADCode has no entry for that command, which is the common case - it means
     * "nothing useful to say", and the run proceeds untouched. A command ADCode does not
     * know about must never be blocked on ADCode's ignorance of it.
     */
    check(command: string): Promise<RuntimeCheckView | null>;
    /**
     * Open the download page for a runtime, named by id.
     *
     * By id and not by URL. The main process looks the address up in its own table, so a
     * compromised renderer cannot turn this into `shell.openExternal(anything)` - the same
     * rule `preview:open-external` already follows.
     */
    openInstall(id: string): Promise<void>;
  };
  /**
   * Stopping a program in the middle and looking at it.
   *
   * Built on the runtime's own inspector, so nothing has to be installed for JavaScript or
   * TypeScript. A language with no debugger says so rather than offering a dead button.
   */
  readonly debug: {
    state(): Promise<DebugStateView>;
    start(path: string, languageId: string): Promise<void>;
    stop(): Promise<void>;
    resume(): Promise<void>;
    stepOver(): Promise<void>;
    stepInto(): Promise<void>;
    stepOut(): Promise<void>;
    pause(): Promise<void>;
    /** Returns every breakpoint, so the editor can redraw its gutter from one answer. */
    toggleBreakpoint(path: string, line: number): Promise<readonly BreakpointView[]>;
    breakpoints(): Promise<readonly BreakpointView[]>;
    scopes(frameId: string): Promise<readonly DebugScopeView[]>;
    properties(objectId: string): Promise<readonly DebugVariableView[]>;
    /**
     * Evaluate an expression where the program is stopped.
     *
     * Takes the frame explicitly rather than assuming the top one: the point of a call
     * stack is that you can look at a caller's variables, and a console that silently
     * evaluated somewhere other than the frame you selected would be lying.
     */
    evaluate(frameId: string, expression: string): Promise<DebugEvaluationView>;
    onState(listener: (state: DebugStateView) => void): () => void;
  };
  /**
   * Past conversations, kept per project and never uploaded.
   *
   * An assistant that forgets everything when the window closes is one people stop
   * explaining context to.
   */
  readonly chat: {
    sessions(): Promise<readonly ChatSessionView[]>;
    resume(id: string): Promise<ChatSessionView | null>;
    rename(id: string, title: string): Promise<readonly ChatSessionView[]>;
    remove(id: string): Promise<readonly ChatSessionView[]>;
    clear(): Promise<readonly ChatSessionView[]>;
    /** The conversation being added to, for the strip that says what is remembered. */
    current(): Promise<ChatSessionView | null>;
    onChanged(listener: (session: ChatSessionView) => void): () => void;
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
    onOpenIntent(listener: (state: SessionStateView) => void): () => void;
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
    /**
     * Open the full IDE in a separate OS window.
     *
     * The launcher stays in Vibe-first Agents view; the new window is the same
     * workspace with the editor first, so both stay live on one project.
     *
     * `view` is the IDE surface to reveal once the window is ready. Without it, Vibe's
     * "Search in files" would open the IDE on whatever it last showed and drop the request.
     */
    openIde(file?: string, view?: IdeView): Promise<void>;
    openVibe(): Promise<void>;
    ready(): void;
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
  readonly account: {
    status(): Promise<AccountState>;
    /** Never rejects; a failure comes back as `{ ok: false, message }`. */
    link(provider: "google" | "github"): Promise<LinkOutcome>;
    linkEmail(email: string, password: string): Promise<LinkOutcome>;
    /**
     * Forget this machine's account.
     *
     * Safe once the account is linked: signing back in with the same provider returns the
     * same UID and the balance with it. On an account that is still anonymous there is
     * nothing to sign back in *as*, so the earnings are gone - which is why the caller has
     * to confirm, and why `AccountState.linked` decides whether it is offered at all.
     */
    signOut(): Promise<AccountState>;
    /**
     * Answer "yes" to a `decide: "sign-in-instead"` outcome.
     *
     * Spends the credential that link held back, so it costs no second browser trip.
     * Fails with a message if too long has passed and the credential has been dropped.
     */
    signInInstead(): Promise<LinkOutcome>;
    /** Abandon a sign-in that is waiting on the browser. False when none was running. */
    cancelLink(): Promise<boolean>;
    onChanged(listener: (state: AccountState) => void): () => void;
    onDeviceCode(listener: (code: DeviceCode) => void): () => void;
  };
  readonly notices: {
    onShow(listener: (notices: readonly ServiceNotice[]) => void): () => void;
  };
  readonly releases: {
    /** Main pushes what it knows; the window decides whether now is a good moment. */
    onAnnouncement(listener: (announcement: ReleaseAnnouncement) => void): () => void;
    /** Remember these versions as shown, so they are never shown again on this machine. */
    markSeen(versions: readonly string[]): Promise<void>;
    /** Every note this build has, newest first - for the What's New window. */
    list(): Promise<ReleaseAnnouncement>;
  };
  readonly licences: {
    /** ADCode's licence, its notice, and the notices of what it bundles. */
    read(): Promise<LicenceDocuments>;
  };
  readonly updates: {
    status(): Promise<UpdateStatus>;
    check(): Promise<UpdateStatus>;
    onChanged(listener: (status: UpdateStatus) => void): () => void;
    /** Restart into a downloaded update. Does nothing, and resolves the status, unless it is `ready`. */
    install(): Promise<UpdateStatus>;
    /** True for the first window to ask about this ready version; false for every later ask. */
    claimNotice(version: string): Promise<boolean>;
  };
  readonly support: {
    /** Never rejects: a failure comes back as `{ ok: false, message }` to show the user. */
    submitReport(input: ReportInput): Promise<ReportResult>;
  };
  /**
   * The redacted debug log (main/debugLog.ts): recent errors from the assistant, the app
   * and its windows, with no keys, paths, prompts or file contents.
   */
  /** Questions from the main process, drawn in the app's themed dialog instead of a native box. */
  readonly dialogs: {
    onConfirmRequest(listener: (id: string, request: ThemedConfirmRequest) => void): () => void;
    onConfirmCancel(listener: (id: string) => void): () => void;
    answerConfirm(id: string, answer: boolean): void;
  };
  readonly debugLog: {
    /** Add a renderer-side event. Rate limited in main. */
    record(level: "error" | "warn" | "info", source: string, message: string): void;
    /** The whole log as text. */
    report(): Promise<string>;
    /** Environment plus recent problems, at most `maxChars` long, for the report form. */
    summary(maxChars: number): Promise<string>;
    copy(): Promise<boolean>;
    /** Ask where to save it; the path written, or null if cancelled. */
    save(): Promise<string | null>;
  };
  readonly onboarding: {
    /** True once this machine has been welcomed. False on a fresh install. */
    completed(): Promise<boolean>;
    /** Records that it has. Never rejects - a failed write costs one repeat, not a crash. */
    complete(): Promise<void>;
  };
  readonly pinPrompt: {
    /**
     * Whether to ask about pinning right now, and what to say. `{ ask: false }` on every
     * launch but the first and third, once the question is settled, and on any platform
     * with no dock worth naming.
     */
    offer(): Promise<PinPromptOffer>;
    /** The card is on screen. Recorded on display, so quitting with it up still counts. */
    shown(): void;
    /** They pinned it or asked not to be asked again. Either way, never ask again. */
    settle(): Promise<void>;
    /** Do it for real, where the desktop allows. Never rejects; reports why it could not. */
    pin(): Promise<PinResult>;
  };
  readonly activity: {
    /**
     * Hands the editing counters to the main process, which queues, batches, and sends
     * them. Fire and forget: this must never be able to block or fail the editor.
     */
    report(deltas: readonly ActivityDelta[]): void;
  };
  readonly milestones: {
    /**
     * Notes how far a first session got - a fixed word from `shared/milestones.ts`, nothing
     * else. Fire and forget; repeats within one launch are ignored.
     */
    record(name: MilestoneName): void;
  };
  readonly referrals: {
    /** Your invite: link, who joined, what it earned. Null when invites are unavailable. */
    get(): Promise<ReferralView | null>;
    /** Claim a code someone typed or pasted into the invite box. */
    claim(text: string): Promise<InviteClaimResult>;
    /**
     * Look once for an invite the invite page put on the clipboard, and claim it. The
     * clipboard is read in main and only an exact invite is ever sent; nothing comes back
     * here but whether it worked.
     */
    checkClipboard(): Promise<ClipboardInviteResult>;
    setShowName(show: boolean): Promise<ReferralView | null>;
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
    /**
     * Tell the main process what the editor currently looks like and holds open.
     *
     * Fire and forget, and coalesced by the caller: this rides on tab switches and theme
     * changes, and a round trip per keystroke-adjacent event is exactly the latency §9
     * forbids the ad path from adding.
     */
    reportSignals(signals: AdSignals): void;
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
