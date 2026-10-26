/** Server-side ad network settings. Secrets never form part of this JSON. */
export type AdNetworkProvider = "http-json" | "imprezia" | "beehiiv";
export interface HttpAdNetworkConfig {
  serveUrl: string;
  method: "GET" | "POST";
  authHeader: string;
  authPrefix: string;
  requestTemplate: unknown;
  creativePath: string;
  fields: { id: string; advertiser: string; headline: string; body: string; clickUrl: string; logoLight: string; logoDark: string };
  verifyUrl: string;
  verifyTemplate: unknown;
  verifiedPath: string;
  eventIdPath: string;
}
export interface AdNetworkConfig {
  id: string;
  name: string;
  provider: AdNetworkProvider;
  enabled: boolean;
  priority: number;
  viewPayoutMicros: string;
  clickPayoutMicros: string;
  http?: HttpAdNetworkConfig;
  beehiiv?: { publicationId: string; offerId: string };
  imprezia?: { kind: "app" | "site"; id: string };
}
export interface EncryptedAdNetworkKey { version: 1; nonce: string; ciphertext: string; tag: string }
export interface AdNetworkDelivery {
  id: string;
  networkId: string;
  uid: string;
  creativeId: string;
  providerCreativeId: string;
  servedAt: number;
  expiresAt: number;
  viewPayoutMicros: string;
  clickPayoutMicros: string;
  logoLight: string;
  logoDark: string;
  settledEvents?: ("impression" | "click")[];
}
export interface AdNetworkStore {
  list(): Promise<AdNetworkConfig[]>;
  get(id: string): Promise<AdNetworkConfig | null>;
  put(config: AdNetworkConfig, adminUid: string, now: number): Promise<void>;
  key(id: string): Promise<EncryptedAdNetworkKey | null>;
  putKey(id: string, key: EncryptedAdNetworkKey | null): Promise<void>;
  recordDelivery(delivery: AdNetworkDelivery): Promise<void>;
  delivery(uid: string, creativeId: string): Promise<AdNetworkDelivery | null>;
  artwork(creativeId: string, variant: "light" | "dark"): Promise<string | null>;
  /** Atomic event uniqueness, immutable ledger append and balance update; payout comes from the delivery snapshot. */
  settle(id: string, event: "impression" | "click", providerEventId: string, now: number): Promise<boolean>;
}
export const AD_NETWORK_ID = /^[a-z][a-z0-9-]{1,39}$/;
const record = (raw: unknown): raw is Record<string, unknown> => typeof raw === "object" && raw !== null && !Array.isArray(raw);
const path = (raw: unknown): raw is string => typeof raw === "string" && raw.length <= 200 && (raw === "" || /^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/.test(raw)) && !raw.split(".").some(part => ["__proto__", "prototype", "constructor"].includes(part));
/** HTTPS-only configuration, no local/private literal addresses or embedded credentials. Redirects are separately refused. */
export function publicHttpsUrl(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length > 2048) return false;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.hash || url.port && url.port !== "443") return false;
    if (host.includes(":") || /^\d+(?:\.\d+){3}$/.test(host) || !host.includes(".") || /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(host)) return false;
    return true;
  } catch { return false; }
}
const micros = (raw: unknown): raw is string => typeof raw === "string" && /^(?:0|[1-9]\d{0,8})$/.test(raw) && BigInt(raw) <= 10_000_000n;
export function parseAdNetworkConfig(raw: unknown): AdNetworkConfig | null {
  if (!record(raw) || typeof raw["id"] !== "string" || !AD_NETWORK_ID.test(raw["id"]) || typeof raw["name"] !== "string" || raw["name"].trim().length < 1 || raw["name"].length > 80 || typeof raw["enabled"] !== "boolean" || !Number.isInteger(raw["priority"]) || Number(raw["priority"]) < 0 || Number(raw["priority"]) > 100 || !micros(raw["viewPayoutMicros"]) || !micros(raw["clickPayoutMicros"])) return null;
  const provider = raw["provider"];
  if (provider !== "http-json" && provider !== "imprezia" && provider !== "beehiiv") return null;
  const base: AdNetworkConfig = { id: raw["id"], name: raw["name"].trim(), provider, enabled: raw["enabled"], priority: Number(raw["priority"]), viewPayoutMicros: raw["viewPayoutMicros"], clickPayoutMicros: raw["clickPayoutMicros"] };
  // Named providers currently support non-billable previews only.
  if (provider !== "http-json" && base.enabled) return null;
  if (provider === "beehiiv") {
    const bee = raw["beehiiv"];
    if (!record(bee) || typeof bee["publicationId"] !== "string" || !/^pub_[0-9a-fA-F-]{1,60}$/.test(bee["publicationId"]) || typeof bee["offerId"] !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(bee["offerId"])) return null;
    return { ...base, beehiiv: { publicationId: bee["publicationId"], offerId: bee["offerId"] } };
  }
  if (provider === "imprezia") {
    if (base.viewPayoutMicros !== "0" || base.clickPayoutMicros !== "0") return null;
    const supply = raw["imprezia"];
    if (supply === undefined) return base;
    if (!record(supply) || !["app", "site"].includes(String(supply["kind"])) || typeof supply["id"] !== "string" || supply["id"].length > 200) return null;
    const id = supply["id"];
    if (supply["kind"] === "app" ? !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/.test(id) : !publicHttpsUrl(`https://${id}`) || new URL(`https://${id}`).hostname !== id) return null;
    return { ...base, imprezia: { kind: supply["kind"] as "app" | "site", id } };
  }
  const http = raw["http"];
  if (!record(http) || !publicHttpsUrl(http["serveUrl"]) || !publicHttpsUrl(http["verifyUrl"]) || new URL(http["serveUrl"]).origin !== new URL(http["verifyUrl"]).origin || !["GET", "POST"].includes(String(http["method"])) || typeof http["authHeader"] !== "string" || !/^(?:authorization|x-[a-z0-9-]{1,60}|api-key)$/i.test(http["authHeader"]) || typeof http["authPrefix"] !== "string" || http["authPrefix"].length > 40 || /[\r\n]/.test(http["authPrefix"]) || !path(http["creativePath"]) || !path(http["verifiedPath"]) || !path(http["eventIdPath"]) || !http["verifiedPath"] || !http["eventIdPath"] || !record(http["fields"])) return null;
  const fields = http["fields"];
  for (const field of ["id", "advertiser", "headline", "body", "clickUrl", "logoLight", "logoDark"]) if (!path(fields[field])) return null;
  for (const field of ["id", "advertiser", "headline", "clickUrl", "logoLight"]) if (!fields[field]) return null;
  const requestTemplate = http["requestTemplate"] ?? {};
  const verifyTemplate = http["verifyTemplate"] ?? {};
  try { if (JSON.stringify(requestTemplate).length > 8000 || JSON.stringify(verifyTemplate).length > 8000) return null; } catch { return null; }
  return { ...base, http: { serveUrl: http["serveUrl"], verifyUrl: http["verifyUrl"], method: http["method"] as "GET" | "POST", authHeader: http["authHeader"], authPrefix: http["authPrefix"], requestTemplate, verifyTemplate, creativePath: http["creativePath"], verifiedPath: http["verifiedPath"], eventIdPath: http["eventIdPath"], fields: fields as unknown as HttpAdNetworkConfig["fields"] } };
}
export function adNetworkReadiness(config: AdNetworkConfig, keyConfigured: boolean): string {
  if (config.provider === "imprezia" && !config.imprezia) return "inventory-required";
  if (config.provider === "imprezia") return keyConfigured ? "exchange-test-only" : "key-required";
  if (config.provider === "beehiiv") return "newsletter-preview-only";
  if (!keyConfigured) return "key-required";
  return config.enabled ? "ready" : "disabled";
}
