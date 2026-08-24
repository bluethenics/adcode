/**
 * The persistence port.
 *
 * Spec D2: every persistence operation goes through this interface, following ad-core
 * decision #3 - which put Firebase auth behind an injected transport so it could be built
 * and tested with no Firebase project in existence. The same trick makes this whole slice
 * buildable before a GCP account exists, and keeps CI free of cloud credentials forever.
 *
 * Implementations: `memoryStore.ts` for tests, `adapters/firestoreStore.ts` for production.
 */
import type { Balance, LedgerEntry } from "./ledger.ts";

export interface Clock {
  now(): number;
}

export interface IdGen {
  next(prefix: string): string;
}

export type UserStatus = "active" | "banned";

export interface UserRecord {
  uid: string;
  status: UserStatus;
  createdAt: number;
  linkedAt?: number;
}

export interface AdvertiserRecord {
  advertiserId: string;
  name: string;
  ownerUids: string[];
  status: "active" | "suspended";
  /** Money paid in, via Dodo. Only ever increased by a settled payment. */
  fundedMicros: bigint;
  /** Committed to active campaign budgets, so two campaigns cannot spend the same dollar. */
  reservedMicros: bigint;
  createdAt: number;
}

export interface CampaignRecord {
  campaignId: string;
  advertiserId: string;
  name: string;
  createdAt: number;
  cpmMicros: bigint;
  budgetMicros: bigint;
  targetTags: string[];
  status: "active" | "paused" | "ended";
}

export interface CreativeRecord {
  creativeId: string;
  campaignId: string;
  advertiser: string;
  headline: string;
  body: string | null;
  clickUrl: string;
  logoLight: string;
  logoDark: string;
  status: "approved" | "pending" | "rejected";
}

export interface ServeRecord {
  serveId: string;
  uid: string;
  creativeId: string;
  campaignId: string;
  servedAt: number;
  expiresAt: number;
  /**
   * An admin test serve. Its receipt is acknowledged and recorded but never bills the
   * advertiser or credits the user - testing delivery must not move anyone's money.
   */
  test?: boolean;
}

export interface ReceiptRecord {
  receiptId: string;
  uid: string;
  creativeId: string;
  campaignId: string;
  outcome: string;
  creditedMicros: bigint;
  /** What the advertiser was charged. The user's credit is a share of this. */
  costMicros: bigint;
  /** When it was verified. Without this every advertiser figure is a lifetime total. */
  createdAt: number;
}

/** What an advertiser sees for one campaign. Counts, not identities. */
export interface CampaignStats {
  campaignId: string;
  serves: number;
  impressions: number;
  clicks: number;
  spentMicros: bigint;
}

/**
 * One campaign's numbers for one UTC day.
 *
 * The unit both advertiser charts are built from: summed across campaigns it is the
 * account-wide line, kept split it is the per-campaign one.
 */
export interface SeriesPoint {
  day: string;
  campaignId: string;
  impressions: number;
  clicks: number;
  spentMicros: bigint;
}

/**
 * A day of editing, as the desktop app saw it.
 *
 * Counts only. Nothing here can reconstruct a keystroke, a filename or a line of code -
 * the same rule the ad tags follow, for the same reason.
 */
export interface ActivityDay {
  day: string;
  manualChars: number;
  agentChars: number;
  acceptedEdits: number;
  rejectedEdits: number;
  filesTouched: number;
  activeMs: number;
  sessions: number;
}

/**
 * One flush from an editor window: what happened since the last one.
 *
 * Deltas, not totals. A second window, a crash, or a reinstall all break the assumption
 * that a client knows its own running total, and a client that under-reports a total
 * would move the number backwards. Deltas only ever add.
 */
export interface ActivityDelta extends ActivityDay {
  uid: string;
  at: number;
}

export interface ServingConfig {
  killSwitch: boolean;
  caps: { minIntervalMs?: number; dailyCap?: number };
  defaultCpmMicros: bigint;
  revSharePercent: bigint;
  spendShardCount: number;
  serveTtlMs: number;
  /** Length of a rate-limit window. */
  rateWindowMs: number;
  /** Requests allowed per UID per window. Zero means unlimited. */
  requestsPerWindow: number;
}

export interface Page {
  limit: number;
  cursor: string | null;
}

export interface EntryPage {
  rows: LedgerEntry[];
  nextCursor: string | null;
}

