/**
 * The translation layer between Postgres rows and domain records.
 *
 * Split out of `supabaseStore.ts` on purpose: a bug in an adapter is nearly always a
 * translation bug, and translation is the one part that can be tested exhaustively with
 * no database, no network and no dependency installed. `supabaseStore.ts` is then just
 * queries, which the conformance suite covers.
 *
 * **Why every money column arrives as a string.** Postgres holds micros as `bigint`.
 * PostgREST serialises that into JSON as a bare number, and `JSON.parse` turns anything
 * above 2^53 into the nearest representable double - silently, with no error. 2^53 micros
 * is about nine billion units of currency, which is the kind of "that will never happen"
 * that eventually happens to a running total. So every `*_micros` column is selected with
 * an explicit `::text` cast (see the `*_COLS` constants) and parsed with `BigInt` here.
 *
 * Epoch-millisecond columns are also `bigint` in Postgres but are deliberately *not*
 * cast: they sit around 1.8e12, an order of magnitude below the danger line, and reading
 * them as numbers keeps them the `number` the domain model uses.
 */
import type { LedgerEntry } from "../src/ledger.ts";
import type {
  ActivityDay,
  AdvertiserRecord,
  AdminRecord,
  AuditRecord,
  CampaignRecord,
  CreativeRecord,
  FundingRecord,
  NoticeRecord,
  PostRecord,
  ReceiptRecord,
  ReleaseRecord,
  ReportRecord,
  ServeRecord,
  ServingConfig,
  UserRecord,
} from "../src/store.ts";

/**
 * Parse a money column.
 *
 * Accepts the string the `::text` cast produces. A number is accepted too, because a
 * missed cast should fail loudly at the first value that cannot be represented rather
 * than quietly returning a wrong balance - `BigInt(1.5)` throws, and an integer-valued
 * double converts exactly.
 */
export function toMicros(value: string | number | null | undefined): bigint {
  if (value === null || value === undefined) return 0n;
  return BigInt(value);
}

/** Money goes back as a string; PostgREST accepts it for a `bigint` column. */
export function fromMicros(value: bigint): string {
  return value.toString();
}

// ---------------------------------------------------------------------------
// Row shapes, exactly as PostgREST returns them under the `*_COLS` selections.
// ---------------------------------------------------------------------------

export interface UserRow {
  uid: string;
  status: string;
  created_at: number;
  linked_at: number | null;
}

export interface AdvertiserRow {
  advertiser_id: string;
  name: string;
  owner_uids: string[];
  status: string;
  funded_micros: string;
  reserved_micros: string;
  created_at: number;
}

export interface CampaignRow {
  campaign_id: string;
  advertiser_id: string;
  name: string;
  created_at: number;
  cpm_micros: string;
  budget_micros: string;
  target_tags: string[];
  status: string;
}

export interface CreativeRow {
  creative_id: string;
  campaign_id: string;
  advertiser: string;
  headline: string;
  body: string | null;
  click_url: string;
  logo_light: string;
  logo_dark: string;
  status: string;
}

export interface ServeRow {
  serve_id: string;
  uid: string;
  creative_id: string;
  campaign_id: string;
  served_at: number;
  expires_at: number;
  test: boolean;
}

export interface ReceiptRow {
  receipt_id: string;
  uid: string;
  creative_id: string;
  campaign_id: string;
  outcome: string;
  credited_micros: string;
  cost_micros: string;
  created_at: number;
}

export interface ActivityRow {
  uid: string;
  day: string;
  manual_chars: string;
  agent_chars: string;
  accepted_edits: number;
  rejected_edits: number;
  files_touched: number;
  active_ms: string;
  sessions: number;
  updated_at: number;
}

export interface LedgerRow {
  entry_id: string;
  uid: string;
  kind: string;
  micros: string;
  ref_id: string | null;
  created_at: number;
  description: string;
  reason: string | null;
  admin_uid: string | null;
  provider_ref: string | null;
  currency: string | null;
}

