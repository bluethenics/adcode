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
import type {
  AdvertiserRecord,
  AuditRecord,
  CampaignStats,
  CampaignRecord,
  CreativeRecord,
  EntryPage,
  FundingRecord,
  Page,
  ReceiptRecord,
  PostRecord,
  ReportPage,
  ReportRecord,
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

const toMicros = (v: unknown): bigint => BigInt(typeof v === "string" ? v : "0");
const fromMicros = (v: bigint): string => v.toString();

export function createFirestoreStore(injected?: Firestore): Store {
  let db: Firestore | undefined = injected;

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
      await (await lazy()).collection("serves").doc(serve.serveId).set(serve);
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
      return doc === undefined ? null : (doc.data() as ServeRecord);
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
  };

  return store;
}
