import type { AdNetworkConfig, AdNetworkDelivery, AdNetworkStore, EncryptedAdNetworkKey } from "./adNetworkConfig.ts";
import type { LedgerEntry } from "./ledger.ts";
/** Same atomic event gates as production, including deduplication across different client receipt IDs. */
export function createAdNetworkMemoryStore(append: (entry: LedgerEntry) => void): AdNetworkStore & { reset(): void } {
  const configs = new Map<string, AdNetworkConfig>();
  const keys = new Map<string, EncryptedAdNetworkKey>();
  const deliveries = new Map<string, AdNetworkDelivery>();
  const events = new Set<string>();
  const providerEvents = new Set<string>();
  return {
    reset() { configs.clear(); keys.clear(); deliveries.clear(); events.clear(); providerEvents.clear(); },
    async list() { return [...configs.values()].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id)).map(config => structuredClone(config)); },
    async get(id) { const config = configs.get(id); return config ? structuredClone(config) : null; },
    async put(config) { configs.set(config.id, structuredClone(config)); },
    async key(id) { return keys.get(id) ?? null; },
    async putKey(id, key) { if (key === null) keys.delete(id); else keys.set(id, structuredClone(key)); },
    async recordDelivery(delivery) { if (deliveries.has(delivery.id)) throw new Error("Duplicate network delivery"); deliveries.set(delivery.id, structuredClone(delivery)); },
    async delivery(uid, creativeId) {
      const delivery = [...deliveries.values()].find(delivery => delivery.uid === uid && delivery.creativeId === creativeId);
      return delivery ? { ...delivery, settledEvents: (["impression", "click"] as const).filter(event => events.has(`${delivery.id}:${event}`)) } : null;
    },
    async artwork(creativeId, variant) {
      const delivery = [...deliveries.values()].find(delivery => delivery.creativeId === creativeId);
      return delivery ? variant === "light" ? delivery.logoLight : delivery.logoDark : null;
    },
    async settle(id, event, providerEventId, now) {
      const delivery = deliveries.get(id);
      if (!delivery) return false;
      const eventKey = `${id}:${event}`; const providerKey = `${delivery.networkId}:${providerEventId}`;
      if (events.has(eventKey) || providerEvents.has(providerKey)) return false;
      const micros = BigInt(event === "click" ? delivery.clickPayoutMicros : delivery.viewPayoutMicros);
      append({ entryId: `ane_${id}_${event}`, uid: delivery.uid, kind: event, micros, refId: id, createdAt: now, description: `${event === "click" ? "Click" : "View"} from ad network ${delivery.networkId}` });
      events.add(eventKey); providerEvents.add(providerKey); return true;
    },
  };
}
