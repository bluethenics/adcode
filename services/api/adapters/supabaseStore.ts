/**
 * The `Store` port against Supabase Postgres.
 *
 * This is the only file in the service that knows Supabase exists. Everything above it is
 * tested against `memoryStore.ts`, so a bug here is a translation or a query bug - and the
 * translation half lives in `supabaseRows.ts`, which is tested on its own with no database
 * at all. What is left here is queries.
 *
 * **Reads go through PostgREST, not a Postgres connection.** The service runs on
 * Cloudflare's runtime, which has no TCP socket a Postgres driver could use. PostgREST is
 * plain HTTPS and works identically in Node for the test suite.
 *
 * **Writes that must be atomic go through a database function.** PostgREST cannot express
 * a transaction, and five operations here are not safe as read-then-write: appending a
 * ledger entry, creating a receipt, recording a funding event, adding spend, and bumping a
 * rate-limit counter. Each is a `.rpc(...)` call into a function defined in
 * `supabase/migrations/20260824000000_init.sql`, whose body is one transaction. The
 * balance *arithmetic* stays in `ledger.ts` - this file computes the deltas with the same
 * `applyEntry` every other caller uses and the function only applies them.
 *
 * **Money is selected as text.** See the header of `supabaseRows.ts`: PostgREST emits
 * `bigint` as a JSON number and `JSON.parse` truncates above 2^53. Every `*_micros` read
 * in this file goes through a `*_COLS` constant that casts it, and there are no ad-hoc
 * `select("*")` calls for exactly that reason.
 */
import { applyEntry, EMPTY_BALANCE, type Balance, type LedgerEntry } from "../src/ledger.ts";
import {
  decryptDestination,
  encryptDestination,
  maskDestination,
  type EncryptedDestination,
} from "../src/payoutCrypto.ts";
import {
  ACTIVITY_COLS,
  ADVERTISER_COLS,
  ADMIN_COLS,
  AUDIT_COLS,
  BALANCE_COLS,
  CAMPAIGN_COLS,
  CONFIG_COLS,
  CREATIVE_COLS,
  FUNDING_COLS,
  CREDIT_ORDER_COLS,
  LEDGER_COLS,
  NOTICE_COLS,
  POST_COLS,
  RELEASE_COLS,
  REPORT_COLS,
  SERVE_COLS,
  USER_COLS,
  fromAdvertiser,
  fromAdmin,
  fromAudit,
  fromCampaign,
  fromConfig,
  fromCreative,
  fromFunding,
  fromCreditOrder,
  fromMicros,
  fromNotice,
  fromPost,
  fromRelease,
  fromPayoutProfile,
  fromReport,
  fromServe,
  fromUser,
  toActivity,
  toAdvertiser,
  toAdmin,
  toAudit,
  toCampaign,
  toConfig,
  toCreative,
  toEntry,
  toFunding,
  toCreditOrder,
  toMicros,
  toNotice,
  toPost,
  toRelease,
  toPayoutProfile,
  toReport,
  toServe,
  toUser,
  type ActivityRow,
  type AdvertiserRow,
  type AdminRow,
  type AuditRow,
  type BalanceRow,
  type CampaignRow,
  type ConfigRow,
  type CreativeRow,
  type FundingRow,
  type CreditOrderRow,
  type LedgerRow,
  type NoticeRow,
  type PostRow,
  type ReleaseRow,
  toWithdrawal,
  fromWithdrawal,
  PAYOUT_PROFILE_COLS,
  WITHDRAWAL_COLS,
  type PayoutProfileRow,
  type ReportRow,
  type WithdrawalRow,
  type ServeRow,
  type UserRow,
} from "./supabaseRows.ts";
import type {
  ActivityDay,
  CampaignStats,
  EntryPage,
  SeriesPoint,
  Page,
  ReportPage,
  WithdrawalPage,
  ServingConfig,
  Store,
  PayoutDestination,
  PayoutProfileRecord,
  WithdrawalRecord,
  UserPage,
} from "../src/store.ts";

/**
 * Where creative artwork lives.
 *
 * A private bucket: the bytes are handed out by the service's own `/assets/:key` route, so
 * the client only ever talks to one hostname and the bucket needs no public policy.
 */
const ASSET_BUCKET = "creative-assets";

type SupabaseClient = import("@supabase/supabase-js").SupabaseClient;

/** Postgres' unique_violation. The one error code this adapter reacts to by name. */
const UNIQUE_VIOLATION = "23505";

/**
 * The shape every supabase-js call resolves to.
 *
 * Declared locally rather than imported because the client is deliberately untyped here -
 * there are no generated `Database` types to keep in step with the migration, and a
 * hand-written duplicate of the schema would be a second thing to forget to update.
 */
interface Response {
  data: unknown;
  error: { message: string; code?: string } | null;
}

export interface SupabaseStoreOptions {
  /** `https://<ref>.supabase.co`. Falls back to `SUPABASE_URL`. */
  url?: string;
  /**
   * The service_role key. Falls back to `SUPABASE_SERVICE_ROLE_KEY`.
   *
   * This key bypasses Row Level Security, which is the entire reason the schema has no
   * policies. It must never reach a browser bundle, an artifact, or a log line.
   */
  serviceRoleKey?: string;
  /** For tests: an already-constructed client. */
  client?: SupabaseClient;
  /** Base64-encoded 32-byte AES key. Falls back to `PAYOUT_ENCRYPTION_KEY`. */
  payoutEncryptionKey?: string;
}

