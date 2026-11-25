import type { SponsoredNetwork } from "@adcode/api/src/sponsoredNetworks.ts";
import type { CardPlace } from "@adcode/api/src/adNetworkConfig.ts";

export type { SponsoredNetwork };
export type Layout = CardPlace;

/** Zeekend's exchange, as its SDK addresses it. */
export const ZEEKEND_ENDPOINT = "https://exchange.zeekend.com/v1";

const PLACES: readonly CardPlace[] = ["banner", "notification", "reply"];
/** A share the server did not send: the same default the server uses (adNetworkConfig.ts). */
const DEFAULT_SHARE = 50;

/**
 * The network list from `/v1/sponsored/networks`, keeping well-formed Zeekend and Imprezia
 * entries in the server's order. A missing share or places list (an older server) means an
 * equal share everywhere; anything else unknown is dropped.
 */
export function parseNetworks(raw: unknown): SponsoredNetwork[] | null {
  const list = typeof raw === "object" && raw !== null ? (raw as { networks?: unknown }).networks : undefined;
  if (!Array.isArray(list)) return null;
  const networks: SponsoredNetwork[] = [];
  for (const one of list) {
    if (typeof one !== "object" || one === null) continue;
    const entry = one as Record<string, unknown>;
    const sentShare = entry["share"];
    const share = typeof sentShare === "number" && Number.isInteger(sentShare) && sentShare >= 0 && sentShare <= 100 ? sentShare : DEFAULT_SHARE;
    const places = Array.isArray(entry["places"]) ? PLACES.filter((place) => (entry["places"] as unknown[]).includes(place)) : [...PLACES];
    if (networks.some((network) => network.id === entry["id"])) continue;
    if (entry["id"] === "zeekend" && typeof entry["publisherKey"] === "string" && typeof entry["placementId"] === "string") {
      networks.push({ id: "zeekend", publisherKey: entry["publisherKey"], placementId: entry["placementId"], share, places });
    } else if (entry["id"] === "imprezia") {
      const placementId = entry["placementId"];
      networks.push({ id: "imprezia", ...(typeof placementId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(placementId) ? { placementId } : {}), share, places });
    }
  }
  return networks;
}

/**
 * Where this slot falls between 0 and 1, for picking its network by share.
 *
 * Each card is its own page, so nothing here remembers the last slot. The slot's turn does it
 * instead: stepping by the golden ratio spreads a conversation's turns evenly over the range, so
 * networks take turns in proportion - 50/50 alternates, 70/30 gives the second network three
 * slots in every ten, never a long run of one - and the conversation's own offset keeps every
 * person's first slot from going to the same network.
 */
export function slotPosition(sessionId: string, turn: number): number {
  let hash = 2166136261;
  for (let index = 0; index < sessionId.length; index++) hash = Math.imul(hash ^ sessionId.charCodeAt(index), 16777619) >>> 0;
  // FNV alone barely moves the top bits for ids a character apart (chat-1, chat-2): mix them.
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35) >>> 0;
  hash = (hash ^ (hash >>> 16)) >>> 0;
  const position = hash / 4294967296 + turn * 0.6180339887498949;
  return position - Math.floor(position);
}

/**
 * Who is asked for this slot, in order (2026-11-25). Networks kept out of this place by the
 * admin are left out. The first is picked by share at `position` (slotPosition); the rest
 * follow, largest share first, to fill the slot when the first has no card - so a card shows as
 * often as with one network, and the split decides only who is asked first. A network with a
 * share of 0 is only ever a backup; if every share is 0 the server's order decides.
 */
export function networksFor(layout: Layout, networks: readonly SponsoredNetwork[], position = 0): SponsoredNetwork[] {
  const here = networks.filter((network) => network.places.includes(layout));
  const total = here.reduce((sum, network) => sum + network.share, 0);
  const backups = [...here].sort((a, b) => b.share - a.share);
  if (total === 0) return here;
  let mark = Math.min(Math.max(position, 0), 0.999999) * total;
  const first = here.find((network) => network.share > 0 && (mark -= network.share) < 0) ?? backups[0]!;
  return [first, ...backups.filter((network) => network !== first)];
}

