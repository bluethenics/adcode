/**
 * What the community service sends and receives. One set of shapes for the Worker that
 * stores them, the desktop app that shows them and the website that lists them.
 */
import type { ArtifactChange, ArtifactFile } from "./artifact.ts";
import type { PluginCategory, PluginManifest } from "./plugin.ts";

export type ListingSort = "trending" | "new" | "top";

export interface PluginListing {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly icon: string;
  readonly category: PluginCategory;
  readonly tags: readonly string[];
  readonly version: string;
  readonly ownerId: string;
  readonly ownerName: string;
  readonly installs: number;
  readonly installsWeek: number;
  readonly stars: number;
  /** "2 AI actions · 1 skill" */
  readonly contributes: string;
  readonly remixOf: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly featured: boolean;
}

export interface PluginVersionNote {
  readonly version: string;
  readonly notes: string;
  readonly at: number;
}

export interface PluginDetail extends PluginListing {
  readonly manifest: PluginManifest;
  readonly versions: readonly PluginVersionNote[];
  readonly starred: boolean;
  readonly installed: boolean;
  readonly remixes: number;
}

export interface ArtifactListing {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly tags: readonly string[];
  /** What the owner would like help with - the board people browse to find something to do. */
  readonly helpWanted: string;
  readonly ownerId: string;
  readonly ownerName: string;
  readonly version: number;
  readonly fileCount: number;
  readonly bytes: number;
  readonly remixes: number;
  readonly stars: number;
  readonly improvements: number;
  readonly contributors: number;
  readonly openImprovements: number;
  readonly remixOf: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface ArtifactVersionNote {
  readonly version: number;
  readonly message: string;
  readonly authorId: string;
  readonly authorName: string;
  readonly at: number;
}

export interface ArtifactDetail extends ArtifactListing {
  readonly paths: readonly string[];
  /** The README, when there is one, so the page can show what the project is. */
  readonly readme: string;
  readonly versions: readonly ArtifactVersionNote[];
  readonly contributorNames: readonly string[];
  readonly starred: boolean;
}

export interface ArtifactSnapshot {
  readonly id: string;
  readonly title: string;
  readonly version: number;
  readonly files: readonly ArtifactFile[];
}

export type ImprovementStatus = "open" | "accepted" | "declined";

export interface ImprovementSummary {
  readonly id: string;
  readonly artifactId: string;
  readonly artifactTitle: string;
  readonly baseVersion: number;
  readonly authorId: string;
  readonly authorName: string;
  readonly title: string;
  readonly message: string;
  readonly status: ImprovementStatus;
  readonly reply: string;
  readonly files: number;
  readonly at: number;
  readonly decidedAt: number;
  /** The version it became, once accepted. */
  readonly mergedVersion: number | null;
}

export interface ImprovementDetail extends ImprovementSummary {
  readonly changes: readonly ArtifactChange[];
  /** Paths that no longer apply cleanly to the latest version. */
  readonly conflicts: readonly string[];
}

export type ActivityKind =
  | "plugin.installed" | "plugin.starred" | "plugin.remixed" | "plugin.updated"
  | "artifact.remixed" | "artifact.starred" | "improvement.received" | "improvement.accepted" | "improvement.declined"
  | "badge.earned" | "featured";

export interface ActivityItem {
  readonly id: number;
  readonly kind: ActivityKind;
  readonly text: string;
  readonly targetKind: "plugin" | "artifact" | "improvement" | "profile";
  readonly targetId: string;
  readonly at: number;
  readonly read: boolean;
}

export interface CreatorTotals {
  readonly plugins: number;
  readonly artifacts: number;
  readonly installs: number;
  readonly stars: number;
  readonly remixes: number;
  /** Improvements of yours that other people accepted. */
  readonly acceptedImprovements: number;
  /** Days in a row with something published, remixed or improved. */
  readonly streakDays: number;
}

export interface CreatorProfile {
  readonly uid: string;
  readonly name: string;
  readonly totals: CreatorTotals;
  readonly points: number;
  readonly level: { readonly name: string; readonly index: number; readonly next: string | null; readonly toNext: number; readonly progress: number };
  readonly badges: readonly { readonly id: string; readonly name: string; readonly detail: string; readonly earned: boolean }[];
}

export interface MonetizationStatus {
  readonly joined: boolean;
  readonly price: number | null;
  readonly position: number | null;
  readonly waiting: number;
}

export interface CommunityHome {
  readonly signedIn: boolean;
  readonly featured: readonly PluginListing[];
  readonly trendingPlugins: readonly PluginListing[];
  readonly trendingArtifacts: readonly ArtifactListing[];
  readonly helpWanted: readonly ArtifactListing[];
  readonly totals: { readonly plugins: number; readonly artifacts: number; readonly creators: number; readonly installs: number };
}

export interface CommunityMe {
  readonly profile: CreatorProfile;
  readonly plugins: readonly PluginListing[];
  readonly artifacts: readonly ArtifactListing[];
  readonly inbox: readonly ImprovementSummary[];
  readonly sent: readonly ImprovementSummary[];
  readonly activity: readonly ActivityItem[];
  readonly unread: number;
  readonly monetization: MonetizationStatus;
}

export interface PublishPluginRequest {
  readonly manifest: unknown;
  readonly notes: string;
  readonly ownerName: string;
}

export interface PublishArtifactRequest {
  /** Present to publish a new version of an artifact you own. */
  readonly id?: string;
  readonly title: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly helpWanted: string;
  readonly message: string;
  readonly files: readonly ArtifactFile[];
  readonly ownerName: string;
  readonly remixOf?: string | null;
}

export interface SendImprovementRequest {
  readonly baseVersion: number;
  readonly title: string;
  readonly message: string;
  readonly changes: readonly ArtifactChange[];
  readonly authorName: string;
}