export interface BalanceRow {
  uid: string;
  available_micros: string;
  lifetime_micros: string;
  pending_withdrawal_micros: string;
}

export interface FundingRow {
  event_id: string;
  payment_id: string;
  advertiser_id: string;
  amount_micros: string;
  currency: string;
  at: number;
}

export interface ReportRow {
  report_id: string;
  uid: string;
  kind: string;
  title: string;
  body: string;
  app_version: string;
  platform: string;
  status: string;
  created_at: number;
}

export interface NoticeRow {
  notice_id: string;
  severity: string;
  title: string;
  body: string;
  active: boolean;
  author_uid: string;
  created_at: number;
}

export interface PostRow {
  slug: string;
  title: string;
  description: string;
  body: string;
  status: string;
  surface: string;
  section: string;
  order_index: number;
  related: string[];
  author_uid: string;
  published_at: number | null;
  updated_at: number;
}

export interface ReleaseRow {
  version: string;
  title: string;
  body: string;
  highlights: string[];
  announce: boolean;
  critical: boolean;
  status: string;
  authored_by: string;
  author_uid: string;
  published_at: number | null;
  updated_at: number;
}

export interface ConfigRow {
  kill_switch: boolean;
  min_interval_ms: number | null;
  daily_cap: number | null;
  default_cpm_micros: string;
  rev_share_percent: string;
  spend_shard_count: number;
  serve_ttl_ms: number;
  rate_window_ms: number;
  requests_per_window: number;
}

export interface AuditRow {
  admin_uid: string;
  action: string;
  subject_uid: string;
  at: number;
}

// ---------------------------------------------------------------------------
// Column selections.
//
// Written out rather than using `*` for one reason that matters: the `::text` casts on
// the money columns. A `select("*")` would return those as JSON numbers and lose
// precision. Listing the columns also means a schema change surfaces as a missing field
// here rather than as an undefined deep inside a handler.
// ---------------------------------------------------------------------------

export const USER_COLS = "uid,status,created_at,linked_at";
export const ADVERTISER_COLS =
  "advertiser_id,name,owner_uids,status,funded_micros::text,reserved_micros::text,created_at";
export const CAMPAIGN_COLS =
  "campaign_id,advertiser_id,name,created_at,cpm_micros::text,budget_micros::text,target_tags,status";
export const CREATIVE_COLS =
  "creative_id,campaign_id,advertiser,headline,body,click_url,logo_light,logo_dark,status";
export const SERVE_COLS = "serve_id,uid,creative_id,campaign_id,served_at,expires_at,test";
export const LEDGER_COLS =
  "entry_id,uid,kind,micros::text,ref_id,created_at,description,reason,admin_uid,provider_ref,currency";
export const BALANCE_COLS =
  "uid,available_micros::text,lifetime_micros::text,pending_withdrawal_micros::text";
export const FUNDING_COLS =
  "event_id,payment_id,advertiser_id,amount_micros::text,currency,at";
export const REPORT_COLS =
  "report_id,uid,kind,title,body,app_version,platform,status,created_at";
export const NOTICE_COLS = "notice_id,severity,title,body,active,author_uid,created_at";
export const POST_COLS =
  "slug,title,description,body,status,surface,section,order_index,related,author_uid,published_at,updated_at";
export const RELEASE_COLS =
  "version,title,body,highlights,announce,critical,status,authored_by,author_uid,published_at,updated_at";
export const CONFIG_COLS =
  "kill_switch,min_interval_ms,daily_cap,default_cpm_micros::text,rev_share_percent::text,spend_shard_count,serve_ttl_ms,rate_window_ms,requests_per_window";
export const AUDIT_COLS = "admin_uid,action,subject_uid,at";

export const ADMIN_COLS = "email,added_by,added_at";
export const ACTIVITY_COLS =
  "uid,day,manual_chars::text,agent_chars::text,accepted_edits,rejected_edits,files_touched,active_ms::text,sessions,updated_at";

