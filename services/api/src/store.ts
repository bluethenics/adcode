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

export interface CampaignRecord {
  campaignId: string;
  advertiserId: string;
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
  servedAt: number;
  expiresAt: number;
}

export interface ReceiptRecord {
  receiptId: string;
  uid: string;
  creativeId: string;
  outcome: string;
  creditedMicros: bigint;
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

  putCampaign(campaign: CampaignRecord): Promise<void>;
  activeCampaignsFor(tags: readonly string[]): Promise<CampaignRecord[]>;

  putCreative(creative: CreativeRecord): Promise<void>;
  getCreative(creativeId: string): Promise<CreativeRecord | null>;
  creativesForCampaign(campaignId: string): Promise<CreativeRecord[]>;

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

  createReport(report: ReportRecord): Promise<void>;
  listReports(page: Page): Promise<ReportPage>;

  getConfig(): Promise<ServingConfig>;
  putConfig(config: ServingConfig): Promise<void>;

  writeAudit(record: AuditRecord): Promise<void>;
  listAudit(): Promise<AuditRecord[]>;
}
