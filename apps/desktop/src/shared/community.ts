/**
 * The community hub's IPC shapes: the plugin directory, installed plugins, project
 * artifacts and improvements. Types only - importable from the sandboxed preload.
 */
import type {
  ArtifactDetail, ArtifactListing, ArtifactVisibility, ChangeKind, CommunityHome, CommunityMe, ImprovementDetail,
  ImprovementSummary, ListingSort, MonetizationStatus, PluginDetail, PluginListing, PluginManifest, RemixRecord,
} from "@adcode/community";
import type { ArtifactRoomCard, ArtifactRoomSnapshot } from "@adcode/collab";

export type {
  ArtifactDetail, ArtifactListing, ArtifactRoomCard, ArtifactRoomSnapshot, ArtifactVisibility, CommunityHome, CommunityMe,
  ImprovementDetail, ImprovementSummary, ListingSort, MonetizationStatus, PluginDetail, PluginListing, PluginManifest,
  RemixRecord,
};

export interface ArtifactShareView {
  readonly visibility: ArtifactVisibility;
  readonly shareCode: string;
}

export interface ArtifactRoomActionView {
  readonly action: string;
  readonly [key: string]: unknown;
}

export interface InstalledPluginView {
  readonly manifest: PluginManifest;
  readonly enabled: boolean;
  /** "directory" from the public directory, "starter" made by ADCode, "local" tried from the Studio. */
  readonly source: "directory" | "local" | "starter";
  readonly installedAt: number;
  /** A newer version in the directory, once an update check has seen one (never while kept at a version). */
  readonly update: string | null;
  /** The plugin's own settings, as the person set them. */
  readonly options: Readonly<Record<string, boolean | number | string>>;
  /** Kept at this version on purpose: no updates are offered. */
  readonly pinned: boolean;
}

/** Progress of a download or install, for the animated bars. `total` 0: length not known yet. */
export interface CommunityProgressView {
  readonly key: string;
  readonly phase: "download" | "install" | "write" | "done" | "failed";
  readonly done: number;
  readonly total: number;
}

export interface ArtifactPreview {
  readonly root: string;
  readonly name: string;
  readonly files: number;
  readonly bytes: number;
  /** Why files were left out, with counts, so "where is my logo.png" has an answer. */
  readonly skipped: readonly { readonly reason: string; readonly count: number }[];
  /** Anything that blocks publishing apart from keys: not a project, too many files, too large. */
  readonly problems: readonly string[];
  /** "not-a-project": nothing here can be shared; "too-large": trim it first; null: it can go. */
  readonly blocked: "not-a-project" | "too-large" | null;
  /** Files that look like they hold a key or password - one entry per file. */
  readonly secrets: readonly { readonly path: string; readonly line: number; readonly kind: string }[];
  readonly link: RemixRecord | null;
  readonly readme: string | null;
}

export interface LocalChangeView {
  readonly path: string;
  readonly kind: ChangeKind;
  readonly added: number;
  readonly removed: number;
}

/** The open project's relationship to an artifact, and what changed in it locally. */
export interface ProjectLinkView {
  readonly root: string | null;
  readonly link: RemixRecord | null;
  readonly changes: readonly LocalChangeView[];
  /** The artifact's latest version, or null when the service could not be reached. */
  readonly latestVersion: number | null;
}

export interface PullResult {
  readonly version: number;
  readonly applied: number;
  readonly conflicts: readonly string[];
}

export interface PublishArtifactInput {
  readonly title: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly helpWanted: string;
  readonly message: string;
  /** Files to leave out of this share, such as the ones flagged as holding a key. */
  readonly exclude: readonly string[];
  readonly visibility: ArtifactVisibility;
}

export interface CommunityApi {
  home(): Promise<CommunityHome>;
  plugins(sort: ListingSort, query: string, category: string | null): Promise<readonly PluginListing[]>;
  plugin(id: string): Promise<PluginDetail>;
  artifacts(sort: ListingSort, query: string, helpOnly: boolean): Promise<readonly ArtifactListing[]>;
  artifact(id: string, key?: string | null): Promise<ArtifactDetail>;
  /** Open an `adartifact:` code, including a private artifact it belongs to. */
  openSharedArtifact(code: string): Promise<ArtifactDetail>;
  shareArtifact(id: string): Promise<ArtifactShareView>;
  setArtifactVisibility(id: string, visibility: ArtifactVisibility): Promise<ArtifactDetail>;
  rotateArtifactShare(id: string): Promise<{ readonly shareCode: string }>;
  me(): Promise<CommunityMe>;
  markRead(): Promise<void>;

