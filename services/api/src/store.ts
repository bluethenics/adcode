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
}

/** What an advertiser sees for one campaign. Counts, not identities. */
export interface CampaignStats {
  campaignId: string;
  serves: number;
  impressions: number;
  clicks: number;
  spentMicros: bigint;
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

  getConfig(): Promise<ServingConfig>;
  putConfig(config: ServingConfig): Promise<void>;

  writeAudit(record: AuditRecord): Promise<void>;
  listAudit(): Promise<AuditRecord[]>;
}
