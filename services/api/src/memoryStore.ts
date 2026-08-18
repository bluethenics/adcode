/**
 * The in-memory `Store`.
 *
 * Backs every unit and conformance test. It is not a stub: it enforces the same
 * invariants Firestore will - idempotent receipt creation, refusal of a duplicate entry
 * id, and a balance cache written in the same step as the append. A test double that is
 * more permissive than production tests nothing worth testing.
 */
import { applyEntry, EMPTY_BALANCE, type Balance, type LedgerEntry } from "./ledger.ts";
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
} from "./store.ts";

export const DEFAULT_CONFIG: ServingConfig = {
  killSwitch: false,
  caps: { minIntervalMs: 300_000, dailyCap: 12 },
  defaultCpmMicros: 8_000_000n,
  revSharePercent: 50n,
  spendShardCount: 4,
  serveTtlMs: 600_000,
};

export function createMemoryStore(): Store & { reset(): void } {
  let users = new Map<string, UserRecord>();
  let campaigns = new Map<string, CampaignRecord>();
  let creatives = new Map<string, CreativeRecord>();
  let serves = new Map<string, ServeRecord>();
  let receipts = new Map<string, ReceiptRecord>();
  let entries: LedgerEntry[] = [];
  let balances = new Map<string, Balance>();
  let spend = new Map<string, bigint>();
  let audit: AuditRecord[] = [];
  let config: ServingConfig = { ...DEFAULT_CONFIG };

  return {
    reset() {
      users = new Map();
      campaigns = new Map();
      creatives = new Map();
      serves = new Map();
      receipts = new Map();
      entries = [];
      balances = new Map();
      spend = new Map();
      audit = [];
      config = { ...DEFAULT_CONFIG };
    },

    async getUser(uid) {
      return users.get(uid) ?? null;
    },

    async putUser(user) {
      users.set(user.uid, user);
    },

    async putCampaign(campaign) {
      campaigns.set(campaign.campaignId, campaign);
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

    async recordServe(serve) {
      serves.set(serve.serveId, serve);
    },

    async findServe(uid, creativeId, now) {
      for (const s of serves.values()) {
        if (s.uid === uid && s.creativeId === creativeId && s.expiresAt > now) return s;
      }
      return null;
    },

    async createReceiptIfAbsent(receipt) {
      if (receipts.has(receipt.receiptId)) return false;
      receipts.set(receipt.receiptId, receipt);
      return true;
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
  };
}