/** Imprezia's 320x50 banner, the size of the ad box above the chat's message box. */
export const IMPREZIA_BANNER_SIZE = "mw_display_320x50_postchat";
/** How Imprezia's reports name the ad box. */
export const IMPREZIA_BANNER_PLACEMENT = "adcode-ad-box";
/** Where Imprezia's SDK sends what it measures: this site's relay, which forwards it unchanged. */
export const IMPREZIA_IMPRESSION_PATH = "/v1/imprezia/v1/events/sdk-impression";

/**
 * The card id ADCode uses for one Imprezia serve: its impression uuid behind `slot_imp_` (see
 * services/api networkImpressions.ts), or null for anything that is not a uuid.
 */
export function impreziaCardId(impressionUuid: unknown): string | null {
  return typeof impressionUuid === "string" && /^[0-9A-Fa-f-]{8,55}$/.test(impressionUuid) ? `slot_imp_${impressionUuid}` : null;
}

/**
 * Hears each impression Imprezia bills, once per serve.
 *
 * Imprezia's SDK records a viewable impression (half the card on screen for a second) by
 * posting a beacon to its impression endpoint - this site's relay - with `fetch` or
 * `navigator.sendBeacon`. Its banner unit has no callback for that moment, so this watches the
 * two calls on this page, for that one address, and passes every call through untouched. The
 * billable beacon is the one with no `eventType`: first-render, insertion, image-failure and
 * drop telemetry all carry one, by the SDK's own contract. Returns the way to stop watching.
 */
export function watchImpreziaImpressions(
  target: { fetch: typeof fetch; navigator?: { sendBeacon?: (url: string | URL, data?: BodyInit | null) => boolean } },
  endpoint: string,
  onBillable: (impressionUuid: string) => void,
): () => void {
  const heard = new Set<string>();
  const inspect = (url: unknown, body: unknown): void => {
    try {
      const address = typeof url === "string" ? url : url instanceof URL ? url.href : typeof Request !== "undefined" && url instanceof Request ? url.url : "";
      if (address.split("?")[0] !== endpoint || typeof body !== "string") return;
      const beacon = JSON.parse(body) as { eventType?: unknown; impressionUuid?: unknown };
      if (beacon.eventType !== undefined || typeof beacon.impressionUuid !== "string" || beacon.impressionUuid === "" || heard.has(beacon.impressionUuid)) return;
      heard.add(beacon.impressionUuid);
      onBillable(beacon.impressionUuid);
    } catch { /* hearing a beacon never breaks it */ }
  };
  const originalFetch = target.fetch;
  const watchedFetch: typeof fetch = (input, init) => { inspect(input, init?.body); return originalFetch.call(globalThis, input, init); };
  target.fetch = watchedFetch;
  const beaconHost = target.navigator;
  const originalBeacon = beaconHost?.sendBeacon;
  if (beaconHost !== undefined && typeof originalBeacon === "function") {
    beaconHost.sendBeacon = (url, data) => { inspect(url, data); return originalBeacon.call(beaconHost, url, data); };
  }
  return () => {
    if (target.fetch === watchedFetch) target.fetch = originalFetch;
    if (beaconHost !== undefined && originalBeacon !== undefined) beaconHost.sendBeacon = originalBeacon;
  };
}

/**
 * A stable id for one conversation that is not the conversation's own id, one per partner: no
 * network is sent anything that could identify a person elsewhere, or link them across networks.
 */
