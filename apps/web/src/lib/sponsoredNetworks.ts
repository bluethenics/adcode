import type { SponsoredNetwork } from "@adcode/api/src/sponsoredNetworks.ts";

export type { SponsoredNetwork };

/** Zeekend's exchange, as its SDK addresses it. */
export const ZEEKEND_ENDPOINT = "https://exchange.zeekend.com/v1";

/**
 * The network list from `/v1/sponsored/networks`, keeping only well-formed Zeekend entries, in
 * order. Zeekend is ADCode's only ad partner: an `imprezia` entry an older server still lists
 * is ignored, so no Imprezia card is ever asked for or drawn.
 */
export function parseNetworks(raw: unknown): SponsoredNetwork[] | null {
  const list = typeof raw === "object" && raw !== null ? (raw as { networks?: unknown }).networks : undefined;
  if (!Array.isArray(list)) return null;
  const networks: SponsoredNetwork[] = [];
  for (const one of list) {
    if (typeof one !== "object" || one === null) continue;
    const entry = one as Record<string, unknown>;
    if (entry["id"] === "zeekend" && typeof entry["publisherKey"] === "string" && typeof entry["placementId"] === "string") {
      networks.push({ id: "zeekend", publisherKey: entry["publisherKey"], placementId: entry["placementId"] });
    }
  }
  return networks;
}

/**
 * Who is asked for this card: Zeekend, whether the card goes under a reply, in a sponsored
 * notification or on the phone. The first connection that answers wins - one card each time.
 */
export function networksFor(_layout: "reply" | "notification" | "banner", networks: readonly SponsoredNetwork[]): SponsoredNetwork[] {
  return networks.filter((network) => network.id === "zeekend");
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
 * Tell ADCode's API that Zeekend counted an impression, for the admin's "Ads shown"
 * (services/api/src/networkImpressions.ts). Fire and forget: the card never waits on it.
 */
export function reportNetworkImpression(slotId: string, layout: "reply" | "notification" | "banner", fetchImpl: typeof fetch = fetch, origin = ""): void {
  void fetchImpl(`${origin}/v1/sponsored/impression`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ network: "zeekend", slotId, layout }),
    keepalive: true,
  }).catch(() => undefined);
}
