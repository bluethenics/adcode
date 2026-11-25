/** Server-side ad network settings. Secrets never form part of this JSON. */
export type AdNetworkProvider = "http-json" | "imprezia" | "beehiiv" | "zeekend";
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
  /**
   * `chat` enables the browser SDK (publisher key; `id` is an optional placement label), on the
   * sponsored page beside Zeekend (2026-11-25), paying people per card like Zeekend does.
   * `app` and `site` are its OpenRTB Exchange, preview only.
   */
  imprezia?: { kind: "app" | "site" | "chat"; id: string } & CardPayFields;
  /**
   * Zeekend's chat placements, through its browser SDK on the sponsored page: its publisher key
   * (public by design) and placement id. What a person is paid per card is set here too
   * (2026-11-21), from the admin's Zeekend connection; missing fields mean the defaults below.
   */
  zeekend?: { placementId: string } & CardPayFields;
  /**
   * A chat network's part of the sponsored cards (2026-11-25): its share of the slots and the
   * places its cards may appear. Missing means an equal share everywhere. See networkMix.
   */
  mix?: NetworkMix;
}

/** What a chat network pays a person per card, set on its connection. Missing: the defaults. */
interface CardPayFields { payPerCardMicros?: string; paidCardsPerDay?: number }

/**
 * Where a chat network's cards can appear: `banner`, the ad box above the chat's message box
 * (and on Phone link); `notification`, a sponsored notification; `reply`, under an AI reply.
 */
export const CARD_PLACES = ["banner", "notification", "reply"] as const;
export type CardPlace = (typeof CARD_PLACES)[number];

/*
 * Splitting sponsored cards between chat networks (2026-11-25).
 *
 * Each slot - a turn of the ad box, a notification - goes to one network, picked by these
 * shares: 60 and 40 send six slots in ten to one network and four to the other. A network
 * with no card for its slot hands it to the next, so people see a card as often as with one
 * network; the split only decides who is asked first. A share of 0 is a backup: asked only
 * when the network a slot went to had nothing. `places` keeps a network out of a place.
 */
export interface NetworkMix { share: number; places: CardPlace[] }
export const DEFAULT_SHARE = 50;
export const MAX_SHARE = 100;

/** A chat network's share and places, with the defaults for a connection saved before them. */
export function networkMix(config: Pick<AdNetworkConfig, "mix">): NetworkMix {
  return { share: config.mix?.share ?? DEFAULT_SHARE, places: config.mix?.places ?? [...CARD_PLACES] };
}

/** Whether a connection is one of the SDK networks that fill sponsored cards. */
export const isChatNetwork = (config: Pick<AdNetworkConfig, "provider" | "imprezia">): boolean => config.provider === "zeekend" || config.provider === "imprezia" && config.imprezia?.kind === "chat";

/*
 * What a person earns for each partner card they are shown, and how many cards a day pay.
 *
 * Set by an administrator on each chat network's connection, so the rate changes with no
 * release. The defaults are what Zeekend paid before the setting existed (2026-11-13): $0.002
 * a card, 300 cards a day. The ceilings stop a typo - "2" for "0.002" - from paying a thousand
 * times the intended rate: a card cannot pay more than $0.10, nor a person be paid for more than
 * 1,000 a day. The day's count is shared by every network (networkImpressions.ts), so a split
 * between two networks pays no more cards a day than one network did.
 */
export const CARD_DEFAULT_PAY_MICROS = 2_000;
export const CARD_DEFAULT_PAID_PER_DAY = 300;
export const CARD_MAX_PAY_MICROS = 100_000;
export const CARD_MAX_PAID_PER_DAY = 1_000;
/** The names these had while Zeekend was the only partner. */
export const ZEEKEND_DEFAULT_PAY_MICROS = CARD_DEFAULT_PAY_MICROS;
export const ZEEKEND_DEFAULT_PAID_PER_DAY = CARD_DEFAULT_PAID_PER_DAY;
export const ZEEKEND_MAX_PAY_MICROS = CARD_MAX_PAY_MICROS;
export const ZEEKEND_MAX_PAID_PER_DAY = CARD_MAX_PAID_PER_DAY;

