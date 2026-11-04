/**
 * The community hub's IPC shapes: the plugin directory, installed plugins, project
 * artifacts and improvements. Types only - importable from the sandboxed preload.
 */
import type {
  ArtifactDetail, ArtifactListing, ChangeKind, CommunityHome, CommunityMe, ImprovementDetail, ImprovementSummary,
  ListingSort, MonetizationStatus, PluginDetail, PluginListing, PluginManifest, RemixRecord,
} from "@adcode/community";

export type {
  ArtifactDetail, ArtifactListing, CommunityHome, CommunityMe, ImprovementDetail, ImprovementSummary, ListingSort,
  MonetizationStatus, PluginDetail, PluginListing, PluginManifest, RemixRecord,
};

export interface InstalledPluginView {
  readonly manifest: PluginManifest;
  readonly enabled: boolean;
  /** "directory" when installed from the public directory; "local" when tried from the Studio. */
  readonly source: "directory" | "local";
  readonly installedAt: number;
  /** A newer version in the directory, once an update check has seen one. */
  readonly update: string | null;
}

export interface ArtifactPreview {
  readonly root: string;
  readonly name: string;
  readonly files: number;
  readonly bytes: number;
  /** Why files were left out, with counts, so "where is my logo.png" has an answer. */
  readonly skipped: readonly { readonly reason: string; readonly count: number }[];
  /** Anything that blocks publishing (a key in a file, too many files). */
  readonly problems: readonly string[];
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
}

export interface CommunityApi {
  home(): Promise<CommunityHome>;
  plugins(sort: ListingSort, query: string, category: string | null): Promise<readonly PluginListing[]>;
  plugin(id: string): Promise<PluginDetail>;
  artifacts(sort: ListingSort, query: string, helpOnly: boolean): Promise<readonly ArtifactListing[]>;
  artifact(id: string): Promise<ArtifactDetail>;
  me(): Promise<CommunityMe>;
  markRead(): Promise<void>;

  installed(): Promise<readonly InstalledPluginView[]>;
  install(id: string): Promise<readonly InstalledPluginView[]>;
  /** Try a Studio draft without publishing it. */
  installLocal(manifest: string): Promise<readonly InstalledPluginView[]>;
  uninstall(id: string): Promise<readonly InstalledPluginView[]>;
  setEnabled(id: string, enabled: boolean): Promise<readonly InstalledPluginView[]>;
  checkUpdates(): Promise<readonly InstalledPluginView[]>;
  publishPlugin(manifest: string, notes: string): Promise<PluginDetail>;
  removePlugin(id: string): Promise<void>;
  /** The open project's `adcode-plugin.json`, or null. Lets the assistant write a plugin you then load. */
  readProjectManifest(): Promise<string | null>;
  writeProjectManifest(manifest: string): Promise<string>;

  star(kind: "plugin" | "artifact", id: string, on: boolean): Promise<{ readonly stars: number; readonly starred: boolean }>;
  report(kind: "plugin" | "artifact", id: string, reason: string): Promise<void>;

  previewArtifact(): Promise<ArtifactPreview>;
  publishArtifact(input: PublishArtifactInput): Promise<ArtifactDetail>;
  removeArtifact(id: string): Promise<void>;
  /** Download the latest version into a new folder; resolves to that folder. */
  remix(id: string): Promise<string>;
  projectLink(): Promise<ProjectLinkView>;
  sendImprovement(title: string, message: string): Promise<ImprovementSummary>;
  improvement(id: string): Promise<ImprovementDetail>;
  decide(id: string, accept: boolean, reply: string, force: boolean): Promise<ImprovementDetail>;
  /** Bring the open, linked project up to the artifact's latest version. */
  pullLatest(): Promise<PullResult>;

  waitlist(join: boolean, price: number | null, note: string): Promise<MonetizationStatus>;
  onPluginsChanged(listener: (installed: readonly InstalledPluginView[]) => void): () => void;
}
