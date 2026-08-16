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
} as const;

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
    current(): Promise<OpenedWorkspace | null>;
    list(dirPath: string): Promise<DirEntry[]>;
  };
  readonly files: {
    read(filePath: string): Promise<FileContent>;
    write(filePath: string, text: string): Promise<SaveResult>;
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