/** The rate and daily cap a chat network's connection pays at. */
export function cardPay(config: Pick<AdNetworkConfig, "zeekend" | "imprezia"> | undefined): { payMicros: number; perDay: number } {
  const fields: CardPayFields | undefined = config?.zeekend ?? config?.imprezia;
  const pay = fields?.payPerCardMicros;
  return {
    payMicros: pay === undefined ? CARD_DEFAULT_PAY_MICROS : Number(pay),
    perDay: fields?.paidCardsPerDay ?? CARD_DEFAULT_PAID_PER_DAY,
  };
}
/** The name cardPay had while Zeekend was the only partner. */
export const zeekendPay = cardPay;
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
/** A chat network's pay fields, checked against the ceilings; null when one is out of bounds. */
function parseCardPay(raw: Record<string, unknown>): CardPayFields | null {
  const pay = raw["payPerCardMicros"], perDay = raw["paidCardsPerDay"];
  if (pay !== undefined && (!micros(pay) || BigInt(pay) > BigInt(CARD_MAX_PAY_MICROS))) return null;
  if (perDay !== undefined && (typeof perDay !== "number" || !Number.isSafeInteger(perDay) || perDay < 0 || perDay > CARD_MAX_PAID_PER_DAY)) return null;
  return { ...(pay === undefined ? {} : { payPerCardMicros: pay as string }), ...(perDay === undefined ? {} : { paidCardsPerDay: perDay as number }) };
}
/** A share from 0 to 100 and a list of distinct places; undefined when absent, null when malformed. */
export function parseNetworkMix(raw: unknown): NetworkMix | null | undefined {
  if (raw === undefined) return undefined;
  if (!record(raw)) return null;
  const share = raw["share"], places = raw["places"];
  if (typeof share !== "number" || !Number.isSafeInteger(share) || share < 0 || share > MAX_SHARE) return null;
  if (!Array.isArray(places) || places.length > CARD_PLACES.length || new Set(places).size !== places.length || !places.every((place) => (CARD_PLACES as readonly unknown[]).includes(place))) return null;
  // Kept in one order, so two saves of the same choice compare equal.
  return { share, places: CARD_PLACES.filter((place) => places.includes(place)) };
}
export function parseAdNetworkConfig(raw: unknown): AdNetworkConfig | null {
  const config = parseConnection(raw);
  if (config === null || !record(raw) || raw["mix"] === undefined || !isChatNetwork(config)) return config;
  const mix = parseNetworkMix(raw["mix"]);
  return mix === null ? null : mix === undefined ? config : { ...config, mix };
}
function parseConnection(raw: unknown): AdNetworkConfig | null {
  if (!record(raw) || typeof raw["id"] !== "string" || !AD_NETWORK_ID.test(raw["id"]) || typeof raw["name"] !== "string" || raw["name"].trim().length < 1 || raw["name"].length > 80 || typeof raw["enabled"] !== "boolean" || !Number.isInteger(raw["priority"]) || Number(raw["priority"]) < 0 || Number(raw["priority"]) > 100 || !micros(raw["viewPayoutMicros"]) || !micros(raw["clickPayoutMicros"])) return null;
  const provider = raw["provider"];
  if (provider !== "http-json" && provider !== "imprezia" && provider !== "beehiiv" && provider !== "zeekend") return null;
  const base: AdNetworkConfig = { id: raw["id"], name: raw["name"].trim(), provider, enabled: raw["enabled"], priority: Number(raw["priority"]), viewPayoutMicros: raw["viewPayoutMicros"], clickPayoutMicros: raw["clickPayoutMicros"] };
  // Named providers support non-billable previews only, except Imprezia Chat Ads.
  const chat = provider === "zeekend" || provider === "imprezia" && record(raw["imprezia"]) && raw["imprezia"]["kind"] === "chat";
  if (provider !== "http-json" && !chat && base.enabled) return null;
  if (provider === "zeekend") {
    const placement = record(raw["zeekend"]) ? raw["zeekend"]["placementId"] : undefined;
    const placementId = placement === undefined || placement === "" ? "chat-main" : placement;
    if (typeof placementId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(placementId)) return null;
    const pay = parseCardPay(record(raw["zeekend"]) ? raw["zeekend"] : {});
    if (pay === null) return null;
    return { ...base, zeekend: { placementId, ...pay } };
  }
  if (provider === "beehiiv") {
    const bee = raw["beehiiv"];
    if (!record(bee) || typeof bee["publicationId"] !== "string" || !/^pub_[0-9a-fA-F-]{1,60}$/.test(bee["publicationId"]) || typeof bee["offerId"] !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(bee["offerId"])) return null;
    return { ...base, beehiiv: { publicationId: bee["publicationId"], offerId: bee["offerId"] } };
  }
  if (provider === "imprezia") {
    if (chat) {
      const placement = (raw["imprezia"] as Record<string, unknown>)["id"] ?? "";
      if (typeof placement !== "string" || placement !== "" && !/^[A-Za-z0-9_-]{1,64}$/.test(placement)) return null;
      const pay = parseCardPay(raw["imprezia"] as Record<string, unknown>);
      if (pay === null) return null;
      return { ...base, imprezia: { kind: "chat", id: placement, ...pay } };
    }
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
  if (config.provider === "zeekend" || config.provider === "imprezia" && config.imprezia?.kind === "chat") return !keyConfigured ? "key-required" : config.enabled ? "ready" : "disabled";
  if (config.provider === "imprezia" && !config.imprezia) return "inventory-required";
  if (config.provider === "imprezia") return keyConfigured ? "exchange-test-only" : "key-required";
  if (config.provider === "beehiiv") return "newsletter-preview-only";
  if (!keyConfigured) return "key-required";
  return config.enabled ? "ready" : "disabled";
}
