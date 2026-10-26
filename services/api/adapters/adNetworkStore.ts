import type { AdNetworkConfig, AdNetworkDelivery, AdNetworkStore, EncryptedAdNetworkKey } from "../src/adNetworkConfig.ts";
import { parseAdNetworkConfig } from "../src/adNetworkConfig.ts";
import { cached, cachedBy } from "./dbGuard.ts";
type SupabaseClient = import("@supabase/supabase-js").SupabaseClient;
const check = (error: { message: string } | null): void => { if (error) throw new Error("Ad network storage unavailable"); };
/** Uses the existing lazy service-role client. Credential values remain encrypted in their own private table. */
export function createAdNetworkStore(lazy: () => Promise<SupabaseClient>): AdNetworkStore {
  return cacheAdNetworkSettings({
    async list() {
      const { data, error } = await (await lazy()).from("ad_network_settings").select("config").order("id").limit(100);
      check(error);
      return (data ?? []).map(row => parseAdNetworkConfig(row.config)).filter((config): config is AdNetworkConfig => config !== null).sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
    },
    async get(id) {
      const { data, error } = await (await lazy()).from("ad_network_settings").select("config").eq("id", id).maybeSingle();
      check(error); return data ? parseAdNetworkConfig(data.config) : null;
    },
    async put(config, adminUid, now) {
      const { error } = await (await lazy()).from("ad_network_settings").upsert({ id: config.id, config, updated_by: adminUid, updated_at: now }); check(error);
    },
    async key(id) {
      const { data, error } = await (await lazy()).from("ad_network_credentials").select("encrypted_key").eq("id", id).maybeSingle();
      check(error); return data ? data.encrypted_key as EncryptedAdNetworkKey : null;
    },
    async putKey(id, key) {
      const db = await lazy();
      const { error } = key === null ? await db.from("ad_network_credentials").delete().eq("id", id) : await db.from("ad_network_credentials").upsert({ id, encrypted_key: key }); check(error);
    },
    async recordDelivery(delivery) {
      const { error } = await (await lazy()).from("ad_network_deliveries").insert({ id: delivery.id, network_id: delivery.networkId, uid: delivery.uid, creative_id: delivery.creativeId, provider_creative_id: delivery.providerCreativeId, served_at: delivery.servedAt, expires_at: delivery.expiresAt, view_payout_micros: delivery.viewPayoutMicros, click_payout_micros: delivery.clickPayoutMicros, logo_light_url: delivery.logoLight, logo_dark_url: delivery.logoDark }); check(error);
    },
    async delivery(uid, creativeId) {
      const { data: row, error } = await (await lazy()).from("ad_network_deliveries").select("id,network_id,uid,creative_id,provider_creative_id,served_at,expires_at,view_payout_micros::text,click_payout_micros::text,logo_light_url,logo_dark_url,ad_network_events(event)").eq("uid", uid).eq("creative_id", creativeId).maybeSingle();
      check(error);
      return row ? { id: row.id, networkId: row.network_id, uid: row.uid, creativeId: row.creative_id, providerCreativeId: row.provider_creative_id, servedAt: Number(row.served_at), expiresAt: Number(row.expires_at), viewPayoutMicros: String(row.view_payout_micros), clickPayoutMicros: String(row.click_payout_micros), logoLight: row.logo_light_url, logoDark: row.logo_dark_url, settledEvents: row.ad_network_events.map((event: { event: "impression" | "click" }) => event.event) } as AdNetworkDelivery : null;
    },
    async artwork(creativeId, variant) {
      const column = variant === "light" ? "logo_light_url" : "logo_dark_url";
      const { data: row, error } = await (await lazy()).from("ad_network_deliveries").select(column).eq("creative_id", creativeId).maybeSingle();
      check(error); return row ? (row as unknown as Record<string, string>)[column] ?? null : null;
    },
    async settle(id, event, providerEventId, now) {
      const { data, error } = await (await lazy()).rpc("settle_ad_network_event", { p_delivery: id, p_event: event, p_provider_event: providerEventId, p_now: now });
      check(error); return data === true;
    },
  });
}

/** Cache completed configuration reads only; deliveries and money always reach the store. */
export function cacheAdNetworkSettings(store: AdNetworkStore): AdNetworkStore {
  const options = { ttlMs: 30_000, staleMs: 0, max: 100 };
  const list = cached(() => store.list(), options);
  const configs = cachedBy(id => store.get(id), options);
  const keys = cachedBy(id => store.key(id), options);
  return {
    ...store,
    list: () => list.get(),
    get: id => configs.get(id),
    key: id => keys.get(id),
    async put(config, adminUid, now) {
      await store.put(config, adminUid, now);
      list.clear(); configs.forget(config.id);
    },
    async putKey(id, key) {
      await store.putKey(id, key);
      keys.forget(id);
    },
  };
}