// ---------------------------------------------------------------------------
// Row to record.
//
// `exactOptionalPropertyTypes` is on in this repo, so an optional field cannot be set to
// `undefined` - it has to be absent. That is why these use a conditional spread rather
// than the shorter `linkedAt: row.linked_at ?? undefined`, which does not compile.
// ---------------------------------------------------------------------------

export function toUser(row: UserRow): UserRecord {
  return {
    uid: row.uid,
    status: row.status === "banned" ? "banned" : "active",
    createdAt: row.created_at,
    ...(row.linked_at !== null ? { linkedAt: row.linked_at } : {}),
  };
}

export function fromUser(user: UserRecord): UserRow {
  return {
    uid: user.uid,
    status: user.status,
    created_at: user.createdAt,
    linked_at: user.linkedAt ?? null,
  };
}

export function toAdvertiser(row: AdvertiserRow): AdvertiserRecord {
  return {
    advertiserId: row.advertiser_id,
    name: row.name,
    ownerUids: row.owner_uids,
    status: row.status === "suspended" ? "suspended" : "active",
    fundedMicros: toMicros(row.funded_micros),
    reservedMicros: toMicros(row.reserved_micros),
    createdAt: row.created_at,
  };
}

export function fromAdvertiser(a: AdvertiserRecord): AdvertiserRow {
  return {
    advertiser_id: a.advertiserId,
    name: a.name,
    owner_uids: a.ownerUids,
    status: a.status,
    funded_micros: fromMicros(a.fundedMicros),
    reserved_micros: fromMicros(a.reservedMicros),
    created_at: a.createdAt,
  };
}

const CAMPAIGN_STATUSES = new Set(["active", "paused", "ended"]);

export function toCampaign(row: CampaignRow): CampaignRecord {
  return {
    campaignId: row.campaign_id,
    advertiserId: row.advertiser_id,
    name: row.name,
    createdAt: row.created_at,
    cpmMicros: toMicros(row.cpm_micros),
    budgetMicros: toMicros(row.budget_micros),
    targetTags: row.target_tags,
    status: CAMPAIGN_STATUSES.has(row.status)
      ? (row.status as CampaignRecord["status"])
      : "ended",
  };
}

export function fromCampaign(c: CampaignRecord): CampaignRow {
  return {
    campaign_id: c.campaignId,
    advertiser_id: c.advertiserId,
    name: c.name,
    created_at: c.createdAt,
    cpm_micros: fromMicros(c.cpmMicros),
    budget_micros: fromMicros(c.budgetMicros),
    target_tags: c.targetTags,
    status: c.status,
  };
}

const CREATIVE_STATUSES = new Set(["approved", "pending", "rejected"]);

export function toCreative(row: CreativeRow): CreativeRecord {
  return {
    creativeId: row.creative_id,
    campaignId: row.campaign_id,
    advertiser: row.advertiser,
    headline: row.headline,
    body: row.body,
    clickUrl: row.click_url,
    logoLight: row.logo_light,
    logoDark: row.logo_dark,
    status: CREATIVE_STATUSES.has(row.status)
      ? (row.status as CreativeRecord["status"])
      : "pending",
  };
}

export function fromCreative(c: CreativeRecord): CreativeRow {
  return {
    creative_id: c.creativeId,
    campaign_id: c.campaignId,
    advertiser: c.advertiser,
    headline: c.headline,
    body: c.body,
    click_url: c.clickUrl,
    logo_light: c.logoLight,
    logo_dark: c.logoDark,
    status: c.status,
  };
}

export function toServe(row: ServeRow): ServeRecord {
  return {
    serveId: row.serve_id,
    uid: row.uid,
    creativeId: row.creative_id,
    campaignId: row.campaign_id,
    servedAt: row.served_at,
    expiresAt: row.expires_at,
    ...(row.test ? { test: true } : {}),
  };
}

export function fromServe(s: ServeRecord): ServeRow {
  return {
    serve_id: s.serveId,
    uid: s.uid,
    creative_id: s.creativeId,
    campaign_id: s.campaignId,
    served_at: s.servedAt,
    expires_at: s.expiresAt,
    test: s.test === true,
  };
}

