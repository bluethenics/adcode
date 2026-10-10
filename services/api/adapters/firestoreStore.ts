/**
 * The `Store` port against Firestore.
 *
 * Spec D2: this is the only file that knows Firestore exists. Everything above it is
 * tested against `memoryStore.ts`, so a bug here is a translation bug - which is why the
 * emulator tests check exactly the translation: bigint to int64 and back, the atomicity
 * of the append, and the idempotency of receipt creation.
 *
 * Firestore stores integers as int64 natively, but the JS client hands them back as
 * `number`, which silently loses precision above 2^53. Micros are therefore written as
 * strings and converted at the boundary. That costs a little space and buys exactness.
 */
import { applyEntry, EMPTY_BALANCE, type Balance, type LedgerEntry } from "../src/ledger.ts";
import { planBudgetMove } from "../src/campaignBudget.ts";
import { utcDay } from "../src/day.ts";
import { countDevelopers, sightings, summarizeGrowth, type ActivityRow, type MilestoneRow, type PresenceRow } from "../src/growth.ts";
import {
  BAD_ORDER_STATUSES,
  DAY_MS,
  entriesForShares,
  planReferralShares,
  sourceFactsFrom,
  summarizeReferrer,
} from "../src/referrals.ts";
import { DEFAULT_REFERRAL_CONFIG, type AttributionRecord, type RefCodeRecord, type ReferralShareRecord } from "../src/store.ts";
import {
  decryptDestination,
  encryptDestination,
  maskDestination,
  type EncryptedDestination,
} from "../src/payoutCrypto.ts";
import type {
  ActivityDay,
  ActivityDelta,
  AdvertiserRecord,
  AdminRecord,
  AuditRecord,
  CampaignStats,
  CampaignRecord,
  CreativeRecord,
  CreditOrderRecord,
  EntryPage,
  Page,
  ReceiptRecord,
  NoticeRecord,
  PostRecord,
  ReleaseRecord,
  PayoutProfileRecord,
  PayoutCorridorRecord,
  ReportPage,
  ReportRecord,
  WithdrawalPage,
  WithdrawalRecord,
  WithdrawalStatus,
  SeriesPoint,
  UserPage,
  ServeRecord,
  ServingConfig,
  Store,
  UserRecord,
} from "../src/store.ts";

type Firestore = import("firebase-admin/firestore").Firestore;

const DEFAULT_SHARD_COUNT = 4;
const DEFAULT_SERVE_TTL_MS = 600_000;
const DEFAULT_RATE_WINDOW_MS = 60_000;
const DEFAULT_REQUESTS_PER_WINDOW = 120;
const DEFAULT_FLOOR_CPM_MICROS = 2_000_000n;
const DEFAULT_AUCTION_INCREMENT_CPM_MICROS = 20_000n;

const toMicros = (v: unknown): bigint => BigInt(typeof v === "string" ? v : "0");

/**
 * A withdrawal, with its one money field as a string.
 *
 * Firestore has no bigint and its number type is a double, so an amount stored as a
 * number would be a rounded amount. The same rule the ledger and the advertiser balances
 * already follow here; only the field that is money goes through it.
 */
function toWithdrawalDoc(w: WithdrawalRecord, key: string): Record<string, unknown> {
  return {
    withdrawalId: w.withdrawalId,
    uid: w.uid,
    amountMicros: w.amountMicros.toString(),
    status: w.status,
    encryptedDestination: encryptDestination(key, w.destination),
    destinationMask: maskDestination(w.destination),
    createdAt: w.createdAt,
    decidedAt: w.decidedAt,
    decidedBy: w.decidedBy,
    providerRef: w.providerRef,
    note: w.note,
    evidence: w.evidence ?? null,
  };
}

function fromWithdrawalDoc(raw: Record<string, unknown>, key: string): WithdrawalRecord {
  const encrypted = raw["encryptedDestination"] as EncryptedDestination | undefined;
  const destination = encrypted === undefined
    ? (raw["destination"] as WithdrawalRecord["destination"])
    : decryptDestination(key, encrypted);
  return {
    ...(raw as Omit<WithdrawalRecord, "amountMicros" | "destination">),
    amountMicros: toMicros(raw["amountMicros"]),
    destination,
  };
}

const fromMicros = (v: bigint): string => v.toString();

/**
 * Everything `sightings` reads, from every collection that says an account was seen. This
 * adapter is not what production runs on (Supabase counts it in SQL), so whole-collection
 * reads are an acceptable price for one definition shared with the other stores.
 */
async function readSightings(database: Firestore): Promise<{
  serves: ServeRecord[];
  activity: ActivityRow[];
  milestones: MilestoneRow[];
  milestoneDays: PresenceRow[];
}> {
  const [serves, activity, milestones, days] = await Promise.all([
    database.collection("serves").select("uid", "servedAt", "test").get(),
    database.collection("activity").select("uid", "day", "firstAt", "updatedAt").get(),
    database.collection("milestones").select("uid", "name", "firstAt", "lastAt").get(),
    database.collection("milestoneDays").select("uid", "day", "firstAt", "lastAt").get(),
  ]);
  const time = (value: unknown): number | null => (typeof value === "number" ? value : null);
  return {
    serves: serves.docs.map((doc) => ({ uid: String(doc.data()["uid"]), servedAt: Number(doc.data()["servedAt"]), test: doc.data()["test"] === true }) as ServeRecord),
    activity: activity.docs.map((doc) => ({
      uid: String(doc.data()["uid"]),
      day: String(doc.data()["day"]),
      firstAt: time(doc.data()["firstAt"]),
      lastAt: time(doc.data()["updatedAt"]),
    })),
    milestones: milestones.docs.map((doc): MilestoneRow => ({
      uid: String(doc.data()["uid"]),
      name: String(doc.data()["name"]),
      firstAt: Number(doc.data()["firstAt"] ?? 0),
      lastAt: Number(doc.data()["lastAt"] ?? 0),
    })),
    milestoneDays: days.docs.map((doc): PresenceRow => ({
      uid: String(doc.data()["uid"]),
      day: String(doc.data()["day"]),
      firstAt: Number(doc.data()["firstAt"] ?? 0),
      lastAt: Number(doc.data()["lastAt"] ?? 0),
    })),
  };
}