/**
 * One settled advertiser payment.
 *
 * Keyed by the provider's webhook event id, which is what makes crediting idempotent:
 * payment providers retry, and a retry that credits twice is money invented.
 */
export interface FundingRecord {
  eventId: string;
  paymentId: string;
  advertiserId: string;
  amountMicros: bigint;
  currency: string;
  at: number;
}

/**
 * A message from the operators to everyone running the editor.
 *
 * Exists because `packages/ads` is required to fail silently: when serving breaks, the
 * client shows nothing at all, which is right for a transient blip and wrong for an
 * outage people are already wondering about. This is the deliberate, human-written
 * exception - never automatic error spam.
 */
export interface NoticeRecord {
  noticeId: string;
  severity: "info" | "warning";
  title: string;
  body: string;
  /** False retracts it without deleting the record, so the history stays. */
  active: boolean;
  authorUid: string;
  createdAt: number;
}

/** A blog post. Authored in the admin panel, rendered by the marketing site. */
/**
 * Where a written page appears.
 *
 * One record rather than two collections, because the difference between a blog post and
 * a documentation page is presentation, not substance: the same words about how targeting
 * works are an essay in one place and a reference in the other. Splitting them would mean
 * writing them twice and letting the two copies drift.
 */
export type PostSurface = "blog" | "docs" | "both";

export interface PostRecord {
  slug: string;
  title: string;
  description: string;
  body: string;
  status: "draft" | "published";
  /** Blog, docs, or both. Older records with no value are blog posts. */
  surface: PostSurface;
  /** The docs sidebar group this belongs under. Ignored for blog-only posts. */
  section: string;
  /** Position within its docs section. Ties break on title. */
  order: number;
  /** Slugs of related pages, for the "see also" list. */
  related: string[];
  authorUid: string;
  publishedAt: number | null;
  updatedAt: number;
}

/**
 * A release, as announced to people already running the editor.
 *
 * Separate from a blog post because it answers a different question - "what changed in the
 * version I just got" - and because the desktop client decides whether to interrupt anybody
 * based on fields a post does not have.
 */
export interface ReleaseRecord {
  /** Semver, and the key. One record per version, ever. */
  version: string;
  title: string;
  /** Markdown, as the blog uses. */
  body: string;
  /** The two or three lines worth reading, for the popup that has room for little else. */
  highlights: string[];
  /**
   * Whether this release is worth interrupting anybody about.
   *
   * False installs silently. Most releases should be false: a popup for every patch is how
   * a release note becomes something people close without reading.
   */
  announce: boolean;
  /** Bypasses the quiet-moment rules, and nothing else. Never the once-per-version rule. */
  critical: boolean;
  status: "draft" | "published";
  /** `agent` when a tool drafted it. Shown in the admin list so a human knows to read it. */
  authoredBy: "human" | "agent";
  authorUid: string;
  publishedAt: number | null;
  updatedAt: number;
}

export interface UserPage {
  rows: UserRecord[];
  nextCursor: string | null;
}

export interface ReportRecord {
  reportId: string;
  uid: string;
  kind: string;
  title: string;
  body: string;
  appVersion: string;
  platform: string;
  status: "open" | "triaged" | "closed";
  createdAt: number;
}

export interface ReportPage {
  rows: ReportRecord[];
  nextCursor: string | null;
}

export interface AuditRecord {
  adminUid: string;
  action: string;
  subjectUid: string;
  at: number;
}

/**
 * An administrator, identified by email address.
 *
 * Email rather than uid because that is what the person doing the appointing knows, and
 * because someone can be made an admin before they have ever signed in - which a uid
 * cannot express. Always stored lowercased; `authenticate()` lowercases before comparing,
 * so a mixed-case row would simply never match anything.
 */
export interface AdminRecord {
  email: string;
  /** The uid that granted it, or `setup` for the founding administrator. */
  addedBy: string;
  addedAt: number;
}

export interface Store {
  getUser(uid: string): Promise<UserRecord | null>;
  putUser(user: UserRecord): Promise<void>;

  putAdvertiser(advertiser: AdvertiserRecord): Promise<void>;
  getAdvertiser(advertiserId: string): Promise<AdvertiserRecord | null>;
  advertiserForOwner(uid: string): Promise<AdvertiserRecord | null>;