  installed(): Promise<readonly InstalledPluginView[]>;
  /** Install the latest version, or `version`; `keep` holds it there (no updates offered). */
  install(id: string, version?: string | null, keep?: boolean): Promise<readonly InstalledPluginView[]>;
  setOptions(id: string, values: Readonly<Record<string, unknown>>): Promise<readonly InstalledPluginView[]>;
  setPinned(id: string, pinned: boolean): Promise<readonly InstalledPluginView[]>;
  onProgress(listener: (progress: CommunityProgressView) => void): () => void;
  /** Try a Studio draft without publishing it. */
  installLocal(manifest: string): Promise<readonly InstalledPluginView[]>;
  uninstall(id: string): Promise<readonly InstalledPluginView[]>;
  setEnabled(id: string, enabled: boolean): Promise<readonly InstalledPluginView[]>;
  checkUpdates(): Promise<readonly InstalledPluginView[]>;
  /** The plugins ADCode ships, ready to install without an account. */
  starters(): Promise<readonly PluginManifest[]>;
  installStarter(id: string): Promise<readonly InstalledPluginView[]>;
  publishPlugin(manifest: string, notes: string): Promise<PluginDetail>;
  removePlugin(id: string): Promise<void>;
  /** The open project's `adcode-plugin.json`, or null. Lets the assistant write a plugin you then load. */
  readProjectManifest(): Promise<string | null>;
  writeProjectManifest(manifest: string): Promise<string>;

  star(kind: "plugin" | "artifact", id: string, on: boolean): Promise<{ readonly stars: number; readonly starred: boolean }>;
  report(kind: "plugin" | "artifact", id: string, reason: string): Promise<void>;

  previewArtifact(exclude?: readonly string[]): Promise<ArtifactPreview>;
  publishArtifact(input: PublishArtifactInput): Promise<ArtifactDetail>;
  removeArtifact(id: string): Promise<void>;
  /** Download the latest version into a new folder; resolves to that folder. */
  remix(id: string, key?: string | null): Promise<string>;
  projectLink(): Promise<ProjectLinkView>;
  sendImprovement(title: string, message: string): Promise<ImprovementSummary>;
  improvement(id: string): Promise<ImprovementDetail>;
  decide(id: string, accept: boolean, reply: string, force: boolean): Promise<ImprovementDetail>;
  /** Bring the open, linked project up to the artifact's latest version. */
  pullLatest(): Promise<PullResult>;

  /** Live rooms across ADCode, for Mission Control: the present, not the git history. */
  liveRooms(): Promise<readonly ArtifactRoomCard[]>;
  /** The live coordination room around an artifact: people, agents, plan, Brain, comments. */
  artifactRoom(id: string, key?: string | null): Promise<ArtifactRoomSnapshot>;
  openArtifactRoom(id: string, name: string, liveInvite: string | null, branch?: string | null, task?: string | null): Promise<ArtifactRoomSnapshot>;
  joinArtifactRoom(id: string, key: string | null, name: string, watching: boolean, hasAgent?: boolean | null, pushAccess?: boolean | null): Promise<ArtifactRoomSnapshot>;
  artifactRoomAction(id: string, key: string | null, action: ArtifactRoomActionView): Promise<ArtifactRoomSnapshot>;
  leaveArtifactRoom(id: string): Promise<ArtifactRoomSnapshot>;
  closeArtifactRoom(id: string): Promise<ArtifactRoomSnapshot>;
  setArtifactRoomLive(id: string, invite: string | null): Promise<ArtifactRoomSnapshot>;

  waitlist(join: boolean, price: number | null, note: string): Promise<MonetizationStatus>;
  onPluginsChanged(listener: (installed: readonly InstalledPluginView[]) => void): () => void;
}