export async function partnerSessionId(network: "zeekend" | "imprezia", conversationId: string): Promise<string> {
  if (network === "zeekend") return zeekendSessionId(conversationId);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`adcode-imprezia:${conversationId}`));
  return `adc_${Array.from(new Uint8Array(digest).slice(0, 12), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Settles with the promise's value, or with null once `ms` have passed - whichever comes first. */
export function withDeadline<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), Math.max(0, ms));
    work.then((value) => { clearTimeout(timer); resolve(value); }, () => { clearTimeout(timer); resolve(null); });
  });
}

/**
 * The pages allowed to embed `/sponsored/chat` and hand it an exchange: the desktop app's
 * window, and Phone link's page on web.bluethenics.com, which shows a card under the
 * computer's replies. Keep in step with the `frame-ancestors` header in next.config.ts.
 */
export const SPONSORED_EMBEDDERS: readonly string[] = ["app://adcode", "https://web.bluethenics.com"];

/**
 * Zeekend's SDK counts turns itself, from zero in each page - and this page is new for every
 * reply, so every request would claim turn 1 and Zeekend's pacing (first turn, gap, per-session
 * cap, set in its dashboard) could never work. The SDK's `transport` option sends its requests
 * instead: this one posts them to Zeekend's documented endpoints unchanged, except that a slot
 * request carries the conversation's real turn. Events (impressions, clicks, reports) pass
 * through as the SDK built them, and never throw. `onImpression` hears each impression Zeekend
 * counts - whether its own unit or the ad box drew the card - so ADCode can count it too.
 */
export function zeekendTransport(turn: number, fetchImpl: typeof fetch = fetch, endpoint = ZEEKEND_ENDPOINT, onImpression?: (slotId: string) => void) {
  const post = (url: string, body: unknown): Promise<Response> => fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    // The SDK's own timeout: Zeekend scores each placement with a language model, which with
    // the browser's CORS preflight can take several seconds.
    signal: AbortSignal.timeout(8_000),
  });
  return async (payload: Record<string, unknown>): Promise<unknown> => {
    if (payload["event"] === true) {
      const { event: _event, ...body } = payload;
      try { await post(`${endpoint}/event`, body); } catch { /* an event never breaks the card */ }
      if (body["type"] === "impression" && typeof body["slotId"] === "string") {
        try { onImpression?.(body["slotId"]); } catch { /* counting never breaks the card */ }
      }
      return null;
    }
    const response = await post(`${endpoint}/slot`, { ...payload, turn });
    if (response.status === 204) {
      const skipped = response.headers.get("x-zeekend-skip");
      return skipped ? { skipped } : null;
    }
    if (!response.ok) throw new Error(`http ${response.status}`);
    return response.json();
  };
}

/**
 * A stable id for one conversation that is not the conversation's own id: Zeekend asks that
 * nothing it is sent could identify a person elsewhere, and paces placements per session.
 */
export async function zeekendSessionId(conversationId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`adcode-zeekend:${conversationId}`));
  return `adc_${Array.from(new Uint8Array(digest).slice(0, 12), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Colours for Zeekend's own unit. It reads the background behind it to pick them, and this page
 * is see-through, so it is told instead - the editor's tokens (apps/desktop tokens.css). Zeekend
 * allows restyling its unit; the "Sponsored" disclosure and the Report button stay its own.
 */
export const ZEEKEND_COLOURS = {
  // accent: SDK 0.8.4 draws its "Shop →" link in this colour - ADCode's green, readable on each theme.
  dark: { text: "#ebe8e1", muted: "#8f8c85", accent: "#6fb98f", border: "rgba(235, 232, 225, 0.16)" },
  light: { text: "#24231f", muted: "#69665f", accent: "#2f7d55", border: "rgba(36, 35, 31, 0.16)" },
} as const;

/**
 * The slot as ADCode shows it: without prices. A price in a card beside somebody's code reads
 * as a shop window, and it goes stale between the answer and the click; the product page the
 * card opens is where a price belongs. Zeekend's rules for custom rendering ask for two things
 * only - its `clickUrl` and its disclosure stay - and both are untouched here, as is the slot's
 * identity, so its impression and click are counted exactly as before.
 */
export function withoutPrices<T extends object>(slot: T): T {
  const { price: _price, ...rest } = slot as T & { price?: unknown };
  const items = (rest as { items?: unknown }).items;
  return {
    ...rest,
    ...(Array.isArray(items) ? { items: items.map((item: unknown) => {
      if (typeof item !== "object" || item === null) return item;
      const { price: _itemPrice, ...kept } = item as { price?: unknown };
      return kept;
    }) } : {}),
  } as T;
}

/**
 * Tell ADCode's API that a partner counted an impression, for the admin's "Ads shown" and its
 * traffic split (services/api/src/networkImpressions.ts). Fire and forget: the card never
 * waits on it.
 */
export function reportNetworkImpression(slotId: string, layout: Layout, fetchImpl: typeof fetch = fetch, origin = "", network: "zeekend" | "imprezia" = "zeekend"): void {
  void fetchImpl(`${origin}/v1/sponsored/impression`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ network, slotId, layout }),
    keepalive: true,
  }).catch(() => undefined);
}
