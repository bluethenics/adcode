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
  AuditRecord,
  CampaignRecord,
  CreativeRecord,
  EntryPage,
  Page,
  ReceiptRecord,
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
