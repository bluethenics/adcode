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
} as const;

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
}