function fail(context: string, error: { message: string }): never {
  throw new Error(`supabase ${context}: ${error.message}`);
}

export function createSupabaseStore(options: SupabaseStoreOptions = {}): Store {
  let client: SupabaseClient | undefined = options.client;

  const payoutKey = (): string => {
    const key = options.payoutEncryptionKey ?? process.env["PAYOUT_ENCRYPTION_KEY"];
    if (key === undefined || key === "") {
      throw new Error("PAYOUT_ENCRYPTION_KEY is required for payout data");
    }
    return key;
  };

  const encryptedFromRow = (row: {
    destination_version?: number | null;
    destination_nonce?: string | null;
    destination_ciphertext?: string | null;
    destination_tag?: string | null;
  }): PayoutDestination | null => {
    payoutKey();
    if (
      row.destination_version !== 1 ||
      typeof row.destination_nonce !== "string" ||
      typeof row.destination_ciphertext !== "string" ||
      typeof row.destination_tag !== "string"
    ) return null;
    const encrypted: EncryptedDestination = {
      version: 1,
      nonce: row.destination_nonce,
      ciphertext: row.destination_ciphertext,
      tag: row.destination_tag,
    };
    return decryptDestination(payoutKey(), encrypted);
  };

  const encryptedColumns = (destination: PayoutDestination): Record<string, unknown> => {
    const encrypted = encryptDestination(payoutKey(), destination);
    return {
      method: "bank",
      legal_name: "Encrypted payout destination",
      country: destination.country,
      currency: destination.currency,
      email: null,
      bank_details: null,
      destination_version: encrypted.version,
      destination_nonce: encrypted.nonce,
      destination_ciphertext: encrypted.ciphertext,
      destination_tag: encrypted.tag,
      destination_mask: JSON.stringify(maskDestination(destination)),
    };
  };

  const payoutProfileFromRow = (row: PayoutProfileRow): PayoutProfileRecord => {
    const destination = encryptedFromRow(row) ?? toPayoutProfile(row);
    return { uid: row.uid, ...destination, updatedAt: row.updated_at };
  };

  const withdrawalFromRow = (row: WithdrawalRow): WithdrawalRecord => {
    const legacy = toWithdrawal(row);
    return { ...legacy, destination: encryptedFromRow(row) ?? legacy.destination };
  };

  const lazy = async (): Promise<SupabaseClient> => {
    if (client !== undefined) return client;

    const url = options.url ?? process.env["SUPABASE_URL"];
    const key = options.serviceRoleKey ?? process.env["SUPABASE_SERVICE_ROLE_KEY"];
    if (url === undefined || url === "" || key === undefined || key === "") {
      throw new Error(
        "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to reach the database",
      );
    }

    const { createClient } = await import("@supabase/supabase-js");
    client = createClient(url, key, {
      // There is no user session here and nothing to persist: this client is the
      // service_role acting on its own behalf, in a runtime with no storage to speak of.
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return client;
  };

  /** Rows, or a throw. A read that fails must never look like a read that found nothing. */
  const many = async <T>(context: string, run: (db: SupabaseClient) => PromiseLike<Response>): Promise<T[]> => {
    const { data, error } = await run(await lazy());
    if (error !== null) fail(context, error);
    return (data ?? []) as T[];
  };

  /** One row or null. */
  const maybe = async <T>(context: string, run: (db: SupabaseClient) => PromiseLike<Response>): Promise<T | null> => {
    const { data, error } = await run(await lazy());
    if (error !== null) fail(context, error);
    return (data ?? null) as T | null;
  };

  /** A scalar returned by an rpc. */
  const scalar = async <T>(context: string, run: (db: SupabaseClient) => PromiseLike<Response>): Promise<T> => {
    const { data, error } = await run(await lazy());
    if (error !== null) fail(context, error);
    return data as T;
  };

  /**
   * Turn a page limit into the query limit.
   *
   * One more than asked for, so the presence of a next page is a fact rather than a
   * guess. Returning a cursor whenever a page came back full would hand the caller a
   * cursor to an empty page every time the total is an exact multiple of the limit.
   */
  const overshoot = (page: Page): number => page.limit + 1;

  const cut = <T>(rows: T[], page: Page, cursorOf: (row: T) => string): { rows: T[]; nextCursor: string | null } => {
    const more = rows.length > page.limit;
    const kept = more ? rows.slice(0, page.limit) : rows;
    const last = kept.at(-1);
    return { rows: kept, nextCursor: more && last !== undefined ? cursorOf(last) : null };
  };

  return {
    async getUser(uid) {
      const row = await maybe<UserRow>("getUser", (db) =>
        db.from("users").select(USER_COLS).eq("uid", uid).maybeSingle(),
      );
      return row === null ? null : toUser(row);
    },

    async putUser(user) {
      const { error } = await (await lazy()).from("users").upsert(fromUser(user));
      if (error !== null) fail("putUser", error);
    },

    async putAdvertiser(advertiser) {
      const { error } = await (await lazy()).from("advertisers").upsert(fromAdvertiser(advertiser));
      if (error !== null) fail("putAdvertiser", error);
    },

    async getAdvertiser(advertiserId) {
      const row = await maybe<AdvertiserRow>("getAdvertiser", (db) =>
        db.from("advertisers").select(ADVERTISER_COLS).eq("advertiser_id", advertiserId).maybeSingle(),
      );
      return row === null ? null : toAdvertiser(row);
    },

    async advertiserForOwner(uid) {
      // `contains` is the array containment operator: owner_uids @> {uid}. The gin index
      // is not needed at this table's size, but the operator is what keeps this one query
      // rather than a scan in JavaScript.
      const row = await maybe<AdvertiserRow>("advertiserForOwner", (db) =>
        db
          .from("advertisers")
          .select(ADVERTISER_COLS)
          .contains("owner_uids", [uid])
          .limit(1)
          .maybeSingle(),
      );
      return row === null ? null : toAdvertiser(row);
    },

    async putCampaign(campaign) {
      const { error } = await (await lazy()).from("campaigns").upsert(fromCampaign(campaign));
      if (error !== null) fail("putCampaign", error);
    },

    async getCampaign(campaignId) {
      const row = await maybe<CampaignRow>("getCampaign", (db) =>
        db.from("campaigns").select(CAMPAIGN_COLS).eq("campaign_id", campaignId).maybeSingle(),
      );
      return row === null ? null : toCampaign(row);
    },

    async campaignsForAdvertiser(advertiserId) {
      const rows = await many<CampaignRow>("campaignsForAdvertiser", (db) =>
        db
          .from("campaigns")
          .select(CAMPAIGN_COLS)
          .eq("advertiser_id", advertiserId)
          .order("created_at", { ascending: false }),
      );
      return rows.map(toCampaign);
    },

    async activeCampaignsFor(tags) {
      // A function rather than a filter chain: the rule is "no tags means match everyone,
      // otherwise overlap", and PostgREST's `or=` syntax for that is a string that nobody
      // can read six months later.
      const rows = await many<CampaignRow>("activeCampaignsFor", (db) =>
        db.rpc("active_campaigns_for", { p_tags: [...tags] }).select(CAMPAIGN_COLS),
      );
      return rows.map(toCampaign);
    },

    async statsForCampaign(campaignId): Promise<CampaignStats> {
      // Aggregated in the database. The in-memory store folds every receipt in JavaScript,
      // which is correct for a test double and would mean shipping the whole receipts
      // table across the wire here.
      const rows = await many<{
        serves: number;
        impressions: number;
        clicks: number;
        spent_micros: string;
      }>("statsForCampaign", (db) => db.rpc("stats_for_campaign", { p_campaign_id: campaignId }));

      const row = rows[0];
      if (row === undefined) {
        return { campaignId, serves: 0, impressions: 0, clicks: 0, spentMicros: 0n };
      }

      return {
        campaignId,
        serves: Number(row.serves),
        impressions: Number(row.impressions),
        clicks: Number(row.clicks),
        spentMicros: toMicros(row.spent_micros),
      };
    },

    async transitionCampaignCommitment(input) {
      const result = await scalar<{
        ok: boolean;
        reason?: "not-found" | "insufficient-funds" | "invalid-state";
      }>("transitionCampaignCommitment", (db) =>
        db.rpc("transition_campaign_commitment", {
          p_advertiser_id: input.advertiserId,
          p_campaign_id: input.campaignId,
          p_next: input.next,
          p_spent_micros: fromMicros(input.spentMicros),
        }),
      );
      if (!result.ok) return { ok: false, reason: result.reason ?? "invalid-state" };
      const row = await maybe<CampaignRow>("transitionCampaignCommitment.read", (db) =>
        db.from("campaigns").select(CAMPAIGN_COLS).eq("campaign_id", input.campaignId).maybeSingle(),
      );
      return row === null
        ? { ok: false, reason: "not-found" }
        : { ok: true, campaign: toCampaign(row) };
    },

    /*
     * Artwork goes to Storage, not to a column.
     *
     * `upsert: true` because the key is derived from the creative id: re-submitting a
     * creative replaces its own artwork rather than leaving the old object orphaned.
     *
     * Storage is plain HTTPS on the same client, so it works on Cloudflare's runtime for
     * the same reason PostgREST does - there is no socket involved.
     */
    async putAsset(key, asset) {
      const { error } = await (await lazy()).storage
        .from(ASSET_BUCKET)
        .upload(key, asset.bytes, { contentType: asset.contentType, upsert: true });
      if (error !== null) fail("putAsset", error);
    },

    async getAsset(key) {
      const { data, error } = await (await lazy()).storage.from(ASSET_BUCKET).download(key);
      // A missing object is a 404 from Storage, which arrives as an error rather than as
      // empty data. That is "no such asset", not a failure worth throwing over.
      if (error !== null || data === null) return null;

      return {
        contentType: data.type === "" ? "application/octet-stream" : data.type,
        bytes: new Uint8Array(await data.arrayBuffer()),
      };
    },

    async putCreative(creative) {
      const { error } = await (await lazy()).from("creatives").upsert(fromCreative(creative));
      if (error !== null) fail("putCreative", error);
    },

    async getCreative(creativeId) {
      const row = await maybe<CreativeRow>("getCreative", (db) =>
        db.from("creatives").select(CREATIVE_COLS).eq("creative_id", creativeId).maybeSingle(),
      );
      return row === null ? null : toCreative(row);
    },

    async creativesForCampaign(campaignId) {
      const rows = await many<CreativeRow>("creativesForCampaign", (db) =>
        db
          .from("creatives")
          .select(CREATIVE_COLS)
          .eq("campaign_id", campaignId)
          .eq("status", "approved"),
      );
      return rows.map(toCreative);
    },

    async allCreativesForCampaign(campaignId) {
      const rows = await many<CreativeRow>("allCreativesForCampaign", (db) =>
        db.from("creatives").select(CREATIVE_COLS).eq("campaign_id", campaignId),
      );
      return rows.map(toCreative);
    },

    async recordServe(serve) {
      const { error } = await (await lazy()).from("serves").upsert(fromServe(serve));
      if (error !== null) fail("recordServe", error);
    },

    async findServe(uid, creativeId, now) {
      const row = await maybe<ServeRow>("findServe", (db) =>
        db
          .from("serves")
          .select(SERVE_COLS)
          .eq("uid", uid)
          .eq("creative_id", creativeId)
          .gt("expires_at", now)
          .order("expires_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      );
      return row === null ? null : toServe(row);
    },

    async marketPriceHistory(since) {
      const rows = await many<ServeRow>("marketPriceHistory", (db) =>
        db
          .from("serves")
          .select(SERVE_COLS)
          .gte("served_at", since)
          .eq("test", false)
          .order("served_at", { ascending: true })
          .limit(10_000),
      );
      const buckets = new Map<number, { total: bigint; count: bigint }>();
      for (const row of rows) {
        const price = BigInt(row.clearing_cpm_micros);
        if (price <= 0n) continue;
        const at = Math.floor(row.served_at / 3_600_000) * 3_600_000;
        const bucket = buckets.get(at) ?? { total: 0n, count: 0n };
        bucket.total += price;
        bucket.count += 1n;
        buckets.set(at, bucket);
      }
      return [...buckets.entries()].map(([at, bucket]) => ({
        at,
        clearingCpmMicros: bucket.total / bucket.count,
      }));
    },

    async createReceiptIfAbsent(receipt) {
      return scalar<boolean>("createReceiptIfAbsent", (db) =>
        db.rpc("create_receipt_if_absent", {
          p_receipt_id: receipt.receiptId,
          p_uid: receipt.uid,
          p_creative_id: receipt.creativeId,
          p_campaign_id: receipt.campaignId,
          p_outcome: receipt.outcome,
          p_credited_micros: fromMicros(receipt.creditedMicros),
          p_cost_micros: fromMicros(receipt.costMicros),
          p_created_at: receipt.createdAt,
        }),
      );
    },

    async settleReceipt({ receipt, earning }) {
      const delta = applyEntry(EMPTY_BALANCE, earning);
      return scalar<boolean>("settleReceipt", (db) =>
        db.rpc("settle_receipt", {
          p_receipt_id: receipt.receiptId,
          p_uid: receipt.uid,
          p_creative_id: receipt.creativeId,
          p_campaign_id: receipt.campaignId,
          p_outcome: receipt.outcome,
          p_credited_micros: fromMicros(receipt.creditedMicros),
          p_cost_micros: fromMicros(receipt.costMicros),
          p_receipt_created_at: receipt.createdAt,
          p_entry_id: earning.entryId,
          p_entry_kind: earning.kind,
          p_entry_micros: fromMicros(earning.micros),
          p_entry_ref_id: earning.refId,
          p_entry_created_at: earning.createdAt,
          p_entry_description: earning.description,
          p_available_delta: fromMicros(delta.availableMicros),
          p_lifetime_delta: fromMicros(delta.lifetimeMicros),
          p_pending_delta: fromMicros(delta.pendingWithdrawalMicros),
        }),
      );
    },

    async seriesForAdvertiser(advertiserId, since): Promise<SeriesPoint[]> {
      // Grouped in the database, like `statsForCampaign` and for the same reason: the
      // naive version pulls every receipt row across the wire to count it in JavaScript.
      const rows = await many<{
        day: string;
        campaign_id: string;
        impressions: number;
        clicks: number;
        spent_micros: string;
      }>("seriesForAdvertiser", (db) =>
        db.rpc("series_for_advertiser", { p_advertiser_id: advertiserId, p_since: since }),
      );

      return rows.map((row) => ({
        day: row.day,
        campaignId: row.campaign_id,
        impressions: Number(row.impressions),
        clicks: Number(row.clicks),
        spentMicros: toMicros(row.spent_micros),
      }));
    },

    async addActivity(delta) {
      // A function, not an upsert: two editor windows flushing at once would both read
      // the old row and both write their own delta over it, and the day would record
      // whichever landed second instead of the sum.
      const { error } = await (await lazy()).rpc("add_activity", {
        p_uid: delta.uid,
        p_day: delta.day,
        p_manual_chars: delta.manualChars,
        p_agent_chars: delta.agentChars,
        p_accepted_edits: delta.acceptedEdits,
        p_rejected_edits: delta.rejectedEdits,
        p_files_touched: delta.filesTouched,
        p_active_ms: delta.activeMs,
        p_sessions: delta.sessions,
        p_updated_at: delta.at,
      });
      if (error !== null) fail("addActivity", error);
    },

    async activityForUser(uid, sinceDay): Promise<ActivityDay[]> {
      const rows = await many<ActivityRow>("activityForUser", (db) =>
        db
          .from("activity_daily")
          .select(ACTIVITY_COLS)
          .eq("uid", uid)
          .gte("day", sinceDay)
          .order("day", { ascending: false }),
      );
      return rows.map(toActivity);
    },

    async appendEntryAndUpdateBalance(entry: LedgerEntry) {
      // The deltas, from the one implementation of what an entry does to a balance.
      // Folding onto the empty balance yields exactly the change, because every branch of
      // `applyEntry` is additive on the balance it is given.
      const delta = applyEntry(EMPTY_BALANCE, entry);

      const { error } = await (await lazy()).rpc("append_entry_and_update_balance", {
        p_entry_id: entry.entryId,
        p_uid: entry.uid,
        p_kind: entry.kind,
        p_micros: fromMicros(entry.micros),
        p_ref_id: entry.refId,
        p_created_at: entry.createdAt,
        p_description: entry.description,
        p_reason: entry.reason ?? null,
        p_admin_uid: entry.adminUid ?? null,
        p_provider_ref: entry.providerRef ?? null,
        p_currency: entry.currency ?? null,
        p_available_delta: fromMicros(delta.availableMicros),
        p_lifetime_delta: fromMicros(delta.lifetimeMicros),
        p_pending_delta: fromMicros(delta.pendingWithdrawalMicros),
      });

      if (error !== null) {
        // Same message and same shape as the in-memory store, so the callers that treat a
        // duplicate as a recoverable replay keep working against either implementation.
        if (error.code === UNIQUE_VIOLATION) {
          throw new Error(`ledger entry ${entry.entryId} already exists`);
        }
        fail("appendEntryAndUpdateBalance", error);
      }
    },

    async getBalance(uid): Promise<Balance> {
      const row = await maybe<BalanceRow>("getBalance", (db) =>
        db.from("balances").select(BALANCE_COLS).eq("uid", uid).maybeSingle(),
      );
      if (row === null) return EMPTY_BALANCE;
      return {
        availableMicros: toMicros(row.available_micros),
        lifetimeMicros: toMicros(row.lifetime_micros),
        pendingWithdrawalMicros: toMicros(row.pending_withdrawal_micros),
      };
    },

    async listEntries(uid, page): Promise<EntryPage> {
      const rows = await many<LedgerRow>("listEntries", (db) =>
        db
          .rpc("list_entries_page", { p_uid: uid, p_limit: overshoot(page), p_cursor: page.cursor })
          .select(LEDGER_COLS),
      );
      const { rows: kept, nextCursor } = cut(rows, page, (r) => r.entry_id);
      return { rows: kept.map(toEntry), nextCursor };
    },

    async addSpend(campaignId, micros) {
      const { error } = await (await lazy()).rpc("add_spend", {
        p_campaign_id: campaignId,
        p_micros: fromMicros(micros),
      });
      if (error !== null) fail("addSpend", error);
    },

    async getSpend(campaignId) {
      const row = await maybe<{ spent_micros: string }>("getSpend", (db) =>
        db
          .from("campaign_spend")
          .select("spent_micros::text")
          .eq("campaign_id", campaignId)
          .maybeSingle(),
      );
      return row === null ? 0n : toMicros(row.spent_micros);
    },

    async bumpRequestCount(uid, windowStart) {
      return scalar<number>("bumpRequestCount", (db) =>
        db.rpc("bump_request_count", { p_uid: uid, p_window_start: windowStart }),
      );
    },

    async recordFundingIfAbsent(funding) {
      const row = fromFunding(funding);
      return scalar<boolean>("recordFundingIfAbsent", (db) =>
        db.rpc("record_funding_if_absent", {
          p_event_id: row.event_id,
          p_payment_id: row.payment_id,
          p_advertiser_id: row.advertiser_id,
          p_amount_micros: row.amount_micros,
          p_currency: row.currency,
          p_at: row.at,
        }),
      );
    },

    async listFunding(advertiserId) {
      const rows = await many<FundingRow>("listFunding", (db) =>
        db
          .from("fundings")
          .select(FUNDING_COLS)
          .eq("advertiser_id", advertiserId)
          .order("at", { ascending: false }),
      );
      return rows.map(toFunding);
    },

    async createCreditOrder(order) {
      const { error } = await (await lazy()).from("advertiser_credit_orders").insert(fromCreditOrder(order));
      if (error !== null) fail("createCreditOrder", error);
    },

    async getCreditOrder(orderId) {
      const row = await maybe<CreditOrderRow>("getCreditOrder", (db) =>
        db
          .from("advertiser_credit_orders")
          .select(CREDIT_ORDER_COLS)
          .eq("order_id", orderId)
          .maybeSingle(),
      );
      return row === null ? null : toCreditOrder(row);
    },

    async putCreditOrder(order) {
      const { error } = await (await lazy())
        .from("advertiser_credit_orders")
        .upsert(fromCreditOrder(order));
      if (error !== null) fail("putCreditOrder", error);
    },

    async listCreditOrders(advertiserId) {
      const rows = await many<CreditOrderRow>("listCreditOrders", (db) =>
        db
          .from("advertiser_credit_orders")
          .select(CREDIT_ORDER_COLS)
          .eq("advertiser_id", advertiserId)
          .order("created_at", { ascending: false }),
      );
      return rows.map(toCreditOrder);
    },

    async applyCreditEvent(event) {
      const providerObjectId =
        event.type === "purchase"
          ? event.paymentId
          : event.type === "refund"
            ? event.refundId
            : event.disputeId;
      return scalar("applyCreditEvent", (db) =>
        db.rpc("apply_advertiser_credit_event", {
          p_webhook_id: event.webhookId,
          p_event_type: event.type,
          p_provider_object_id: providerObjectId,
          p_payment_id: event.paymentId,
          p_order_id: event.type === "purchase" ? event.orderId : null,
          p_session_id: event.type === "purchase" ? event.sessionId : null,
          p_amount_micros: fromMicros(event.amountMicros),
          p_currency: event.type === "purchase" ? event.currency : "USD",
          p_received_at: Date.now(),
        }),
      );
    },

    async createReport(report) {
      const { error } = await (await lazy()).from("reports").upsert(fromReport(report));
      if (error !== null) fail("createReport", error);
    },

    async listReports(page): Promise<ReportPage> {
      const rows = await many<ReportRow>("listReports", (db) =>
        db
          .rpc("list_reports_page", { p_limit: overshoot(page), p_cursor: page.cursor })
          .select(REPORT_COLS),
      );
      const { rows: kept, nextCursor } = cut(rows, page, (r) => r.report_id);
      return { rows: kept.map(toReport), nextCursor };
    },

    async setReportStatus(reportId, status) {
      const rows = await many<{ report_id: string }>("setReportStatus", (db) =>
        db.from("reports").update({ status }).eq("report_id", reportId).select("report_id"),
      );
      // The returned rows are how "there was nothing to update" is told apart from
      // "updated": PostgREST reports both as a success with no error.
      return rows.length > 0;
    },

    async deleteReport(reportId) {
      const rows = await many<{ report_id: string }>("deleteReport", (db) =>
        db.from("reports").delete().eq("report_id", reportId).select("report_id"),
      );
      return rows.length > 0;
    },

    async getPayoutProfile(uid) {
      const row = await maybe<PayoutProfileRow>("getPayoutProfile", (db) =>
        db.from("payout_profiles").select(PAYOUT_PROFILE_COLS).eq("uid", uid).maybeSingle(),
      );
      return row === null ? null : payoutProfileFromRow(row);
    },

    async putPayoutProfile(profile) {
      const row = { ...fromPayoutProfile(profile), ...encryptedColumns(profile) };
      const { error } = await (await lazy())
        .from("payout_profiles")
        .upsert(row);
      if (error !== null) fail("putPayoutProfile", error);
    },

    async getPayoutCorridor(country, currency) {
      const row = await maybe<Record<string, unknown>>("getPayoutCorridor", (db) =>
        db
          .from("payout_corridors")
          .select("country,currency,enabled,required_fields,source_note,verified_at,updated_at,updated_by")
          .eq("country", country)
          .eq("currency", currency)
          .maybeSingle(),
      );
      return row === null
        ? null
        : {
            country: String(row["country"]),
            currency: String(row["currency"]),
            enabled: row["enabled"] === true,
            requiredFields: row["required_fields"] as import("../src/store.ts").PayoutFieldKind[],
            sourceNote: String(row["source_note"] ?? ""),
            verifiedAt: typeof row["verified_at"] === "number" ? row["verified_at"] : null,
            updatedAt: Number(row["updated_at"]),
            updatedBy: String(row["updated_by"]),
          };
    },

    async putPayoutCorridor(corridor) {
      const { error } = await (await lazy()).from("payout_corridors").upsert({
        country: corridor.country,
        currency: corridor.currency,
        enabled: corridor.enabled,
        required_fields: corridor.requiredFields,
        source_note: corridor.sourceNote,
        verified_at: corridor.verifiedAt,
        updated_at: corridor.updatedAt,
        updated_by: corridor.updatedBy,
      });
      if (error !== null) fail("putPayoutCorridor", error);
    },

    async listPayoutCorridors(enabledOnly) {
      let query = (await lazy())
        .from("payout_corridors")
        .select("country,currency,enabled,required_fields,source_note,verified_at,updated_at,updated_by")
        .order("country")
        .order("currency");
      if (enabledOnly) query = query.eq("enabled", true);
      const { data, error } = await query;
      if (error !== null) fail("listPayoutCorridors", error);
      return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        country: String(row["country"]),
        currency: String(row["currency"]),
        enabled: row["enabled"] === true,
        requiredFields: row["required_fields"] as import("../src/store.ts").PayoutFieldKind[],
        sourceNote: String(row["source_note"] ?? ""),
        verifiedAt: typeof row["verified_at"] === "number" ? row["verified_at"] : null,
        updatedAt: Number(row["updated_at"]),
        updatedBy: String(row["updated_by"]),
      }));
    },

    async createWithdrawal(withdrawal) {
      // `insert`, not `upsert`: a second request that reuses an id is a bug, and the
      // unique violation is the only place it can still be caught.
      const row = { ...fromWithdrawal(withdrawal), ...encryptedColumns(withdrawal.destination) };
      const { error } = await (await lazy()).from("withdrawals").insert(row);
      if (error !== null) fail("createWithdrawal", error);
    },

    async reserveWithdrawal(withdrawal, entry) {
      const row = { ...fromWithdrawal(withdrawal), ...encryptedColumns(withdrawal.destination) };
      const delta = applyEntry(EMPTY_BALANCE, entry);
      return scalar<"created" | "in-flight" | "insufficient-funds">(
        "reserveWithdrawal",
        (db) => db.rpc("reserve_withdrawal", {
          p_withdrawal: row,
          p_entry: {
            entry_id: entry.entryId,
            uid: entry.uid,
            kind: entry.kind,
            micros: fromMicros(entry.micros),
            ref_id: entry.refId,
            created_at: entry.createdAt,
            description: entry.description,
            reason: entry.reason ?? null,
            admin_uid: entry.adminUid ?? null,
            provider_ref: entry.providerRef ?? null,
            currency: entry.currency ?? null,
          },
          p_available_delta: fromMicros(delta.availableMicros),
          p_lifetime_delta: fromMicros(delta.lifetimeMicros),
          p_pending_delta: fromMicros(delta.pendingWithdrawalMicros),
        }),
      );
    },

    async transitionWithdrawal(input) {
      const delta = input.entry === undefined ? EMPTY_BALANCE : applyEntry(EMPTY_BALANCE, input.entry);
      return scalar<boolean>("transitionWithdrawal", (db) => db.rpc("transition_withdrawal", {
        p_withdrawal_id: input.withdrawalId,
        p_expected_statuses: input.expectedStatuses,
        p_status: input.status,
        p_decided_at: input.decidedAt,
        p_decided_by: input.decidedBy,
        p_provider_ref: input.providerRef,
        p_note: input.note,
        p_evidence: input.evidence ?? null,
        p_entry: input.entry === undefined ? null : {
          entry_id: input.entry.entryId,
          uid: input.entry.uid,
          kind: input.entry.kind,
          micros: fromMicros(input.entry.micros),
          ref_id: input.entry.refId,
          created_at: input.entry.createdAt,
          description: input.entry.description,
          reason: input.entry.reason ?? null,
          admin_uid: input.entry.adminUid ?? null,
          provider_ref: input.entry.providerRef ?? null,
          currency: input.entry.currency ?? null,
        },
        p_available_delta: fromMicros(delta.availableMicros),
        p_lifetime_delta: fromMicros(delta.lifetimeMicros),
        p_pending_delta: fromMicros(delta.pendingWithdrawalMicros),
      }));
    },

    async getWithdrawal(withdrawalId) {
      const row = await maybe<WithdrawalRow>("getWithdrawal", (db) =>
        db
          .from("withdrawals")
          .select(WITHDRAWAL_COLS)
          .eq("withdrawal_id", withdrawalId)
          .maybeSingle(),
      );
      return row === null ? null : withdrawalFromRow(row);
    },

    async putWithdrawal(withdrawal) {
      const row = { ...fromWithdrawal(withdrawal), ...encryptedColumns(withdrawal.destination) };
      const { error } = await (await lazy())
        .from("withdrawals")
        .upsert(row);
      if (error !== null) fail("putWithdrawal", error);
    },

    async withdrawalsForUser(uid) {
      const rows = await many<WithdrawalRow>("withdrawalsForUser", (db) =>
        db
          .from("withdrawals")
          .select(WITHDRAWAL_COLS)
          .eq("uid", uid)
          .order("created_at", { ascending: false })
          .order("withdrawal_id", { ascending: false }),
      );
      return rows.map(withdrawalFromRow);
    },

    async listWithdrawals(status, page): Promise<WithdrawalPage> {
      const rows = await many<WithdrawalRow>("listWithdrawals", (db) =>
        db
          .rpc("list_withdrawals_page", {
            p_limit: overshoot(page),
            p_status: status,
            p_cursor: page.cursor,
          })
          .select(WITHDRAWAL_COLS),
      );
      const { rows: kept, nextCursor } = cut(rows, page, (r) => r.withdrawal_id);
      return { rows: kept.map(withdrawalFromRow), nextCursor };
    },

    async listUsers(page): Promise<UserPage> {
      const rows = await many<UserRow>("listUsers", (db) =>
        db
          .rpc("list_users_page", { p_limit: overshoot(page), p_cursor: page.cursor })
          .select(USER_COLS),
      );
      const { rows: kept, nextCursor } = cut(rows, page, (r) => r.uid);
      return { rows: kept.map(toUser), nextCursor };
    },

    async listAdvertisers() {
      const rows = await many<AdvertiserRow>("listAdvertisers", (db) =>
        db.from("advertisers").select(ADVERTISER_COLS).order("created_at", { ascending: false }),
      );
      return rows.map(toAdvertiser);
    },

    async putNotice(notice) {
      const { error } = await (await lazy()).from("notices").upsert(fromNotice(notice));
      if (error !== null) fail("putNotice", error);
    },

    async getNotice(noticeId) {
      const row = await maybe<NoticeRow>("getNotice", (db) =>
        db.from("notices").select(NOTICE_COLS).eq("notice_id", noticeId).maybeSingle(),
      );
      return row === null ? null : toNotice(row);
    },

    async listNotices(options_) {
      const rows = await many<NoticeRow>("listNotices", (db) => {
        const query = db.from("notices").select(NOTICE_COLS).order("created_at", { ascending: false });
        return options_.activeOnly ? query.eq("active", true) : query;
      });
      return rows.map(toNotice);
    },

    async creativesByStatus(status) {
      const rows = await many<CreativeRow>("creativesByStatus", (db) =>
        db.from("creatives").select(CREATIVE_COLS).eq("status", status),
      );
      return rows.map(toCreative);
    },

    async putPost(post) {
      const { error } = await (await lazy()).from("posts").upsert(fromPost(post));
      if (error !== null) fail("putPost", error);
    },

    async getPost(slug) {
      const row = await maybe<PostRow>("getPost", (db) =>
        db.from("posts").select(POST_COLS).eq("slug", slug).maybeSingle(),
      );
      return row === null ? null : toPost(row);
    },

    async listPosts(options_) {
      // `sort_at` is the generated `coalesce(published_at, updated_at)` column: a draft
      // sorts by when it was last edited, a published post by when it went out.
      const rows = await many<PostRow>("listPosts", (db) => {
        const query = db.from("posts").select(POST_COLS).order("sort_at", { ascending: false });
        return options_.publishedOnly ? query.eq("status", "published") : query;
      });
      return rows.map(toPost);
    },

    async putRelease(release) {
      const { error } = await (await lazy()).from("releases").upsert(fromRelease(release));
      if (error !== null) fail("putRelease", error);
    },

    async getRelease(version) {
      const row = await maybe<ReleaseRow>("getRelease", (db) =>
        db.from("releases").select(RELEASE_COLS).eq("version", version).maybeSingle(),
      );
      return row === null ? null : toRelease(row);
    },

    async listReleases(options_) {
      const rows = await many<ReleaseRow>("listReleases", (db) => {
        const query = db.from("releases").select(RELEASE_COLS).order("sort_at", { ascending: false });
        return options_.publishedOnly ? query.eq("status", "published") : query;
      });
      return rows.map(toRelease);
    },

    async setTestServe(uid, creativeId) {
      const { error } = await (await lazy())
        .from("test_serves")
        .upsert({ uid, creative_id: creativeId });
      if (error !== null) fail("setTestServe", error);
    },

    async takeTestServe(uid) {
      // Delete-returning, in the database. A read followed by a delete would let two
      // concurrent requests both see the queued creative and both serve it.
      return scalar<string | null>("takeTestServe", (db) =>
        db.rpc("take_test_serve", { p_uid: uid }),
      );
    },

    async getConfig(): Promise<ServingConfig> {
      const row = await maybe<ConfigRow>("getConfig", (db) =>
        db.from("serving_config").select(CONFIG_COLS).eq("id", 1).maybeSingle(),
      );
      if (row === null) {
        throw new Error(
          "serving_config row 1 is missing - run supabase/migrations/20260824000000_init.sql",
        );
      }
      return toConfig(row);
    },

    async putConfig(config) {
      const { error } = await (await lazy()).from("serving_config").upsert(fromConfig(config));
      if (error !== null) fail("putConfig", error);
    },

    async writeAudit(record) {
      const { error } = await (await lazy()).from("audit_log").insert(fromAudit(record));
      if (error !== null) fail("writeAudit", error);
    },

    async listAudit() {
      // Insertion order, which the identity column gives for free and `at` does not: two
      // admin actions in the same millisecond are not unusual.
      const rows = await many<AuditRow>("listAudit", (db) =>
        db.from("audit_log").select(AUDIT_COLS).order("id", { ascending: true }),
      );
      return rows.map(toAudit);
    },

    async isAdmin(email) {
      // `maybeSingle` semantics via the shared helper: a miss is null, not an error.
      const row = await maybe<{ email: string }>("isAdmin", (db) =>
        db.from("admins").select("email").eq("email", email.toLowerCase()).maybeSingle(),
      );
      return row !== null;
    },

    async listAdmins() {
      const rows = await many<AdminRow>("listAdmins", (db) =>
        db.from("admins").select(ADMIN_COLS).order("added_at", { ascending: false }),
      );
      return rows.map(toAdmin);
    },

    async addAdmin(record) {
      // `ignoreDuplicates` turns the unique violation into an empty result, which is what
      // "false when they were already an admin" means without reading first and racing.
      const rows = await many<AdminRow>("addAdmin", (db) =>
        db.from("admins").upsert(fromAdmin(record), { onConflict: "email", ignoreDuplicates: true }).select(ADMIN_COLS),
      );
      return rows.length > 0;
    },

    async removeAdmin(email) {
      const rows = await many<AdminRow>("removeAdmin", (db) =>
        db.from("admins").delete().eq("email", email.toLowerCase()).select(ADMIN_COLS),
      );
      return rows.length > 0;
    },

    async countAdmins() {
      const rows = await many<{ email: string }>("countAdmins", (db) => db.from("admins").select("email"));
      return rows.length;
    },
  };
}