export function toReceipt(row: ReceiptRow): ReceiptRecord {
  return {
    receiptId: row.receipt_id,
    uid: row.uid,
    creativeId: row.creative_id,
    campaignId: row.campaign_id,
    outcome: row.outcome,
    creditedMicros: toMicros(row.credited_micros),
    costMicros: toMicros(row.cost_micros),
    createdAt: row.created_at,
  };
}

/**
 * An activity row to a day.
 *
 * The counters are `bigint` columns selected as text, like every other `bigint` here -
 * but unlike money they are small enough to be numbers in the record, because a character
 * count that reached 2^53 would mean nine petabytes of typing. `Number` is applied after
 * the text arrives, so the truncation the text cast exists to prevent cannot happen on
 * the wire either way.
 */
export function toActivity(row: ActivityRow): ActivityDay {
  return {
    day: row.day,
    manualChars: Number(row.manual_chars),
    agentChars: Number(row.agent_chars),
    acceptedEdits: row.accepted_edits,
    rejectedEdits: row.rejected_edits,
    filesTouched: row.files_touched,
    activeMs: Number(row.active_ms),
    sessions: row.sessions,
  };
}

const LEDGER_KINDS = new Set([
  "impression",
  "click",
  "reversal",
  "adjustment",
  "withdrawal_requested",
  "withdrawal_paid",
  "withdrawal_failed",
]);

export function toEntry(row: LedgerRow): LedgerEntry {
  return {
    entryId: row.entry_id,
    uid: row.uid,
    kind: LEDGER_KINDS.has(row.kind) ? (row.kind as LedgerEntry["kind"]) : "adjustment",
    micros: toMicros(row.micros),
    refId: row.ref_id,
    createdAt: row.created_at,
    description: row.description,
    ...(row.reason !== null ? { reason: row.reason } : {}),
    ...(row.admin_uid !== null ? { adminUid: row.admin_uid } : {}),
    ...(row.provider_ref !== null ? { providerRef: row.provider_ref } : {}),
    ...(row.currency !== null ? { currency: row.currency } : {}),
  };
}

export function toFunding(row: FundingRow): FundingRecord {
  return {
    eventId: row.event_id,
    paymentId: row.payment_id,
    advertiserId: row.advertiser_id,
    amountMicros: toMicros(row.amount_micros),
    currency: row.currency,
    at: row.at,
  };
}

export function fromFunding(f: FundingRecord): FundingRow {
  return {
    event_id: f.eventId,
    payment_id: f.paymentId,
    advertiser_id: f.advertiserId,
    amount_micros: fromMicros(f.amountMicros),
    currency: f.currency,
    at: f.at,
  };
}

const REPORT_STATUSES = new Set(["open", "triaged", "closed"]);

export function toReport(row: ReportRow): ReportRecord {
  return {
    reportId: row.report_id,
    uid: row.uid,
    kind: row.kind,
    title: row.title,
    body: row.body,
    appVersion: row.app_version,
    platform: row.platform,
    status: REPORT_STATUSES.has(row.status)
      ? (row.status as ReportRecord["status"])
      : "open",
    createdAt: row.created_at,
  };
}

export function fromReport(r: ReportRecord): ReportRow {
  return {
    report_id: r.reportId,
    uid: r.uid,
    kind: r.kind,
    title: r.title,
    body: r.body,
    app_version: r.appVersion,
    platform: r.platform,
    status: r.status,
    created_at: r.createdAt,
  };
}

export function toNotice(row: NoticeRow): NoticeRecord {
  return {
    noticeId: row.notice_id,
    severity: row.severity === "warning" ? "warning" : "info",
    title: row.title,
    body: row.body,
    active: row.active,
    authorUid: row.author_uid,
    createdAt: row.created_at,
  };
}

export function fromNotice(n: NoticeRecord): NoticeRow {
  return {
    notice_id: n.noticeId,
    severity: n.severity,
    title: n.title,
    body: n.body,
    active: n.active,
    author_uid: n.authorUid,
    created_at: n.createdAt,
  };
}

