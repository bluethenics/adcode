/**
 * The in-memory `Store`.
 *
 * Backs every unit and conformance test. It is not a stub: it enforces the same
 * invariants Firestore will - idempotent receipt creation, refusal of a duplicate entry
 * id, and a balance cache written in the same step as the append. A test double that is
 * more permissive than production tests nothing worth testing.
 */
import { utcDay } from "./day.ts";
import { applyEntry, EMPTY_BALANCE, type Balance, type LedgerEntry } from "./ledger.ts";
import type {
  ActivityDay,
  AdminRecord,
  AdvertiserRecord,
  AuditRecord,
  CampaignStats,
  CampaignRecord,
  AssetRecord,
  CreativeRecord,
  EntryPage,
  Page,
  ReceiptRecord,
  NoticeRecord,
  PayoutProfileRecord,
  PayoutCorridorRecord,
  PostRecord,
  ReleaseRecord,
  ReportPage,
  ReportRecord,
  WithdrawalPage,
  WithdrawalRecord,
  SeriesPoint,
  UserPage,
  ServeRecord,
  ServingConfig,
  Store,
  CreditOrderRecord,
  UserRecord,
} from "./store.ts";

export const DEFAULT_CONFIG: ServingConfig = {
  killSwitch: false,
  /*
   * A ceiling, not the binding constraint.
   *
   * Remote config may only ever *tighten* what the client shipped (§1), so a server cap
   * below a client preset silently overrules it - `dailyCap: 12` here made "Max · 60/day"
   * mean twelve. These sit above every preset so the user's own choice is what decides,
   * and the server keeps the power to clamp down in an emergency.
   */
  caps: { minIntervalMs: 60_000, dailyCap: 100 },
  defaultCpmMicros: 8_000_000n,
  // Customer-facing unit: $1 per 500 impressions. CPM remains the storage and
  // settlement unit, so the equivalent floor is $2 CPM.
  floorCpmMicros: 2_000_000n,
  auctionIncrementCpmMicros: 20_000n,
  revSharePercent: 50n,
  spendShardCount: 4,
  serveTtlMs: 600_000,
  rateWindowMs: 60_000,
  // Generous: an honest client at the `max` cadence sends a handful of requests a minute,
  // so this only bites on something automated.
  requestsPerWindow: 120,
};