  putCampaign(campaign: CampaignRecord): Promise<void>;
  getCampaign(campaignId: string): Promise<CampaignRecord | null>;
  campaignsForAdvertiser(advertiserId: string): Promise<CampaignRecord[]>;
  activeCampaignsFor(tags: readonly string[]): Promise<CampaignRecord[]>;
  statsForCampaign(campaignId: string): Promise<CampaignStats>;

  putCreative(creative: CreativeRecord): Promise<void>;
  getCreative(creativeId: string): Promise<CreativeRecord | null>;
  /** Approved only - this is the serving path. */
  creativesForCampaign(campaignId: string): Promise<CreativeRecord[]>;
  /** Every status, for the advertiser's own view of what they submitted. */
  allCreativesForCampaign(campaignId: string): Promise<CreativeRecord[]>;

  recordServe(serve: ServeRecord): Promise<void>;
  findServe(uid: string, creativeId: string, now: number): Promise<ServeRecord | null>;

  /** True when created, false when the id already existed. This is the idempotency gate. */
  createReceiptIfAbsent(receipt: ReceiptRecord): Promise<boolean>;

  /** Per-campaign, per-day rollup for one advertiser, from `since` (ms) to now. */
  seriesForAdvertiser(advertiserId: string, since: number): Promise<SeriesPoint[]>;

  /** Adds one flush's deltas to its day. Concurrent flushes must both count. */
  addActivity(delta: ActivityDelta): Promise<void>;
  /** Newest day first, from `sinceDay` ('YYYY-MM-DD') inclusive. */
  activityForUser(uid: string, sinceDay: string): Promise<ActivityDay[]>;

  /** Appends and updates the derived balance atomically. Throws if the entry id exists. */
  appendEntryAndUpdateBalance(entry: LedgerEntry): Promise<void>;
  getBalance(uid: string): Promise<Balance>;
  listEntries(uid: string, page: Page): Promise<EntryPage>;

  addSpend(campaignId: string, micros: bigint): Promise<void>;
  getSpend(campaignId: string): Promise<bigint>;

  /** Increments this UID's counter for the window and returns the new count. */
  bumpRequestCount(uid: string, windowStart: number): Promise<number>;

  /** True when created, false when this event was already processed. The idempotency gate. */
  recordFundingIfAbsent(funding: FundingRecord): Promise<boolean>;
  listFunding(advertiserId: string): Promise<FundingRecord[]>;

  createReport(report: ReportRecord): Promise<void>;
  listReports(page: Page): Promise<ReportPage>;

  listUsers(page: Page): Promise<UserPage>;
  listAdvertisers(): Promise<AdvertiserRecord[]>;

  putNotice(notice: NoticeRecord): Promise<void>;
  getNotice(noticeId: string): Promise<NoticeRecord | null>;
  /** Active only when `activeOnly`; the admin view wants retracted ones too. */
  listNotices(options: { activeOnly: boolean }): Promise<NoticeRecord[]>;
  creativesByStatus(status: CreativeRecord["status"]): Promise<CreativeRecord[]>;

  putPost(post: PostRecord): Promise<void>;
  getPost(slug: string): Promise<PostRecord | null>;
  listPosts(options: { publishedOnly: boolean }): Promise<PostRecord[]>;

  putRelease(release: ReleaseRecord): Promise<void>;
  getRelease(version: string): Promise<ReleaseRecord | null>;
  /** Newest first. Published only when `publishedOnly`; the admin view wants drafts too. */
  listReleases(options: { publishedOnly: boolean }): Promise<ReleaseRecord[]>;

  /** Queues one creative to be served to this uid on their next request, ignoring targeting. */
  setTestServe(uid: string, creativeId: string): Promise<void>;
  /** Returns and clears any queued test serve. Single-use, so a test cannot repeat forever. */
  takeTestServe(uid: string): Promise<string | null>;

  getConfig(): Promise<ServingConfig>;
  putConfig(config: ServingConfig): Promise<void>;

  writeAudit(record: AuditRecord): Promise<void>;
  listAudit(): Promise<AuditRecord[]>;

  /** Is this address an administrator? Called on every request, so it must be one lookup. */
  isAdmin(email: string): Promise<boolean>;
  listAdmins(): Promise<AdminRecord[]>;
  /** True when added, false when the address was already an admin. */
  addAdmin(record: AdminRecord): Promise<boolean>;
  /** True when removed, false when the address was not an admin. */
  removeAdmin(email: string): Promise<boolean>;
  /** Used to refuse the removal that would leave nobody able to administer anything. */
  countAdmins(): Promise<number>;
}
