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
import { utcDay } from "../src/day.ts";
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
  FundingRecord,
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
        if (raw["outcome"] === "click") clicks += 1;
        else impressions += 1;
        spentMicros += toMicros(raw["costMicros"]);
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

    async findServe(uid, creativeId, now) {
      const snap = await (await lazy())
        .collection("serves")
        .where("uid", "==", uid)
        .where("creativeId", "==", creativeId)
        .where("expiresAt", ">", now)
        .limit(1)
        .get();
      const doc = snap.docs[0];
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
          updatedAt: delta.at,
        });
      });
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

    async recordFundingIfAbsent(funding: FundingRecord) {
      const ref = (await lazy()).collection("funding").doc(funding.eventId);
      try {
        // `create` fails if the doc exists; that failure IS the idempotency check, and it
        // is atomic in a way a read-then-write is not.
        await ref.create({ ...funding, amountMicros: fromMicros(funding.amountMicros) });
        return true;
      } catch {
        return false;
      }
    },

    async listFunding(advertiserId) {
      const snap = await (await lazy())
        .collection("funding")
        .where("advertiserId", "==", advertiserId)
        .orderBy("at", "desc")
        .limit(200)
        .get();
      return snap.docs.map((d) => {
        const raw = d.data();
        return { ...(raw as Omit<FundingRecord, "amountMicros">), amountMicros: toMicros(raw["amountMicros"]) };
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

      return database.runTransaction(async (tx) => {
        const reads = await Promise.all([
          tx.get(eventRef),
          tx.get(objectRef),
          tx.get(orderRef),
          tx.get(advertiserRef),
          ...(disputeRef === null ? [] : [tx.get(disputeRef)]),
        ]);
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
            providerPaymentId: event.paymentId,
            updatedAt: Date.now(),
          });
          return { applied: true, reason: "applied", advertiserId: advertiser.advertiserId };
        }

        let delta = 0n;
        if (event.type === "refund" || event.type === "dispute-opened") {
          const removable = advertiser.fundedMicros > 0n ? advertiser.fundedMicros : 0n;
          const removed = event.amountMicros < removable ? event.amountMicros : removable;
          delta = -removed;
          if (event.type === "dispute-opened" && disputeRef !== null) {
            tx.set(disputeRef, { micros: fromMicros(removed) });
          }
        } else if (event.type === "dispute-release") {
          delta = toMicros(reads[4]?.data()?.["micros"]);
        }
        const fundedMicros = advertiser.fundedMicros + delta;
        tx.update(advertiserRef, {
          fundedMicros: fromMicros(fundedMicros),
          ...(fundedMicros < advertiser.reservedMicros ? { status: "suspended" } : {}),
        });
        tx.update(orderRef, {
          status:
            event.type === "dispute-opened"
              ? "disputed"
              : fundedMicros === 0n
                ? "reversed"
                : fundedMicros < order.amountMicros
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
      return {
        uid,
        ...decryptDestination(payoutKey(), encrypted),
        updatedAt: Number(raw["updatedAt"]),
      };
    },

    async putPayoutProfile(profile: PayoutProfileRecord) {
      await (await lazy()).collection("payoutProfiles").doc(profile.uid).set({
        uid: profile.uid,
        encryptedDestination: encryptDestination(payoutKey(), profile),
        destinationMask: maskDestination(profile),
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
  };

  return store;
}