export function createMemoryStore(): Store & { reset(): void } {
  let users = new Map<string, UserRecord>();
  let advertisers = new Map<string, AdvertiserRecord>();
  let campaigns = new Map<string, CampaignRecord>();
  let creatives = new Map<string, CreativeRecord>();
  let assets = new Map<string, AssetRecord>();
  let serves = new Map<string, ServeRecord>();
  let receipts = new Map<string, ReceiptRecord>();
  // Keyed "<uid> <day>", the same grain as the table's composite primary key.
  let activity = new Map<string, ActivityDay>();
  let entries: LedgerEntry[] = [];
  let balances = new Map<string, Balance>();
  let spend = new Map<string, bigint>();
  let requestCounts = new Map<string, number>();
  let reports = new Map<string, ReportRecord>();
  let payoutProfiles = new Map<string, PayoutProfileRecord>();
  let payoutCorridors = new Map<string, PayoutCorridorRecord>();
  let withdrawals = new Map<string, WithdrawalRecord>();
  let creditOrders = new Map<string, CreditOrderRecord>();
  let providerWebhookIds = new Set<string>();
  let providerObjectIds = new Set<string>();
  let disputeDebits = new Map<string, bigint>();
  /** What each order still counts for, as the SQL's fold over `advertiser_credit_entries`. */
  let creditOrderNet = new Map<string, bigint>();
  let posts = new Map<string, PostRecord>();
  let releases = new Map<string, ReleaseRecord>();
  let notices = new Map<string, NoticeRecord>();
  let testServes = new Map<string, string>();
  let audit: AuditRecord[] = [];
  let admins = new Map<string, AdminRecord>();
  let config: ServingConfig = { ...DEFAULT_CONFIG };

  return {
    reset() {
      users = new Map();
      advertisers = new Map();
      campaigns = new Map();
      creatives = new Map();
      assets = new Map();
      serves = new Map();
      receipts = new Map();
      activity = new Map();
      entries = [];
      balances = new Map();
      spend = new Map();
      requestCounts = new Map();
      reports = new Map();
      payoutProfiles = new Map();
      payoutCorridors = new Map();
      withdrawals = new Map();
      creditOrders = new Map();
      providerWebhookIds = new Set();
      providerObjectIds = new Set();
      disputeDebits = new Map();
      creditOrderNet = new Map();
      posts = new Map();
      releases = new Map();
      notices = new Map();
      testServes = new Map();
      audit = [];
      admins = new Map();
      config = { ...DEFAULT_CONFIG };
    },

    async getUser(uid) {
      return users.get(uid) ?? null;
    },

    async putUser(user) {
      users.set(user.uid, user);
    },

    async putAdvertiser(advertiser) {
      advertisers.set(advertiser.advertiserId, advertiser);
    },

    async getAdvertiser(advertiserId) {
      return advertisers.get(advertiserId) ?? null;
    },

    async advertiserForOwner(uid) {
      for (const a of advertisers.values()) {
        if (a.ownerUids.includes(uid)) return a;
      }
      return null;
    },

    async putCampaign(campaign) {
      campaigns.set(campaign.campaignId, campaign);
    },

    async getCampaign(campaignId) {
      return campaigns.get(campaignId) ?? null;
    },

    async campaignsForAdvertiser(advertiserId) {
      return [...campaigns.values()]
        .filter((c) => c.advertiserId === advertiserId)
        .sort((a, b) => b.createdAt - a.createdAt);
    },

    async statsForCampaign(campaignId): Promise<CampaignStats> {
      let serveCount = 0;
      for (const s of serves.values()) if (s.campaignId === campaignId) serveCount += 1;

      let impressions = 0;
      let clicks = 0;
      let spentMicros = 0n;

      for (const r of receipts.values()) {
        if (r.campaignId !== campaignId) continue;
        if (r.outcome === "click") clicks += 1;
        else impressions += 1;
        spentMicros += r.costMicros;
      }

      return { campaignId, serves: serveCount, impressions, clicks, spentMicros };
    },

    async transitionCampaignCommitment({ advertiserId, campaignId, next, spentMicros }) {
      const advertiser = advertisers.get(advertiserId);
      const campaign = campaigns.get(campaignId);
      if (advertiser === undefined || campaign === undefined || campaign.advertiserId !== advertiserId) {
        return { ok: false, reason: "not-found" };
      }
      if (campaign.status === "ended") return { ok: false, reason: "invalid-state" };
      if (campaign.status === next) return { ok: true, campaign };

      const remaining = campaign.budgetMicros - spentMicros;
      if (next === "active") {
        if (remaining > advertiser.fundedMicros - advertiser.reservedMicros) {
          return { ok: false, reason: "insufficient-funds" };
        }
        advertisers.set(advertiserId, {
          ...advertiser,
          reservedMicros: advertiser.reservedMicros + remaining,
        });
      } else {
        const reservedMicros = advertiser.reservedMicros - remaining;
        advertisers.set(advertiserId, {
          ...advertiser,
          reservedMicros: reservedMicros < 0n ? 0n : reservedMicros,
        });
      }
      const updated = { ...campaign, status: next };
      campaigns.set(campaignId, updated);
      return { ok: true, campaign: updated };
    },

    async activeCampaignsFor(tags) {
      const wanted = new Set(tags);
      return [...campaigns.values()].filter(
        (c) =>
          c.status === "active" &&
          // An untargeted campaign matches everyone; that is how house ads reach a user
          // whose tags we have not seen before.
          (c.targetTags.length === 0 || c.targetTags.some((t) => wanted.has(t))),
      );
    },

    async putAsset(key, asset) {
      assets.set(key, asset);
    },

    async getAsset(key) {
      return assets.get(key) ?? null;
    },

    async putCreative(creative) {
      creatives.set(creative.creativeId, creative);
    },

    async getCreative(creativeId) {
      return creatives.get(creativeId) ?? null;
    },

    async creativesForCampaign(campaignId) {
      return [...creatives.values()].filter(
        (c) => c.campaignId === campaignId && c.status === "approved",
      );
    },

    async allCreativesForCampaign(campaignId) {
      return [...creatives.values()].filter((c) => c.campaignId === campaignId);
    },

    async recordServe(serve) {
      serves.set(serve.serveId, serve);
    },

    async findServe(uid, creativeId, now) {
      for (const s of serves.values()) {
        if (s.uid === uid && s.creativeId === creativeId && s.expiresAt > now) return s;
      }
      return null;
    },

    async marketPriceHistory(since) {
      const buckets = new Map<number, { total: bigint; count: bigint }>();
      for (const serve of serves.values()) {
        if (serve.test === true || serve.servedAt < since || serve.clearingCpmMicros <= 0n) continue;
        const at = Math.floor(serve.servedAt / 3_600_000) * 3_600_000;
        const bucket = buckets.get(at) ?? { total: 0n, count: 0n };
        bucket.total += serve.clearingCpmMicros;
        bucket.count += 1n;
        buckets.set(at, bucket);
      }
      return [...buckets.entries()]
        .sort(([a], [b]) => a - b)
        .map(([at, bucket]) => ({ at, clearingCpmMicros: bucket.total / bucket.count }));
    },

    async createReceiptIfAbsent(receipt) {
      if (receipts.has(receipt.receiptId)) return false;
      receipts.set(receipt.receiptId, receipt);
      return true;
    },

    async settleReceipt({ receipt, earning }) {
      if (receipts.has(receipt.receiptId)) return false;
      if (entries.some((entry) => entry.entryId === earning.entryId)) {
        throw new Error(`ledger entry ${earning.entryId} already exists`);
      }

      const current = balances.get(earning.uid) ?? EMPTY_BALANCE;
      const nextBalance = applyEntry(current, earning);
      const nextSpend = (spend.get(receipt.campaignId) ?? 0n) + receipt.costMicros;

      // Apply only after every validation/calculation succeeds. This mirrors the database
      // transaction: callers never observe a receipt without all of its money movements.
      receipts.set(receipt.receiptId, receipt);
      entries.push(earning);
      balances.set(earning.uid, nextBalance);
      spend.set(receipt.campaignId, nextSpend);
      return true;
    },

    async seriesForAdvertiser(advertiserId, since): Promise<SeriesPoint[]> {
      const mine = new Set<string>();
      for (const c of campaigns.values()) if (c.advertiserId === advertiserId) mine.add(c.campaignId);

      // Keyed by day and campaign together, which is the grain the chart reads.
      const buckets = new Map<string, SeriesPoint>();

      for (const r of receipts.values()) {
        if (!mine.has(r.campaignId) || r.createdAt < since) continue;

        const day = utcDay(r.createdAt);
        const key = `${day} ${r.campaignId}`;
        const point = buckets.get(key) ?? {
          day,
          campaignId: r.campaignId,
          impressions: 0,
          clicks: 0,
          spentMicros: 0n,
        };

        if (r.outcome === "click") point.clicks += 1;
        else point.impressions += 1;
        point.spentMicros += r.costMicros;

        buckets.set(key, point);
      }

      return [...buckets.values()].sort(
        (a, b) => a.day.localeCompare(b.day) || a.campaignId.localeCompare(b.campaignId),
      );
    },

    async addActivity(delta) {
      const key = `${delta.uid} ${delta.day}`;
      const current = activity.get(key);

      if (current === undefined) {
        const { uid: _uid, at: _at, ...day } = delta;
        activity.set(key, { ...day });
        return;
      }

      activity.set(key, {
        day: current.day,
        manualChars: current.manualChars + delta.manualChars,
        agentChars: current.agentChars + delta.agentChars,
        acceptedEdits: current.acceptedEdits + delta.acceptedEdits,
        rejectedEdits: current.rejectedEdits + delta.rejectedEdits,
        // Not a sum: the client sends the day's distinct file count, and a file edited
        // twice in a day is one file. The larger of the two is the closest honest answer
        // without storing filenames, which is exactly what we refuse to store.
        filesTouched: Math.max(current.filesTouched, delta.filesTouched),
        activeMs: current.activeMs + delta.activeMs,
        sessions: current.sessions + delta.sessions,
      });
    },

    async activityForUser(uid, sinceDay) {
      const prefix = `${uid} `;
      return [...activity.entries()]
        .filter(([key, day]) => key.startsWith(prefix) && day.day >= sinceDay)
        .map(([, day]) => day)
        .sort((a, b) => b.day.localeCompare(a.day));
    },

    async appendEntryAndUpdateBalance(entry) {
      if (entries.some((e) => e.entryId === entry.entryId)) {
        throw new Error(`ledger entry ${entry.entryId} already exists`);
      }
      entries.push(entry);
      const current = balances.get(entry.uid) ?? EMPTY_BALANCE;
      balances.set(entry.uid, applyEntry(current, entry));
    },

    async getBalance(uid) {
      return balances.get(uid) ?? EMPTY_BALANCE;
    },

    async listEntries(uid, page: Page): Promise<EntryPage> {
      const mine = entries
        .filter((e) => e.uid === uid)
        .sort((a, b) => b.createdAt - a.createdAt || b.entryId.localeCompare(a.entryId));

      const start = page.cursor === null ? 0 : mine.findIndex((e) => e.entryId === page.cursor) + 1;
      const rows = mine.slice(start, start + page.limit);
      const last = rows.at(-1);
      const more = start + rows.length < mine.length;

      return { rows, nextCursor: more && last !== undefined ? last.entryId : null };
    },

    async addSpend(campaignId, micros) {
      spend.set(campaignId, (spend.get(campaignId) ?? 0n) + micros);
    },

    async getSpend(campaignId) {
      return spend.get(campaignId) ?? 0n;
    },

    async bumpRequestCount(uid, windowStart) {
      const key = `${uid}:${windowStart}`;
      const next = (requestCounts.get(key) ?? 0) + 1;
      requestCounts.set(key, next);
      return next;
    },

    async createCreditOrder(order) {
      if (creditOrders.has(order.orderId)) throw new Error(`credit order ${order.orderId} exists`);
      creditOrders.set(order.orderId, order);
    },

    async getCreditOrder(orderId) {
      return creditOrders.get(orderId) ?? null;
    },

    async putCreditOrder(order) {
      creditOrders.set(order.orderId, order);
    },

    async listCreditOrders(advertiserId) {
      return [...creditOrders.values()]
        .filter((order) => order.advertiserId === advertiserId)
        .sort((a, b) => b.createdAt - a.createdAt);
    },

    async applyCreditEvent(event) {
      const objectId =
        event.type === "purchase"
          ? `purchase:${event.paymentId}`
          : event.type === "refund"
            ? `refund:${event.refundId}`
            : `${event.type}:${event.disputeId}`;
      if (providerWebhookIds.has(event.webhookId) || providerObjectIds.has(objectId)) {
        return { applied: false, reason: "duplicate" };
      }

      const order =
        event.type === "purchase"
          ? creditOrders.get(event.orderId)
          : [...creditOrders.values()].find((candidate) => candidate.providerPaymentId === event.paymentId);
      if (order === undefined) return { applied: false, reason: "ignored" };
      const advertiser = advertisers.get(order.advertiserId);
      if (advertiser === undefined) return { applied: false, reason: "ignored" };

      providerWebhookIds.add(event.webhookId);
      providerObjectIds.add(objectId);

      if (event.type === "purchase") {
        const valid =
          order.amountMicros === event.amountMicros &&
          order.currency === event.currency &&
          order.providerSessionId === event.sessionId &&
          order.status === "checkout_created";
        if (!valid) {
          creditOrders.set(order.orderId, { ...order, status: "review_required" });
          return { applied: false, reason: "review_required" };
        }
        advertisers.set(advertiser.advertiserId, {
          ...advertiser,
          fundedMicros: advertiser.fundedMicros + order.amountMicros,
        });
        creditOrderNet.set(order.orderId, order.amountMicros);
        creditOrders.set(order.orderId, {
          ...order,
          status: "paid",
          providerPaymentId: event.paymentId,
        });
        return { applied: true, reason: "applied", advertiserId: advertiser.advertiserId };
      }

      // What this order still counts for. Two ceilings apply to a reversal and the order's
      // is the one that used to be missing: a refund can never take back more than this
      // order was worth, however much the event claims.
      const net = creditOrderNet.get(order.orderId) ?? 0n;

      let delta = 0n;
      if (event.type === "refund" || event.type === "dispute-opened") {
        const absorbable = net > 0n ? net : 0n;
        const funded = advertiser.fundedMicros > 0n ? advertiser.fundedMicros : 0n;
        const ceiling = absorbable < funded ? absorbable : funded;
        const removed = event.amountMicros < ceiling ? event.amountMicros : ceiling;
        delta = -removed;
        if (event.type === "dispute-opened") disputeDebits.set(event.disputeId, removed);
      } else if (event.type === "dispute-release") {
        delta = disputeDebits.get(event.disputeId) ?? 0n;
      }
      // `dispute-final` moves nothing: the money left when the dispute opened. It still
      // settles the order below, which is the whole point - it used to fall through to a
      // recompute that marked a lost chargeback as `paid`.
      creditOrderNet.set(order.orderId, net + delta);

      const fundedMicros = advertiser.fundedMicros + delta;
      const underfunded = fundedMicros < advertiser.reservedMicros;
      advertisers.set(advertiser.advertiserId, {
        ...advertiser,
        fundedMicros,
        status: underfunded ? "suspended" : advertiser.status,
      });
      if (underfunded) {
        for (const [campaignId, campaign] of campaigns) {
          if (campaign.advertiserId === advertiser.advertiserId && campaign.status === "active") {
            campaigns.set(campaignId, { ...campaign, status: "paused" });
          }
        }
      }

      // Folded over this order's own entries, never over the advertiser's whole balance.
      const orderNet = net + delta;
      creditOrders.set(order.orderId, {
        ...order,
        status:
          event.type === "dispute-opened"
            ? "disputed"
            : event.type === "dispute-final"
              ? "reversed"
              : orderNet <= 0n
                ? "reversed"
                : orderNet < order.amountMicros
                  ? "partially_reversed"
                  : "paid",
      });
      return { applied: true, reason: "applied", advertiserId: advertiser.advertiserId };
    },

    async createReport(report) {
      reports.set(report.reportId, report);
    },

    async listReports(page: Page): Promise<ReportPage> {
      const all = [...reports.values()].sort(
        (a, b) => b.createdAt - a.createdAt || b.reportId.localeCompare(a.reportId),
      );
      const start = page.cursor === null ? 0 : all.findIndex((r) => r.reportId === page.cursor) + 1;
      const rows = all.slice(start, start + page.limit);
      const last = rows.at(-1);
      const more = start + rows.length < all.length;
      return { rows, nextCursor: more && last !== undefined ? last.reportId : null };
    },

    async setReportStatus(reportId, status) {
      const found = reports.get(reportId);
      if (found === undefined) return false;
      reports.set(reportId, { ...found, status });
      return true;
    },

    async deleteReport(reportId) {
      return reports.delete(reportId);
    },

    async getPayoutProfile(uid) {
      return payoutProfiles.get(uid) ?? null;
    },

    async putPayoutProfile(profile) {
      payoutProfiles.set(profile.uid, profile);
    },

    async getPayoutCorridor(country, currency) {
      return payoutCorridors.get(`${country}:${currency}`) ?? null;
    },

    async putPayoutCorridor(corridor) {
      payoutCorridors.set(`${corridor.country}:${corridor.currency}`, corridor);
    },

    async listPayoutCorridors(enabledOnly) {
      return [...payoutCorridors.values()]
        .filter((corridor) => !enabledOnly || corridor.enabled)
        .sort((a, b) => a.country.localeCompare(b.country) || a.currency.localeCompare(b.currency));
    },

    async createWithdrawal(withdrawal) {
      withdrawals.set(withdrawal.withdrawalId, withdrawal);
    },

    async reserveWithdrawal(withdrawal, entry) {
      const inFlight = [...withdrawals.values()].some(
        (row) => row.uid === withdrawal.uid && (row.status === "requested" || row.status === "approved"),
      );
      if (inFlight) return "in-flight";
      const current = balances.get(withdrawal.uid) ?? EMPTY_BALANCE;
      if (current.availableMicros < withdrawal.amountMicros) return "insufficient-funds";
      if (entries.some((candidate) => candidate.entryId === entry.entryId)) {
        throw new Error(`ledger entry ${entry.entryId} already exists`);
      }
      withdrawals.set(withdrawal.withdrawalId, withdrawal);
      entries.push(entry);
      balances.set(withdrawal.uid, applyEntry(current, entry));
      return "created";
    },

    async transitionWithdrawal(input) {
      const current = withdrawals.get(input.withdrawalId);
      if (current === undefined || !input.expectedStatuses.includes(current.status)) return false;
      if (input.entry !== undefined) {
        if (entries.some((candidate) => candidate.entryId === input.entry?.entryId)) return false;
        const balance = balances.get(current.uid) ?? EMPTY_BALANCE;
        entries.push(input.entry);
        balances.set(current.uid, applyEntry(balance, input.entry));
      }
      withdrawals.set(input.withdrawalId, {
        ...current,
        status: input.status,
        decidedAt: input.decidedAt,
        decidedBy: input.decidedBy,
        providerRef: input.providerRef,
        note: input.note,
        evidence: input.evidence ?? null,
      });
      return true;
    },

    async getWithdrawal(withdrawalId) {
      return withdrawals.get(withdrawalId) ?? null;
    },

    async putWithdrawal(withdrawal) {
      withdrawals.set(withdrawal.withdrawalId, withdrawal);
    },

    async withdrawalsForUser(uid) {
      return [...withdrawals.values()]
        .filter((w) => w.uid === uid)
        .sort((a, b) => b.createdAt - a.createdAt || b.withdrawalId.localeCompare(a.withdrawalId));
    },

    async listWithdrawals(status, page: Page): Promise<WithdrawalPage> {
      const all = [...withdrawals.values()]
        .filter((w) => status === null || w.status === status)
        .sort((a, b) => b.createdAt - a.createdAt || b.withdrawalId.localeCompare(a.withdrawalId));
      const start =
        page.cursor === null ? 0 : all.findIndex((w) => w.withdrawalId === page.cursor) + 1;
      const rows = all.slice(start, start + page.limit);
      const last = rows.at(-1);
      const more = start + rows.length < all.length;
      return { rows, nextCursor: more && last !== undefined ? last.withdrawalId : null };
    },

    async listUsers(page: Page): Promise<UserPage> {
      const all = [...users.values()].sort((a, b) => b.createdAt - a.createdAt || a.uid.localeCompare(b.uid));
      const start = page.cursor === null ? 0 : all.findIndex((u) => u.uid === page.cursor) + 1;
      const rows = all.slice(start, start + page.limit);
      const last = rows.at(-1);
      const more = start + rows.length < all.length;
      return { rows, nextCursor: more && last !== undefined ? last.uid : null };
    },

    async listAdvertisers() {
      return [...advertisers.values()].sort((a, b) => b.createdAt - a.createdAt);
    },

    async putNotice(notice) {
      notices.set(notice.noticeId, notice);
    },

    async getNotice(noticeId) {
      return notices.get(noticeId) ?? null;
    },

    async listNotices(options) {
      return [...notices.values()]
        .filter((n) => !options.activeOnly || n.active)
        .sort((a, b) => b.createdAt - a.createdAt);
    },

    async creativesByStatus(status) {
      return [...creatives.values()].filter((c) => c.status === status);
    },

    async putPost(post) {
      posts.set(post.slug, post);
    },

    async getPost(slug) {
      return posts.get(slug) ?? null;
    },

    async listPosts(options) {
      return [...posts.values()]
        .filter((p) => !options.publishedOnly || p.status === "published")
        .sort((a, b) => (b.publishedAt ?? b.updatedAt) - (a.publishedAt ?? a.updatedAt));
    },

    async putRelease(release) {
      releases.set(release.version, release);
    },

    async getRelease(version) {
      return releases.get(version) ?? null;
    },

    async listReleases(options) {
      return [...releases.values()]
        .filter((r) => !options.publishedOnly || r.status === "published")
        .sort((a, b) => (b.publishedAt ?? b.updatedAt) - (a.publishedAt ?? a.updatedAt));
    },

    async setTestServe(uid, creativeId) {
      testServes.set(uid, creativeId);
    },

    async takeTestServe(uid) {
      const found = testServes.get(uid) ?? null;
      if (found !== null) testServes.delete(uid);
      return found;
    },

    async getConfig() {
      return config;
    },

    async putConfig(next) {
      config = next;
    },

    async writeAudit(record) {
      audit.push(record);
    },

    async listAudit() {
      return [...audit];
    },

    async isAdmin(email) {
      return admins.has(email.toLowerCase());
    },

    async listAdmins() {
      return [...admins.values()].sort((a, b) => b.addedAt - a.addedAt || a.email.localeCompare(b.email));
    },

    async addAdmin(record) {
      const email = record.email.toLowerCase();
      if (admins.has(email)) return false;
      admins.set(email, { ...record, email });
      return true;
    },

    async removeAdmin(email) {
      return admins.delete(email.toLowerCase());
    },

    async countAdmins() {
      return admins.size;
    },
  };
}