export function createFirestoreStore(injected?: Firestore, injectedPayoutKey?: string): Store {
  let db: Firestore | undefined = injected;

  const payoutKey = (): string => {
    const key = injectedPayoutKey ?? process.env["PAYOUT_ENCRYPTION_KEY"];
    if (key === undefined || key === "") {
      throw new Error("PAYOUT_ENCRYPTION_KEY is required for payout data");
    }
    return key;
  };

  const lazy = async (): Promise<Firestore> => {
    if (db !== undefined) return db;
    const { getFirestore } = await import("firebase-admin/firestore");
    const { initializeApp, getApps } = await import("firebase-admin/app");
    if (getApps().length === 0) initializeApp();
    db = getFirestore();
    return db;
  };

  const store: Store = {
    async getUser(uid) {
      const snap = await (await lazy()).collection("users").doc(uid).get();
      return snap.exists ? (snap.data() as UserRecord) : null;
    },

    async putUser(user) {
      await (await lazy()).collection("users").doc(user.uid).set(user);
    },

    async putAdvertiser(a: AdvertiserRecord) {
      await (await lazy())
        .collection("advertisers")
        .doc(a.advertiserId)
        .set({
          ...a,
          fundedMicros: fromMicros(a.fundedMicros),
          reservedMicros: fromMicros(a.reservedMicros),
        });
    },

    async getAdvertiser(advertiserId) {
      const snap = await (await lazy()).collection("advertisers").doc(advertiserId).get();
      if (!snap.exists) return null;
      const raw = snap.data() ?? {};
      return {
        ...(raw as Omit<AdvertiserRecord, "fundedMicros" | "reservedMicros">),
        fundedMicros: toMicros(raw["fundedMicros"]),
        reservedMicros: toMicros(raw["reservedMicros"]),
      };
    },

    async advertiserForOwner(uid) {
      const snap = await (await lazy())
        .collection("advertisers")
        .where("ownerUids", "array-contains", uid)
        .limit(1)
        .get();
      const doc = snap.docs[0];
      if (doc === undefined) return null;
      const raw = doc.data();
      return {
        ...(raw as Omit<AdvertiserRecord, "fundedMicros" | "reservedMicros">),
        fundedMicros: toMicros(raw["fundedMicros"]),
        reservedMicros: toMicros(raw["reservedMicros"]),
      };
    },

    async getCampaign(campaignId) {
      const snap = await (await lazy()).collection("campaigns").doc(campaignId).get();
      if (!snap.exists) return null;
      const raw = snap.data() ?? {};
      return {
        ...(raw as Omit<CampaignRecord, "cpmMicros" | "budgetMicros">),
        cpmMicros: toMicros(raw["cpmMicros"]),
        budgetMicros: toMicros(raw["budgetMicros"]),
      };
    },

    async campaignsForAdvertiser(advertiserId) {
      const snap = await (await lazy())
        .collection("campaigns")
        .where("advertiserId", "==", advertiserId)
        .orderBy("createdAt", "desc")
        .get();
      return snap.docs.map((d) => {
        const raw = d.data();
        return {
          ...(raw as Omit<CampaignRecord, "cpmMicros" | "budgetMicros">),
          cpmMicros: toMicros(raw["cpmMicros"]),
          budgetMicros: toMicros(raw["budgetMicros"]),
        };
      });
    },

    async publicStats(now) {
      const database = await lazy();
      // Micros are stored as decimal strings; positive values sort after "0".
      // Developers are accounts that have done something, the rule `growthStats` uses. This
      // adapter is not what production runs on (Supabase counts it in SQL), so reading the
      // uids of every serve, activity day and milestone is an acceptable price here.
      const [receipts, campaigns, users, sources] = await Promise.all([
        database.collection("receipts").where("costMicros", ">", "0").select("outcome").get(),
        database.collection("campaigns").where("status", "==", "active").count().get(),
        database.collection("users").select("status", "createdAt").get(),
        readSightings(database),
      ]);
      const clicks = receipts.docs.filter((doc) => doc.data()["outcome"] === "click").length;
      const developers = countDevelopers(
        now,
        users.docs.map((doc) => ({ uid: doc.id, status: doc.data()["status"], createdAt: Number(doc.data()["createdAt"] ?? 0) }) as UserRecord),
        sightings(sources),
      );
      return { impressions: receipts.size - clicks, clicks, activeCampaigns: campaigns.data().count, ...developers };
    },

    async growthStats(now) {
      const database = await lazy();
      // Admin-only and read on demand, so whole-collection reads are acceptable here: "ever
      // seen" and "came back" reach back to each sign-up, not just the 30-day window.
      const [users, receipts, sources, paid] = await Promise.all([
        database.collection("users").select("status", "createdAt").get(),
        database.collection("receipts").where("costMicros", ">", "0").select("outcome", "costMicros", "creditedMicros", "createdAt").get(),
        readSightings(database),
        database.collection("withdrawals").where("status", "==", "paid").select("amountMicros", "status").get(),
      ]);
      return summarizeGrowth({
        now,
        users: users.docs.map((doc) => ({ uid: doc.id, status: doc.data()["status"], createdAt: Number(doc.data()["createdAt"] ?? 0) }) as UserRecord),
        receipts: receipts.docs.map((doc) => ({
          outcome: String(doc.data()["outcome"]),
          costMicros: toMicros(doc.data()["costMicros"]),
          creditedMicros: toMicros(doc.data()["creditedMicros"]),
          createdAt: Number(doc.data()["createdAt"] ?? 0),
        }) as ReceiptRecord),
        ...sources,
        withdrawals: paid.docs.map((doc) => ({ amountMicros: toMicros(doc.data()["amountMicros"]), status: String(doc.data()["status"]) })),
      });
    },

    async statsForCampaign(campaignId): Promise<CampaignStats> {
      const database = await lazy();

      // `count()` is an aggregation query - it bills a fraction of a read rather than one
      // read per document, which matters for a campaign with millions of serves.
      const serveCount = await database
        .collection("serves")
        .where("campaignId", "==", campaignId)
        .count()
        .get();

      const receiptSnap = await database
        .collection("receipts")
        .where("campaignId", "==", campaignId)
        .get();

      let impressions = 0;
      let clicks = 0;
      let spentMicros = 0n;

      for (const doc of receiptSnap.docs) {
        const raw = doc.data();
        const cost = toMicros(raw["costMicros"]);
        // A zero-cost receipt is an admin test card, not a view anybody bought.
        if (cost === 0n) continue;
        if (raw["outcome"] === "click") clicks += 1;
        else impressions += 1;
        spentMicros += cost;
      }

      return {
        campaignId,
        serves: serveCount.data().count,
        impressions,
        clicks,
        spentMicros,
      };
    },

    async transitionCampaignCommitment({ advertiserId, campaignId, next, spentMicros }) {
      const database = await lazy();
      const advertiserRef = database.collection("advertisers").doc(advertiserId);
      const campaignRef = database.collection("campaigns").doc(campaignId);
      return database.runTransaction(async (tx) => {
        const [advertiserSnap, campaignSnap] = await Promise.all([
          tx.get(advertiserRef),
          tx.get(campaignRef),
        ]);
        if (!advertiserSnap.exists || !campaignSnap.exists) return { ok: false, reason: "not-found" };
        const advertiserRaw = advertiserSnap.data() ?? {};
        const campaignRaw = campaignSnap.data() ?? {};
        const advertiser: AdvertiserRecord = {
          ...(advertiserRaw as AdvertiserRecord),
          fundedMicros: toMicros(advertiserRaw["fundedMicros"]),
          reservedMicros: toMicros(advertiserRaw["reservedMicros"]),
        };
        const campaign: CampaignRecord = {
          ...(campaignRaw as CampaignRecord),
          cpmMicros: toMicros(campaignRaw["cpmMicros"]),
          budgetMicros: toMicros(campaignRaw["budgetMicros"]),
        };
        if (campaign.advertiserId !== advertiserId) return { ok: false, reason: "not-found" };
        if (campaign.status === "ended") return { ok: false, reason: "invalid-state" };
        if (campaign.status === next) return { ok: true, campaign };
        const remaining = campaign.budgetMicros - spentMicros;
        let reservedMicros: bigint;
        if (next === "active") {
          if (remaining > advertiser.fundedMicros - advertiser.reservedMicros) {
            return { ok: false, reason: "insufficient-funds" };
          }
          reservedMicros = advertiser.reservedMicros + remaining;
        } else {
          reservedMicros = advertiser.reservedMicros - remaining;
          if (reservedMicros < 0n) reservedMicros = 0n;
        }
        const updated = { ...campaign, status: next };
        tx.update(advertiserRef, { reservedMicros: fromMicros(reservedMicros) });
        tx.update(campaignRef, { status: next });
        return { ok: true, campaign: updated };
      });
    },

    async moveCampaignBudget({ advertiserId, fromCampaignId, toCampaignId, amountMicros, maxBudgetMicros }) {
      const database = await lazy();
      const advertiserRef = database.collection("advertisers").doc(advertiserId);
      const fromRef = database.collection("campaigns").doc(fromCampaignId);
      const toRef = database.collection("campaigns").doc(toCampaignId);
      const campaignFrom = (id: string, raw: Record<string, unknown>): CampaignRecord => ({
        ...(raw as Omit<CampaignRecord, "cpmMicros" | "budgetMicros">),
        campaignId: id,
        cpmMicros: toMicros(raw["cpmMicros"]),
        budgetMicros: toMicros(raw["budgetMicros"]),
      });
      return database.runTransaction(async (tx) => {
        // Every spend shard is read in the transaction, so a receipt settling into any of
        // them while this runs makes Firestore retry the move against the new total.
        const [advertiserSnap, fromSnap, toSnap, shards] = await Promise.all([
          tx.get(advertiserRef),
          tx.get(fromRef),
          tx.get(toRef),
          tx.get(fromRef.collection("spendShards")),
        ]);
        if (!advertiserSnap.exists || !fromSnap.exists || !toSnap.exists) {
          return { ok: false, reason: "not-found" } as const;
        }
        const advertiserRaw = advertiserSnap.data() ?? {};
        const advertiser: AdvertiserRecord = {
          ...(advertiserRaw as AdvertiserRecord),
          fundedMicros: toMicros(advertiserRaw["fundedMicros"]),
          reservedMicros: toMicros(advertiserRaw["reservedMicros"]),
        };
        const from = campaignFrom(fromCampaignId, fromSnap.data() ?? {});
        const to = campaignFrom(toCampaignId, toSnap.data() ?? {});
        const plan = planBudgetMove({
          advertiser,
          from,
          to,
          fromSpentMicros: shards.docs.reduce((total, d) => total + toMicros(d.data()["micros"]), 0n),
          amountMicros,
          maxBudgetMicros,
        });
        if (!plan.ok) return plan;

        tx.update(advertiserRef, { reservedMicros: fromMicros(plan.reservedMicros) });
        tx.update(fromRef, { budgetMicros: fromMicros(plan.fromBudgetMicros) });
        tx.update(toRef, { budgetMicros: fromMicros(plan.toBudgetMicros) });
        return {
          ok: true,
          advertiser: { ...advertiser, reservedMicros: plan.reservedMicros },
          from: { ...from, budgetMicros: plan.fromBudgetMicros },
          to: { ...to, budgetMicros: plan.toBudgetMicros },
        } as const;
      });
    },

    async putCampaign(c) {
      await (await lazy())
        .collection("campaigns")
        .doc(c.campaignId)
        .set({
          ...c,
          cpmMicros: fromMicros(c.cpmMicros),
          budgetMicros: fromMicros(c.budgetMicros),
        });
    },

    async activeCampaignsFor(tags) {
      const active = await (await lazy())
        .collection("campaigns")
        .where("status", "==", "active")
        .get();

      const wanted = new Set(tags);
      return active.docs
        .map((d) => {
          const raw = d.data();
          return {
            ...(raw as Omit<CampaignRecord, "cpmMicros" | "budgetMicros">),
            cpmMicros: toMicros(raw["cpmMicros"]),
            budgetMicros: toMicros(raw["budgetMicros"]),
          } as CampaignRecord;
        })
        .filter((c) => c.targetTags.length === 0 || c.targetTags.some((t) => wanted.has(t)));
    },

    /*
     * Artwork as a document, base64 in a field.
     *
     * Firestore has no blob store of its own here, and a document is capped at 1 MB - which
     * `MAX_ASSET_BYTES` (512 kB, ~683 kB base64) stays under. The Supabase adapter uses real
     * object storage; this one only has to be correct, since it is not the deployed path.
     */
    async putAsset(key, asset) {
      let binary = "";
      for (const byte of asset.bytes) binary += String.fromCharCode(byte);

      await (await lazy())
        .collection("assets")
        .doc(key)
        .set({ contentType: asset.contentType, base64: btoa(binary) });
    },

    async getAsset(key) {
      const snap = await (await lazy()).collection("assets").doc(key).get();
      if (!snap.exists) return null;

      const raw = snap.data() as { contentType?: unknown; base64?: unknown };
      if (typeof raw.contentType !== "string" || typeof raw.base64 !== "string") return null;

      const binary = atob(raw.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      return { contentType: raw.contentType, bytes };
    },

    async putCreative(c) {
      await (await lazy()).collection("creatives").doc(c.creativeId).set(c);
    },

    async getCreative(creativeId) {
      const snap = await (await lazy()).collection("creatives").doc(creativeId).get();
      return snap.exists ? (snap.data() as CreativeRecord) : null;
    },

    async creativesForCampaign(campaignId) {
      const snap = await (await lazy())
        .collection("creatives")
        .where("campaignId", "==", campaignId)
        .where("status", "==", "approved")
        .get();
      return snap.docs.map((d) => d.data() as CreativeRecord);
    },

    async allCreativesForCampaign(campaignId) {
      const snap = await (await lazy())
        .collection("creatives")
        .where("campaignId", "==", campaignId)
        .get();
      return snap.docs.map((d) => d.data() as CreativeRecord);
    },

    async recordServe(serve) {
      await (await lazy())
        .collection("serves")
        .doc(serve.serveId)
        .set({
          ...serve,
          maxBidCpmMicros: fromMicros(serve.maxBidCpmMicros),
          clearingCpmMicros: fromMicros(serve.clearingCpmMicros),
          costMicros: fromMicros(serve.costMicros),
        });
    },

    async findServe(uid, creativeId, at, servedBy) {
      const snap = await (await lazy())
        .collection("serves")
        .where("uid", "==", uid)
        .where("creativeId", "==", creativeId)
        .where("expiresAt", ">", at)
        .get();
      // Filter the short-lived delivery window locally to retain the existing
      // Firestore index; a second range on servedAt would need a new index.
      const doc = snap.docs
        .filter((candidate) => servedBy === undefined || candidate.data()["servedAt"] <= servedBy)
        .sort((a, b) => b.data()["servedAt"] - a.data()["servedAt"])[0];
      if (doc === undefined) return null;
      const raw = doc.data();
      return {
        ...(raw as ServeRecord),
        maxBidCpmMicros: toMicros(raw["maxBidCpmMicros"]),
        clearingCpmMicros: toMicros(raw["clearingCpmMicros"]),
        costMicros: toMicros(raw["costMicros"]),
      };
    },

    async marketPriceHistory(since) {
      const snap = await (await lazy())
        .collection("serves")
        .where("servedAt", ">=", since)
        .orderBy("servedAt", "asc")
        .limit(10_000)
        .get();
      const buckets = new Map<number, { total: bigint; count: bigint }>();
      for (const doc of snap.docs) {
        const raw = doc.data();
        if (raw["test"] === true) continue;
        const price = toMicros(raw["clearingCpmMicros"]);
        if (price <= 0n) continue;
        const servedAt = typeof raw["servedAt"] === "number" ? raw["servedAt"] : 0;
        const at = Math.floor(servedAt / 3_600_000) * 3_600_000;
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

    async createReceiptIfAbsent(receipt: ReceiptRecord) {
      const ref = (await lazy()).collection("receipts").doc(receipt.receiptId);
      try {
        // `create` fails if the document exists. That failure IS the idempotency check,
        // and it is atomic in a way a read-then-write never is.
        await ref.create({ ...receipt, creditedMicros: fromMicros(receipt.creditedMicros) });
        return true;
      } catch {
        return false;
      }
    },

    async settleReceipt({ receipt, earning }) {
      const database = await lazy();
      const config = await store.getConfig();
      const shard = Math.floor(Math.random() * config.spendShardCount);
      const receiptRef = database.collection("receipts").doc(receipt.receiptId);
      const entryRef = database.collection("ledger").doc(earning.entryId);
      const balanceRef = database.collection("balances").doc(earning.uid);
      const spendRef = database
        .collection("campaigns")
        .doc(receipt.campaignId)
        .collection("spendShards")
        .doc(String(shard));

      return database.runTransaction(async (tx) => {
        const [existingReceipt, existingEntry, balanceSnap, spendSnap] = await Promise.all([
          tx.get(receiptRef),
          tx.get(entryRef),
          tx.get(balanceRef),
          tx.get(spendRef),
        ]);
        if (existingReceipt.exists) return false;
        if (existingEntry.exists) throw new Error(`ledger entry ${earning.entryId} already exists`);

        const balanceRaw = balanceSnap.data();
        const currentBalance: Balance = balanceSnap.exists
          ? {
              availableMicros: toMicros(balanceRaw?.["availableMicros"]),
              lifetimeMicros: toMicros(balanceRaw?.["lifetimeMicros"]),
              pendingWithdrawalMicros: toMicros(balanceRaw?.["pendingWithdrawalMicros"]),
            }
          : EMPTY_BALANCE;
        const nextBalance = applyEntry(currentBalance, earning);
        const nextSpend = toMicros(spendSnap.data()?.["micros"]) + receipt.costMicros;

        tx.create(receiptRef, {
          ...receipt,
          creditedMicros: fromMicros(receipt.creditedMicros),
          costMicros: fromMicros(receipt.costMicros),
        });
        tx.create(entryRef, { ...earning, micros: fromMicros(earning.micros) });
        tx.set(balanceRef, {
          availableMicros: fromMicros(nextBalance.availableMicros),
          lifetimeMicros: fromMicros(nextBalance.lifetimeMicros),
          pendingWithdrawalMicros: fromMicros(nextBalance.pendingWithdrawalMicros),
        });
        tx.set(spendRef, { micros: fromMicros(nextSpend) });
        return true;
      });
    },

    async seriesForAdvertiser(advertiserId, since): Promise<SeriesPoint[]> {
      const database = await lazy();

      const campaignSnap = await database
        .collection("campaigns")
        .where("advertiserId", "==", advertiserId)
        .get();
      const mine = campaignSnap.docs.map((doc) => doc.id);
      if (mine.length === 0) return [];

      // `in` takes at most thirty values, so campaigns are queried in chunks. An
      // advertiser with more than thirty campaigns is a normal advertiser, not an edge
      // case, and a query that silently truncated at thirty would under-report spend.
      const buckets = new Map<string, SeriesPoint>();

      for (let index = 0; index < mine.length; index += 30) {
        const snap = await database
          .collection("receipts")
          .where("campaignId", "in", mine.slice(index, index + 30))
          .where("createdAt", ">=", since)
          .get();

        for (const doc of snap.docs) {
          const raw = doc.data();
          // Test cards excluded, as in `statsForCampaign`.
          if (toMicros(raw["costMicros"]) === 0n) continue;
          const campaignId = String(raw["campaignId"]);
          const day = utcDay(Number(raw["createdAt"] ?? 0));
          const key = `${day} ${campaignId}`;

          const point = buckets.get(key) ?? {
            day,
            campaignId,
            impressions: 0,
            clicks: 0,
            spentMicros: 0n,
          };

          if (raw["outcome"] === "click") point.clicks += 1;
          else point.impressions += 1;
          point.spentMicros += toMicros(raw["costMicros"]);

          buckets.set(key, point);
        }
      }

      return [...buckets.values()].sort(
        (a, b) => a.day.localeCompare(b.day) || a.campaignId.localeCompare(b.campaignId),
      );
    },

    async addActivity(delta: ActivityDelta) {
      const database = await lazy();
      // Composite id rather than a subcollection: one document per user per day is what
      // the table's primary key means, and it makes the transaction below a single get.
      const ref = database.collection("activity").doc(`${delta.uid}_${delta.day}`);

      await database.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const raw = snap.data();

        if (raw === undefined) {
          tx.set(ref, {
            uid: delta.uid,
            day: delta.day,
            manualChars: delta.manualChars,
            agentChars: delta.agentChars,
            acceptedEdits: delta.acceptedEdits,
            rejectedEdits: delta.rejectedEdits,
            filesTouched: delta.filesTouched,
            activeMs: delta.activeMs,
            sessions: delta.sessions,
            firstAt: delta.at,
            updatedAt: delta.at,
          });
          return;
        }

        const at = (key: string): number => Number(raw[key] ?? 0);

        tx.set(ref, {
          uid: delta.uid,
          day: delta.day,
          manualChars: at("manualChars") + delta.manualChars,
          agentChars: at("agentChars") + delta.agentChars,
          acceptedEdits: at("acceptedEdits") + delta.acceptedEdits,
          rejectedEdits: at("rejectedEdits") + delta.rejectedEdits,
          // Not a sum: the client sends the day's distinct file count, and a file edited
          // twice in a day is one file.
          filesTouched: Math.max(at("filesTouched"), delta.filesTouched),
          activeMs: at("activeMs") + delta.activeMs,
          sessions: at("sessions") + delta.sessions,
          // When the day was first reported; a row written before this field counts from its update.
          firstAt: Number(raw["firstAt"] ?? raw["updatedAt"] ?? delta.at),
          updatedAt: Math.max(at("updatedAt"), delta.at),
        });
      });
    },

    async recordMilestones(uid, items) {
      const database = await lazy();
      for (const item of items) {
        // One document per account per milestone, like the table's primary key, so the
        // transaction is a single get.
        const ref = database.collection("milestones").doc(`${uid}_${item.name}`);
        await database.runTransaction(async (tx) => {
          const raw = (await tx.get(ref)).data();
          tx.set(ref, raw === undefined
            ? { uid, name: item.name, firstAt: item.at, lastAt: item.at, count: 1 }
            : {
                uid,
                name: item.name,
                firstAt: Math.min(Number(raw["firstAt"] ?? item.at), item.at),
                lastAt: Math.max(Number(raw["lastAt"] ?? item.at), item.at),
                count: Number(raw["count"] ?? 0) + 1,
              });
        });
        // And the day it happened on, so a day between the first and the latest is not lost.
        const day = utcDay(item.at);
        const dayRef = database.collection("milestoneDays").doc(`${uid}_${day}`);
        await database.runTransaction(async (tx) => {
          const raw = (await tx.get(dayRef)).data();
          tx.set(dayRef, {
            uid,
            day,
            firstAt: Math.min(Number(raw?.["firstAt"] ?? item.at), item.at),
            lastAt: Math.max(Number(raw?.["lastAt"] ?? item.at), item.at),
          });
        });
      }
    },

    async activityForUser(uid, sinceDay): Promise<ActivityDay[]> {
      const snap = await (await lazy())
        .collection("activity")
        .where("uid", "==", uid)
        .where("day", ">=", sinceDay)
        .orderBy("day", "desc")
        .get();

      return snap.docs.map((doc) => {
        const raw = doc.data();
        const at = (key: string): number => Number(raw[key] ?? 0);
        return {
          day: String(raw["day"]),
          manualChars: at("manualChars"),
          agentChars: at("agentChars"),
          acceptedEdits: at("acceptedEdits"),
          rejectedEdits: at("rejectedEdits"),
          filesTouched: at("filesTouched"),
          activeMs: at("activeMs"),
          sessions: at("sessions"),
        };
      });
    },

    async appendEntryAndUpdateBalance(entry: LedgerEntry) {
      const database = await lazy();
      const entryRef = database.collection("ledger").doc(entry.entryId);
      const balanceRef = database.collection("balances").doc(entry.uid);

      await database.runTransaction(async (tx) => {
        const existing = await tx.get(entryRef);
        if (existing.exists) throw new Error(`ledger entry ${entry.entryId} already exists`);

        const balanceSnap = await tx.get(balanceRef);
        const raw = balanceSnap.data();
        const current: Balance = balanceSnap.exists
          ? {
              availableMicros: toMicros(raw?.["availableMicros"]),
              lifetimeMicros: toMicros(raw?.["lifetimeMicros"]),
              pendingWithdrawalMicros: toMicros(raw?.["pendingWithdrawalMicros"]),
            }
          : EMPTY_BALANCE;

        const next = applyEntry(current, entry);

        tx.set(entryRef, { ...entry, micros: fromMicros(entry.micros) });
        tx.set(balanceRef, {
          availableMicros: fromMicros(next.availableMicros),
          lifetimeMicros: fromMicros(next.lifetimeMicros),
          pendingWithdrawalMicros: fromMicros(next.pendingWithdrawalMicros),
        });
      });
    },

    async getBalance(uid) {
      const snap = await (await lazy()).collection("balances").doc(uid).get();
      if (!snap.exists) return EMPTY_BALANCE;
      const raw = snap.data();
      return {
        availableMicros: toMicros(raw?.["availableMicros"]),
        lifetimeMicros: toMicros(raw?.["lifetimeMicros"]),
        pendingWithdrawalMicros: toMicros(raw?.["pendingWithdrawalMicros"]),
      };
    },

    async listEntries(uid, page: Page): Promise<EntryPage> {
      const database = await lazy();
      let q = database
        .collection("ledger")
        .where("uid", "==", uid)
        .orderBy("createdAt", "desc")
        .limit(page.limit + 1);

      if (page.cursor !== null) {
        const cursorSnap = await database.collection("ledger").doc(page.cursor).get();
        if (cursorSnap.exists) q = q.startAfter(cursorSnap);
      }

      const snap = await q.get();
      const docs = snap.docs.slice(0, page.limit);
      const rows = docs.map((d) => {
        const raw = d.data();
        return { ...(raw as LedgerEntry), micros: toMicros(raw["micros"]) };
      });
      const more = snap.docs.length > page.limit;
      const last = rows.at(-1);

      return { rows, nextCursor: more && last !== undefined ? last.entryId : null };
    },

    async addSpend(campaignId, micros) {
      const database = await lazy();
      const config = await store.getConfig();

      // Sharded so a popular campaign is not bottlenecked on Firestore's ~1 write/sec
      // per document (spec §5.2).
      const shard = Math.floor(Math.random() * config.spendShardCount);
      const ref = database
        .collection("campaigns")
        .doc(campaignId)
        .collection("spendShards")
        .doc(String(shard));

      await database.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const current = toMicros(snap.data()?.["micros"]);
        tx.set(ref, { micros: fromMicros(current + micros) });
      });
    },

    async getSpend(campaignId) {
      const snap = await (await lazy())
        .collection("campaigns")
        .doc(campaignId)
        .collection("spendShards")
        .get();
      return snap.docs.reduce((total, d) => total + toMicros(d.data()["micros"]), 0n);
    },

    async bumpRequestCount(uid, windowStart) {
      const database = await lazy();
      const ref = database.collection("rateCounters").doc(`${uid}:${windowStart}`);

      return database.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const raw = snap.data()?.["count"];
        const next = (typeof raw === "number" ? raw : 0) + 1;
        // `expiresAt` exists for a Firestore TTL policy to reap these; without one the
        // collection grows without bound, one document per user per window.
        tx.set(ref, { count: next, expiresAt: windowStart + 3_600_000 });
        return next;
      });
    },

    async createCreditOrder(order) {
      await (await lazy())
        .collection("creditOrders")
        .doc(order.orderId)
        .create({ ...order, amountMicros: fromMicros(order.amountMicros) });
    },

    async getCreditOrder(orderId) {
      const snap = await (await lazy()).collection("creditOrders").doc(orderId).get();
      if (!snap.exists) return null;
      const raw = snap.data() ?? {};
      return {
        ...(raw as CreditOrderRecord),
        amountMicros: toMicros(raw["amountMicros"]),
      };
    },

    async putCreditOrder(order) {
      await (await lazy())
        .collection("creditOrders")
        .doc(order.orderId)
        .set({ ...order, amountMicros: fromMicros(order.amountMicros) });
    },

    async listCreditOrders(advertiserId) {
      const snap = await (await lazy())
        .collection("creditOrders")
        .where("advertiserId", "==", advertiserId)
        .orderBy("createdAt", "desc")
        .get();
      return snap.docs.map((doc) => {
        const raw = doc.data();
        return { ...(raw as CreditOrderRecord), amountMicros: toMicros(raw["amountMicros"]) };
      });
    },

    async applyCreditEvent(event) {
      const database = await lazy();
      const objectId =
        event.type === "purchase"
          ? `purchase:${event.paymentId}`
          : event.type === "refund"
            ? `refund:${event.refundId}`
            : `${event.type}:${event.disputeId}`;
      const order =
        event.type === "purchase"
          ? await store.getCreditOrder(event.orderId)
          : await (async () => {
              const snap = await database
                .collection("creditOrders")
                .where("providerPaymentId", "==", event.paymentId)
                .limit(1)
                .get();
              const doc = snap.docs[0];
              if (doc === undefined) return null;
              const raw = doc.data();
              return { ...(raw as CreditOrderRecord), amountMicros: toMicros(raw["amountMicros"]) };
            })();
      if (order === null) return { applied: false, reason: "ignored" };

      const eventRef = database.collection("providerEvents").doc(event.webhookId);
      const objectRef = database.collection("providerObjects").doc(encodeURIComponent(objectId));
      const orderRef = database.collection("creditOrders").doc(order.orderId);
      const advertiserRef = database.collection("advertisers").doc(order.advertiserId);
      const disputeRef =
        event.type === "dispute-opened" ||
        event.type === "dispute-final" ||
        event.type === "dispute-release"
          ? database.collection("disputeDebits").doc(event.disputeId)
          : null;

      // Live campaigns, so an advertiser pushed underwater can be paused inside the same
      // transaction. Every read has to happen before the first write, so it is gathered
      // here whether or not it turns out to be needed.
      const activeCampaigns = database
        .collection("campaigns")
        .where("advertiserId", "==", order.advertiserId)
        .where("status", "==", "active");

      return database.runTransaction(async (tx) => {
        const reads = await Promise.all([
          tx.get(eventRef),
          tx.get(objectRef),
          tx.get(orderRef),
          tx.get(advertiserRef),
          ...(disputeRef === null ? [] : [tx.get(disputeRef)]),
        ]);
        const campaignDocs = event.type === "purchase" ? [] : (await tx.get(activeCampaigns)).docs;
        if (reads[0]?.exists || reads[1]?.exists) return { applied: false, reason: "duplicate" };
        const rawAdvertiser = reads[3]?.data();
        if (rawAdvertiser === undefined) return { applied: false, reason: "ignored" };
        const advertiser = {
          ...(rawAdvertiser as AdvertiserRecord),
          fundedMicros: toMicros(rawAdvertiser["fundedMicros"]),
          reservedMicros: toMicros(rawAdvertiser["reservedMicros"]),
        };
        tx.create(eventRef, { type: event.type, objectId, at: Date.now() });
        tx.create(objectRef, { webhookId: event.webhookId });

        if (event.type === "purchase") {
          const valid =
            order.amountMicros === event.amountMicros &&
            order.currency === event.currency &&
            order.providerSessionId === event.sessionId &&
            order.status === "checkout_created";
          if (!valid) {
            tx.update(orderRef, { status: "review_required", updatedAt: Date.now() });
            return { applied: false, reason: "review_required" };
          }
          tx.update(advertiserRef, {
            fundedMicros: fromMicros(advertiser.fundedMicros + order.amountMicros),
          });
          tx.update(orderRef, {
            status: "paid",
            netMicros: fromMicros(order.amountMicros),
            providerPaymentId: event.paymentId,
            updatedAt: Date.now(),
          });
          return { applied: true, reason: "applied", advertiserId: advertiser.advertiserId };
        }

        // What this order still counts for, tracked on the order itself. A reversal has two
        // ceilings and the order's is the one that used to be missing: a refund can never
        // take back more than this order was worth, however much the event claims.
        const net = toMicros((reads[2]?.data() ?? {})["netMicros"] ?? order.amountMicros);

        let delta = 0n;
        if (event.type === "refund" || event.type === "dispute-opened") {
          const absorbable = net > 0n ? net : 0n;
          const funded = advertiser.fundedMicros > 0n ? advertiser.fundedMicros : 0n;
          const ceiling = absorbable < funded ? absorbable : funded;
          const removed = event.amountMicros < ceiling ? event.amountMicros : ceiling;
          delta = -removed;
          if (event.type === "dispute-opened" && disputeRef !== null) {
            tx.set(disputeRef, { micros: fromMicros(removed) });
          }
        } else if (event.type === "dispute-release") {
          delta = toMicros(reads[4]?.data()?.["micros"]);
        }
        // `dispute-final` moves nothing - the money left when the dispute opened - but it
        // still settles the order below. It used to fall through to a recompute that
        // marked a lost chargeback as `paid`.
        const orderNet = net + delta;

        const fundedMicros = advertiser.fundedMicros + delta;
        const underfunded = fundedMicros < advertiser.reservedMicros;
        tx.update(advertiserRef, {
          fundedMicros: fromMicros(fundedMicros),
          ...(underfunded ? { status: "suspended" } : {}),
        });
        // The SQL and memory stores both pause an underfunded advertiser's live campaigns;
        // this one did not, which is the drift that comes of three implementations.
        if (underfunded) {
          for (const campaign of campaignDocs) {
            tx.update(campaign.ref, { status: "paused" });
          }
        }
        tx.update(orderRef, {
          netMicros: fromMicros(orderNet),
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
          updatedAt: Date.now(),
        });
        return { applied: true, reason: "applied", advertiserId: advertiser.advertiserId };
      });
    },

    async createReport(report: ReportRecord) {
      await (await lazy()).collection("reports").doc(report.reportId).set(report);
    },

    async listReports(page: Page): Promise<ReportPage> {
      const database = await lazy();
      let q = database.collection("reports").orderBy("createdAt", "desc").limit(page.limit + 1);

      if (page.cursor !== null) {
        const cursorSnap = await database.collection("reports").doc(page.cursor).get();
        if (cursorSnap.exists) q = q.startAfter(cursorSnap);
      }

      const snap = await q.get();
      const rows = snap.docs.slice(0, page.limit).map((d) => d.data() as ReportRecord);
      const more = snap.docs.length > page.limit;
      const last = rows.at(-1);

      return { rows, nextCursor: more && last !== undefined ? last.reportId : null };
    },

    async getReport(reportId: string) {
      const snap = await (await lazy()).collection("reports").doc(reportId).get();
      return snap.exists ? (snap.data() as ReportRecord) : null;
    },

    async setReportStatus(reportId: string, status: ReportRecord["status"]) {
      const doc = (await lazy()).collection("reports").doc(reportId);
      const snap = await doc.get();
      if (!snap.exists) return false;
      await doc.update({ status });
      return true;
    },

    async deleteReport(reportId: string) {
      const doc = (await lazy()).collection("reports").doc(reportId);
      const snap = await doc.get();
      if (!snap.exists) return false;
      await doc.delete();
      return true;
    },

    async getPayoutProfile(uid: string): Promise<PayoutProfileRecord | null> {
      const snap = await (await lazy()).collection("payoutProfiles").doc(uid).get();
      if (!snap.exists) return null;
      const raw = snap.data() as Record<string, unknown>;
      const encrypted = raw["encryptedDestination"] as EncryptedDestination | undefined;
      if (encrypted === undefined) {
        payoutKey();
        return raw as unknown as PayoutProfileRecord;
      }
      const confirmed = raw["adultConfirmedAt"];
      return {
        uid,
        ...decryptDestination(payoutKey(), encrypted),
        // Null on a profile written before the confirmation was asked for.
        adultConfirmedAt: typeof confirmed === "number" ? confirmed : null,
        updatedAt: Number(raw["updatedAt"]),
      };
    },

    async putPayoutProfile(profile: PayoutProfileRecord) {
      await (await lazy()).collection("payoutProfiles").doc(profile.uid).set({
        uid: profile.uid,
        encryptedDestination: encryptDestination(payoutKey(), profile),
        destinationMask: maskDestination(profile),
        // Outside the encrypted blob: it is not a bank coordinate, and the eligibility
        // check reads it on every dashboard load without needing the payout key.
        adultConfirmedAt: profile.adultConfirmedAt,
        updatedAt: profile.updatedAt,
      });
    },

    async getPayoutCorridor(country, currency) {
      const snap = await (await lazy()).collection("payoutCorridors").doc(`${country}:${currency}`).get();
      return snap.exists ? (snap.data() as PayoutCorridorRecord) : null;
    },

    async putPayoutCorridor(corridor) {
      await (await lazy())
        .collection("payoutCorridors")
        .doc(`${corridor.country}:${corridor.currency}`)
        .set(corridor);
    },

    async listPayoutCorridors(enabledOnly) {
      const collection = (await lazy()).collection("payoutCorridors");
      const snap = await (enabledOnly ? collection.where("enabled", "==", true) : collection).get();
      return snap.docs
        .map((doc) => doc.data() as PayoutCorridorRecord)
        .sort((a, b) => a.country.localeCompare(b.country) || a.currency.localeCompare(b.currency));
    },

    async createWithdrawal(withdrawal: WithdrawalRecord) {
      await (await lazy())
        .collection("withdrawals")
        .doc(withdrawal.withdrawalId)
        .set(toWithdrawalDoc(withdrawal, payoutKey()));
    },

    async reserveWithdrawal(withdrawal, entry) {
      const database = await lazy();
      const withdrawalRef = database.collection("withdrawals").doc(withdrawal.withdrawalId);
      const entryRef = database.collection("ledger").doc(entry.entryId);
      const balanceRef = database.collection("balances").doc(withdrawal.uid);
      const inFlightQuery = database
        .collection("withdrawals")
        .where("uid", "==", withdrawal.uid)
        .where("status", "in", ["requested", "approved"])
        .limit(1);

      return database.runTransaction<"created" | "in-flight" | "insufficient-funds">(async (tx) => {
        const [inFlight, existingEntry, balanceSnap] = await Promise.all([
          tx.get(inFlightQuery),
          tx.get(entryRef),
          tx.get(balanceRef),
        ]);
        if (!inFlight.empty) return "in-flight";
        if (existingEntry.exists) throw new Error(`ledger entry ${entry.entryId} already exists`);
        const raw = balanceSnap.data();
        const current: Balance = balanceSnap.exists
          ? {
              availableMicros: toMicros(raw?.["availableMicros"]),
              lifetimeMicros: toMicros(raw?.["lifetimeMicros"]),
              pendingWithdrawalMicros: toMicros(raw?.["pendingWithdrawalMicros"]),
            }
          : EMPTY_BALANCE;
        if (current.availableMicros < withdrawal.amountMicros) return "insufficient-funds";
        const next = applyEntry(current, entry);
        tx.create(withdrawalRef, toWithdrawalDoc(withdrawal, payoutKey()));
        tx.create(entryRef, { ...entry, micros: fromMicros(entry.micros) });
        tx.set(balanceRef, {
          availableMicros: fromMicros(next.availableMicros),
          lifetimeMicros: fromMicros(next.lifetimeMicros),
          pendingWithdrawalMicros: fromMicros(next.pendingWithdrawalMicros),
        });
        return "created";
      });
    },

    async transitionWithdrawal(input) {
      const database = await lazy();
      const withdrawalRef = database.collection("withdrawals").doc(input.withdrawalId);
      const entryRef = input.entry === undefined
        ? null
        : database.collection("ledger").doc(input.entry.entryId);

      return database.runTransaction<boolean>(async (tx) => {
        const withdrawalSnap = await tx.get(withdrawalRef);
        if (!withdrawalSnap.exists) return false;
        const current = fromWithdrawalDoc(
          withdrawalSnap.data() as Record<string, unknown>,
          payoutKey(),
        );
        if (!input.expectedStatuses.includes(current.status)) return false;

        if (input.entry !== undefined && entryRef !== null) {
          const balanceRef = database.collection("balances").doc(current.uid);
          const [existingEntry, balanceSnap] = await Promise.all([tx.get(entryRef), tx.get(balanceRef)]);
          if (existingEntry.exists) return false;
          const raw = balanceSnap.data();
          const balance: Balance = balanceSnap.exists
            ? {
                availableMicros: toMicros(raw?.["availableMicros"]),
                lifetimeMicros: toMicros(raw?.["lifetimeMicros"]),
                pendingWithdrawalMicros: toMicros(raw?.["pendingWithdrawalMicros"]),
              }
            : EMPTY_BALANCE;
          const nextBalance = applyEntry(balance, input.entry);
          tx.create(entryRef, { ...input.entry, micros: fromMicros(input.entry.micros) });
          tx.set(balanceRef, {
            availableMicros: fromMicros(nextBalance.availableMicros),
            lifetimeMicros: fromMicros(nextBalance.lifetimeMicros),
            pendingWithdrawalMicros: fromMicros(nextBalance.pendingWithdrawalMicros),
          });
        }

        tx.update(withdrawalRef, {
          status: input.status,
          decidedAt: input.decidedAt,
          decidedBy: input.decidedBy,
          providerRef: input.providerRef,
          note: input.note,
          evidence: input.evidence ?? null,
        });
        return true;
      });
    },

    async getWithdrawal(withdrawalId: string): Promise<WithdrawalRecord | null> {
      const snap = await (await lazy()).collection("withdrawals").doc(withdrawalId).get();
      return snap.exists ? fromWithdrawalDoc(snap.data() as Record<string, unknown>, payoutKey()) : null;
    },

    async putWithdrawal(withdrawal: WithdrawalRecord) {
      await (await lazy())
        .collection("withdrawals")
        .doc(withdrawal.withdrawalId)
        .set(toWithdrawalDoc(withdrawal, payoutKey()));
    },

    async withdrawalsForUser(uid: string): Promise<WithdrawalRecord[]> {
      const snap = await (await lazy())
        .collection("withdrawals")
        .where("uid", "==", uid)
        .orderBy("createdAt", "desc")
        .get();
      return snap.docs.map((d) => fromWithdrawalDoc(d.data() as Record<string, unknown>, payoutKey()));
    },

    async listWithdrawals(
      status: WithdrawalStatus | null,
      page: Page,
    ): Promise<WithdrawalPage> {
      const database = await lazy();
      let q = database.collection("withdrawals").orderBy("createdAt", "desc").limit(page.limit + 1);
      if (status !== null) q = q.where("status", "==", status) as typeof q;

      if (page.cursor !== null) {
        const cursorSnap = await database.collection("withdrawals").doc(page.cursor).get();
        if (cursorSnap.exists) q = q.startAfter(cursorSnap);
      }

      const snap = await q.get();
      const rows = snap.docs
        .slice(0, page.limit)
        .map((d) => fromWithdrawalDoc(d.data() as Record<string, unknown>, payoutKey()));
      const more = snap.docs.length > page.limit;
      const last = rows.at(-1);

      return { rows, nextCursor: more && last !== undefined ? last.withdrawalId : null };
    },

    async listUsers(page: Page): Promise<UserPage> {
      const database = await lazy();
      let q = database.collection("users").orderBy("createdAt", "desc").limit(page.limit + 1);
      if (page.cursor !== null) {
        const cursorSnap = await database.collection("users").doc(page.cursor).get();
        if (cursorSnap.exists) q = q.startAfter(cursorSnap);
      }
      const snap = await q.get();
      const rows = snap.docs.slice(0, page.limit).map((d) => d.data() as UserRecord);
      const more = snap.docs.length > page.limit;
      const last = rows.at(-1);
      return { rows, nextCursor: more && last !== undefined ? last.uid : null };
    },

    async listAdvertisers() {
      const snap = await (await lazy()).collection("advertisers").orderBy("createdAt", "desc").get();
      return snap.docs.map((d) => {
        const raw = d.data();
        return {
          ...(raw as Omit<AdvertiserRecord, "fundedMicros" | "reservedMicros">),
          fundedMicros: toMicros(raw["fundedMicros"]),
          reservedMicros: toMicros(raw["reservedMicros"]),
        };
      });
    },

    async putNotice(notice: NoticeRecord) {
      await (await lazy()).collection("notices").doc(notice.noticeId).set(notice);
    },

    async getNotice(noticeId) {
      const snap = await (await lazy()).collection("notices").doc(noticeId).get();
      return snap.exists ? (snap.data() as NoticeRecord) : null;
    },

    async listNotices(options) {
      const base = (await lazy()).collection("notices");
      const snap = await (options.activeOnly ? base.where("active", "==", true) : base).get();
      return snap.docs
        .map((d) => d.data() as NoticeRecord)
        .sort((a, b) => b.createdAt - a.createdAt);
    },

    async creativesByStatus(status) {
      const snap = await (await lazy()).collection("creatives").where("status", "==", status).get();
      return snap.docs.map((d) => d.data() as CreativeRecord);
    },

    async putPost(post: PostRecord) {
      await (await lazy()).collection("posts").doc(post.slug).set(post);
    },

    async getPost(slug) {
      const snap = await (await lazy()).collection("posts").doc(slug).get();
      return snap.exists ? (snap.data() as PostRecord) : null;
    },

    async listPosts(options) {
      const database = await lazy();
      const base = database.collection("posts");
      const snap = await (options.publishedOnly ? base.where("status", "==", "published") : base).get();
      return snap.docs
        .map((d) => d.data() as PostRecord)
        .sort((a, b) => (b.publishedAt ?? b.updatedAt) - (a.publishedAt ?? a.updatedAt));
    },

    async putRelease(release: ReleaseRecord) {
      // Keyed by version: one record per version, ever, which is what makes "announced
      // this one already" answerable without a second collection.
      await (await lazy()).collection("releases").doc(release.version).set(release);
    },

    async getRelease(version) {
      const snap = await (await lazy()).collection("releases").doc(version).get();
      return snap.exists ? (snap.data() as ReleaseRecord) : null;
    },

    async listReleases(options) {
      const database = await lazy();
      const base = database.collection("releases");
      const snap = await (options.publishedOnly ? base.where("status", "==", "published") : base).get();
      return snap.docs
        .map((d) => d.data() as ReleaseRecord)
        .sort((a, b) => (b.publishedAt ?? b.updatedAt) - (a.publishedAt ?? a.updatedAt));
    },

    async setTestServe(uid, creativeId) {
      await (await lazy())
        .collection("testServes")
        .doc(uid)
        .set({ creativeId, at: Date.now() });
    },

    async takeTestServe(uid) {
      const ref = (await lazy()).collection("testServes").doc(uid);
      const snap = await ref.get();
      if (!snap.exists) return null;
      const creativeId = snap.data()?.["creativeId"];
      // Deleted on read, so a queued test fires exactly once.
      await ref.delete();
      return typeof creativeId === "string" ? creativeId : null;
    },

    async getConfig(): Promise<ServingConfig> {
      const snap = await (await lazy()).collection("config").doc("serving").get();
      const raw = snap.data() ?? {};
      return {
        killSwitch: raw["killSwitch"] === true,
        caps: (raw["caps"] as ServingConfig["caps"]) ?? {},
        defaultCpmMicros: toMicros(raw["defaultCpmMicros"]),
        floorCpmMicros:
          raw["floorCpmMicros"] === undefined
            ? DEFAULT_FLOOR_CPM_MICROS
            : toMicros(raw["floorCpmMicros"]),
        auctionIncrementCpmMicros:
          raw["auctionIncrementCpmMicros"] === undefined
            ? DEFAULT_AUCTION_INCREMENT_CPM_MICROS
            : toMicros(raw["auctionIncrementCpmMicros"]),
        revSharePercent: toMicros(raw["revSharePercent"]),
        spendShardCount:
          typeof raw["spendShardCount"] === "number" ? raw["spendShardCount"] : DEFAULT_SHARD_COUNT,
        serveTtlMs: typeof raw["serveTtlMs"] === "number" ? raw["serveTtlMs"] : DEFAULT_SERVE_TTL_MS,
        rateWindowMs:
          typeof raw["rateWindowMs"] === "number" ? raw["rateWindowMs"] : DEFAULT_RATE_WINDOW_MS,
        requestsPerWindow:
          typeof raw["requestsPerWindow"] === "number"
            ? raw["requestsPerWindow"]
            : DEFAULT_REQUESTS_PER_WINDOW,
      };
    },

    async recordModelOutcomes(day, items) {
      const db = await lazy();
      // Loaded the way the client is: only when this adapter is actually used.
      const { FieldValue } = await import("firebase-admin/firestore");
      const batch = db.batch();
      const grouped = new Map<string, { provider: string; model: string; outcome: string; count: number; totalMs: number }>();
      for (const item of items) {
        const key = [item.provider, item.model, item.outcome].join("|");
        const row = grouped.get(key) ?? { provider: item.provider, model: item.model, outcome: item.outcome, count: 0, totalMs: 0 };
        row.count += 1;
        row.totalMs += item.ms;
        grouped.set(key, row);
      }
      for (const row of grouped.values()) {
        const id = encodeURIComponent([day, row.provider, row.model, row.outcome].join("|"));
        batch.set(
          db.collection("modelOutcomes").doc(id),
          {
            day,
            provider: row.provider,
            model: row.model,
            outcome: row.outcome,
            count: FieldValue.increment(row.count),
            totalMs: FieldValue.increment(row.totalMs),
          },
          { merge: true },
        );
      }
      await batch.commit();
    },

    async modelOutcomesSince(day) {
      const snap = await (await lazy()).collection("modelOutcomes").where("day", ">=", day).limit(20_000).get();
      return snap.docs.map((doc) => {
        const raw = doc.data();
        return {
          day: String(raw["day"]),
          provider: String(raw["provider"]),
          model: String(raw["model"]),
          outcome: String(raw["outcome"]),
          count: Number(raw["count"] ?? 0),
          totalMs: Number(raw["totalMs"] ?? 0),
        };
      });
    },

    async getModelCatalog() {
      const snap = await (await lazy()).collection("config").doc("modelCatalog").get();
      const raw = snap.data();
      if (raw === undefined) return null;
      return {
        overrides: raw["overrides"] as import("../src/modelCatalog.ts").ModelCatalog,
        updatedAt: typeof raw["updatedAt"] === "number" ? raw["updatedAt"] : 0,
        updatedBy: typeof raw["updatedBy"] === "string" ? raw["updatedBy"] : "",
      };
    },

    async putModelCatalog(record) {
      await (await lazy()).collection("config").doc("modelCatalog").set({ ...record });
    },

    async putConfig(config) {
      await (await lazy())
        .collection("config")
        .doc("serving")
        .set({
          ...config,
          defaultCpmMicros: fromMicros(config.defaultCpmMicros),
          floorCpmMicros: fromMicros(config.floorCpmMicros),
          auctionIncrementCpmMicros: fromMicros(config.auctionIncrementCpmMicros),
          revSharePercent: fromMicros(config.revSharePercent),
        });
    },

    async writeAudit(record: AuditRecord) {
      await (await lazy()).collection("adminAudit").add(record);
    },

    async listAudit() {
      const snap = await (await lazy())
        .collection("adminAudit")
        .orderBy("at", "desc")
        .limit(500)
        .get();
      return snap.docs.map((d) => d.data() as AuditRecord);
    },

    // Administrators, keyed by the lowercased email so the document id *is* the lookup.
    async isAdmin(email: string) {
      const doc = await (await lazy()).collection("admins").doc(email.toLowerCase()).get();
      return doc.exists;
    },

    async listAdmins() {
      const snap = await (await lazy()).collection("admins").orderBy("addedAt", "desc").get();
      return snap.docs.map((d) => d.data() as AdminRecord);
    },

    async addAdmin(record: AdminRecord) {
      const email = record.email.toLowerCase();
      const ref = (await lazy()).collection("admins").doc(email);
      if ((await ref.get()).exists) return false;
      await ref.set({ ...record, email });
      return true;
    },

    async removeAdmin(email: string) {
      const ref = (await lazy()).collection("admins").doc(email.toLowerCase());
      if (!(await ref.get()).exists) return false;
      await ref.delete();
      return true;
    },

    async countAdmins() {
      const snap = await (await lazy()).collection("admins").get();
      return snap.size;
    },

    /*
     * Referrals. This adapter is kept compiling and correct for the emulator suite, not for
     * production (which is Postgres), so the rules come from `referrals.ts` and the reads are
     * whole collections - the same trade `growthStats` above makes.
     */

    async getReferralConfig() {
      const raw = (await (await lazy()).collection("config").doc("referral").get()).data();
      if (raw === undefined) return { ...DEFAULT_REFERRAL_CONFIG, houseAdvertiserIds: [] };
      return {
        userPercent: toMicros(raw["userPercent"]),
        advertiserPercent: toMicros(raw["advertiserPercent"]),
        windowDays: Number(raw["windowDays"]),
        claimDays: Number(raw["claimDays"]),
        houseAdvertiserIds: Array.isArray(raw["houseAdvertiserIds"]) ? raw["houseAdvertiserIds"].map(String) : [],
      };
    },

    async putReferralConfig(config) {
      await (await lazy()).collection("config").doc("referral").set({
        ...config,
        userPercent: fromMicros(config.userPercent),
        advertiserPercent: fromMicros(config.advertiserPercent),
      });
    },

    async getRefCode(code) {
      const snap = await (await lazy()).collection("refCodes").doc(code).get();
      return snap.exists ? (snap.data() as RefCodeRecord) : null;
    },

    async refCodeForOwner(uid) {
      const snap = await (await lazy()).collection("refCodes").where("ownerUid", "==", uid).limit(1).get();
      return snap.empty ? null : (snap.docs[0]!.data() as RefCodeRecord);
    },

    async createRefCode(record) {
      const database = await lazy();
      try {
        // One document per owner as well as per code: Firestore has no unique index, and the
        // `create` on the owner marker is what refuses a second code for the same account.
        await database.runTransaction(async (tx) => {
          const codeRef = database.collection("refCodes").doc(record.code);
          const ownerRef = record.ownerUid === null ? null : database.collection("refCodeOwners").doc(record.ownerUid);
          tx.create(codeRef, record);
          if (ownerRef !== null) tx.create(ownerRef, { code: record.code });
        });
        return true;
      } catch {
        return false;
      }
    },

    async updateRefCode(code, patch) {
      const ref = (await lazy()).collection("refCodes").doc(code);
      const snap = await ref.get();
      if (!snap.exists) return null;
      const next: RefCodeRecord = {
        ...(snap.data() as RefCodeRecord),
        ...(patch.label !== undefined ? { label: patch.label } : {}),
        ...(patch.active !== undefined ? { active: patch.active } : {}),
        ...(patch.showName !== undefined ? { showName: patch.showName } : {}),
      };
      await ref.set(next);
      return next;
    },

    async listCampaignCodes() {
      const snap = await (await lazy()).collection("refCodes").where("ownerUid", "==", null).get();
      return snap.docs.map((d) => d.data() as RefCodeRecord).sort((a, b) => b.createdAt - a.createdAt || a.code.localeCompare(b.code));
    },

    async getAttribution(kind, subjectId) {
      const snap = await (await lazy()).collection("attributions").doc(`${kind}_${subjectId}`).get();
      return snap.exists ? (snap.data() as AttributionRecord) : null;
    },

    async createAttribution(record) {
      try {
        await (await lazy()).collection("attributions").doc(`${record.subjectKind}_${record.subjectId}`).create(record);
        return true;
      } catch {
        return false;
      }
    },

    async settleReferrals(day, now) {
      const database = await lazy();
      const start = Date.parse(`${day}T00:00:00.000Z`);
      const [config, receipts, campaigns, attributions, users, orders] = await Promise.all([
        store.getReferralConfig(),
        database.collection("receipts").where("createdAt", ">=", start).where("createdAt", "<", start + DAY_MS).get(),
        database.collection("campaigns").select("advertiserId").get(),
        database.collection("attributions").get(),
        database.collection("users").select("status").get(),
        database.collection("creditOrders").select("advertiserId", "status").get(),
      ]);
      const shares = planReferralShares({
        day,
        config,
        receipts: receipts.docs.map((d) => {
          const raw = d.data();
          return { ...(raw as ReceiptRecord), costMicros: toMicros(raw["costMicros"]), creditedMicros: toMicros(raw["creditedMicros"]) };
        }),
        campaignAdvertiser: new Map(campaigns.docs.map((d) => [d.id, String(d.data()["advertiserId"])])),
        attributions: attributions.docs.map((d) => d.data() as AttributionRecord),
        userStatus: new Map(users.docs.map((d) => [d.id, d.data()["status"] === "banned" ? "banned" : "active"])),
        badAdvertisers: new Set(
          orders.docs.filter((d) => BAD_ORDER_STATUSES.includes(String(d.data()["status"]))).map((d) => String(d.data()["advertiserId"])),
        ),
      });

      let referrers = 0;
      let micros = 0n;
      for (const entry of entriesForShares(day, now, shares)) {
        try {
          await store.appendEntryAndUpdateBalance(entry);
        } catch {
          continue; // Already paid: the entry id exists.
        }
        const batch = database.batch();
        for (const share of shares.filter((s) => s.referrerUid === entry.uid)) {
          batch.set(database.collection("referralShares").doc(`${day}_${share.referrerUid}_${share.subjectKind}_${share.subjectId}`), {
            ...share,
            baseMicros: fromMicros(share.baseMicros),
            shareMicros: fromMicros(share.shareMicros),
          });
        }
        await batch.commit();
        referrers += 1;
        micros += entry.micros;
      }
      return { referrers, micros };
    },

    async referralSummary(uid, now) {
      const database = await lazy();
      const [attributions, entries, serves, activity, milestones] = await Promise.all([
        database.collection("attributions").where("referrerUid", "==", uid).get(),
        database.collection("ledger").where("uid", "==", uid).where("kind", "==", "referral").get(),
        database.collection("serves").select("uid", "servedAt", "test").get(),
        database.collection("activity").select("uid", "day").get(),
        database.collection("milestones").select("uid", "name", "firstAt", "lastAt").get(),
      ]);
      return summarizeReferrer({
        uid,
        now,
        attributions: attributions.docs.map((d) => d.data() as AttributionRecord),
        sightings: sightings({
          serves: serves.docs.map((d) => ({ uid: String(d.data()["uid"]), servedAt: Number(d.data()["servedAt"]), test: d.data()["test"] === true }) as ServeRecord),
          activity: activity.docs.map((d) => ({ uid: String(d.data()["uid"]), day: String(d.data()["day"]) })),
          milestones: milestones.docs.map((d) => d.data() as MilestoneRow),
        }),
        entries: entries.docs.map((d) => ({ ...(d.data() as LedgerEntry), micros: toMicros(d.data()["micros"]) })),
      });
    },

    async referralSourceFacts(since) {
      const database = await lazy();
      const [config, users, attributions, serves, activity, milestones, receipts, campaigns, shares] = await Promise.all([
        store.getReferralConfig(),
        database.collection("users").select("status", "createdAt").get(),
        database.collection("attributions").get(),
        database.collection("serves").select("uid", "servedAt", "test").get(),
        database.collection("activity").select("uid", "day").get(),
        database.collection("milestones").select("uid", "name", "firstAt", "lastAt").get(),
        database.collection("receipts").get(),
        database.collection("campaigns").select("advertiserId").get(),
        database.collection("referralShares").get(),
      ]);
      return sourceFactsFrom({
        since,
        users: users.docs.map((d) => ({ uid: d.id, status: d.data()["status"], createdAt: Number(d.data()["createdAt"] ?? 0) }) as UserRecord),
        attributions: attributions.docs.map((d) => d.data() as AttributionRecord),
        sightings: sightings({
          serves: serves.docs.map((d) => ({ uid: String(d.data()["uid"]), servedAt: Number(d.data()["servedAt"]), test: d.data()["test"] === true }) as ServeRecord),
          activity: activity.docs.map((d) => ({ uid: String(d.data()["uid"]), day: String(d.data()["day"]) })),
          milestones: milestones.docs.map((d) => d.data() as MilestoneRow),
        }),
        receipts: receipts.docs.map((d) => {
          const raw = d.data();
          return { ...(raw as ReceiptRecord), costMicros: toMicros(raw["costMicros"]), creditedMicros: toMicros(raw["creditedMicros"]) };
        }),
        campaignAdvertiser: new Map(campaigns.docs.map((d) => [d.id, String(d.data()["advertiserId"])])),
        houseAdvertiserIds: config.houseAdvertiserIds,
        shares: shares.docs.map((d) => {
          const raw = d.data();
          return { ...(raw as ReferralShareRecord), baseMicros: toMicros(raw["baseMicros"]), shareMicros: toMicros(raw["shareMicros"]) };
        }),
      });
    },

    async referralsForUser(uid) {
      const database = await lazy();
      const [invitedBy, invited] = await Promise.all([
        store.getAttribution("user", uid),
        database.collection("attributions").where("referrerUid", "==", uid).get(),
      ]);
      return {
        invitedBy,
        invited: invited.docs
          .map((d) => d.data() as AttributionRecord)
          .sort((a, b) => b.claimedAt - a.claimedAt || a.subjectId.localeCompare(b.subjectId)),
      };
    },
  };

  return store;
}