const SURFACES = new Set(["blog", "docs", "both"]);

export function toPost(row: PostRow): PostRecord {
  return {
    slug: row.slug,
    title: row.title,
    description: row.description,
    body: row.body,
    status: row.status === "published" ? "published" : "draft",
    surface: SURFACES.has(row.surface) ? (row.surface as PostRecord["surface"]) : "blog",
    section: row.section,
    order: row.order_index,
    related: row.related,
    authorUid: row.author_uid,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
  };
}

export function fromPost(p: PostRecord): PostRow {
  return {
    slug: p.slug,
    title: p.title,
    description: p.description,
    body: p.body,
    status: p.status,
    surface: p.surface,
    section: p.section,
    order_index: p.order,
    related: p.related,
    author_uid: p.authorUid,
    published_at: p.publishedAt,
    updated_at: p.updatedAt,
  };
}

export function toRelease(row: ReleaseRow): ReleaseRecord {
  return {
    version: row.version,
    title: row.title,
    body: row.body,
    highlights: row.highlights,
    announce: row.announce,
    critical: row.critical,
    status: row.status === "published" ? "published" : "draft",
    authoredBy: row.authored_by === "agent" ? "agent" : "human",
    authorUid: row.author_uid,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
  };
}

export function fromRelease(r: ReleaseRecord): ReleaseRow {
  return {
    version: r.version,
    title: r.title,
    body: r.body,
    highlights: r.highlights,
    announce: r.announce,
    critical: r.critical,
    status: r.status,
    authored_by: r.authoredBy,
    author_uid: r.authorUid,
    published_at: r.publishedAt,
    updated_at: r.updatedAt,
  };
}

export function toConfig(row: ConfigRow): ServingConfig {
  return {
    killSwitch: row.kill_switch,
    caps: {
      ...(row.min_interval_ms !== null ? { minIntervalMs: row.min_interval_ms } : {}),
      ...(row.daily_cap !== null ? { dailyCap: row.daily_cap } : {}),
    },
    defaultCpmMicros: toMicros(row.default_cpm_micros),
    revSharePercent: toMicros(row.rev_share_percent),
    spendShardCount: row.spend_shard_count,
    serveTtlMs: row.serve_ttl_ms,
    rateWindowMs: row.rate_window_ms,
    requestsPerWindow: row.requests_per_window,
  };
}

export function fromConfig(config: ServingConfig): ConfigRow & { id: number } {
  return {
    id: 1,
    kill_switch: config.killSwitch,
    min_interval_ms: config.caps.minIntervalMs ?? null,
    daily_cap: config.caps.dailyCap ?? null,
    default_cpm_micros: fromMicros(config.defaultCpmMicros),
    rev_share_percent: fromMicros(config.revSharePercent),
    spend_shard_count: config.spendShardCount,
    serve_ttl_ms: config.serveTtlMs,
    rate_window_ms: config.rateWindowMs,
    requests_per_window: config.requestsPerWindow,
  };
}

export function toAudit(row: AuditRow): AuditRecord {
  return {
    adminUid: row.admin_uid,
    action: row.action,
    subjectUid: row.subject_uid,
    at: row.at,
  };
}

export function fromAudit(a: AuditRecord): AuditRow {
  return {
    admin_uid: a.adminUid,
    action: a.action,
    subject_uid: a.subjectUid,
    at: a.at,
  };
}

export interface AdminRow {
  email: string;
  added_by: string;
  added_at: number;
}

export function toAdmin(row: AdminRow): AdminRecord {
  return {
    email: row.email,
    addedBy: row.added_by,
    addedAt: row.added_at,
  };
}

export function fromAdmin(a: AdminRecord): AdminRow {
  return {
    // Lowercased on the way in as well as on the way out. The column has a check
    // constraint saying the same thing, so a miss here is a write error, not a silent
    // row nothing will ever match.
    email: a.email.toLowerCase(),
    added_by: a.addedBy,
    added_at: a.addedAt,
  };
}
