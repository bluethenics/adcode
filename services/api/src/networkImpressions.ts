/**
 * Ad-network cards counted in the admin's "Ads shown" (2026-11-13), and paid for (below).
 *
 * "Ads shown" was counted from ADCode's own billed receipts, so a partner card - drawn and
 * measured by Zeekend's or Imprezia's SDK on the sponsored page - never reached it, however
 * many were seen. The sponsored page reports each such impression here, at the moment the
 * network counts it (half the card on screen for a second), and the growth figures add them in.
 *
 * One row per card: a network bills a card's impression once, ever, so a card reported twice
 * is counted once. The endpoint has no sign-in (the sponsored page has none), so it is rate
 * limited per address and takes nothing but a card id of a known shape. These are counts on
 * the admin's dashboard and never money: nobody is credited or charged from them.
 *
 * A card id names its network (2026-11-25). Zeekend's are its own slot ids, `slot_p5b3lgsceh`.
 * Imprezia's are its per-serve impression uuid behind `slot_imp_`. Both keep the `slot_` shape
 * the 2.6.5 app checks before claiming a card, so people on that release earn for Imprezia
 * cards too, although that app names every card it claims a Zeekend one.
 */
/** The parts of the admin growth figures (store.ts GrowthStats) that count ads shown. */
interface AdsShownFigures {
  adsShown: number;
  adsShown7d: number;
  adsShown30d: number;
  daily: ReadonlyArray<{ day: string; adsShown: number }>;
}

export const NETWORK_IDS = ["zeekend", "imprezia"] as const;
export type NetworkId = (typeof NETWORK_IDS)[number];
export const NETWORK_LAYOUTS = ["reply", "notification", "banner"] as const;
export type NetworkLayout = (typeof NETWORK_LAYOUTS)[number];

export interface NetworkImpression {
  readonly slotId: string;
  readonly network: NetworkId;
  readonly layout: NetworkLayout;
}

export interface NetworkImpressionSummary {
  readonly total: number;
  /** In the 24 hours before `now`: what yesterday's comparison leaves out. */
  readonly last1d: number;
  readonly last7d: number;
  readonly last30d: number;
  /** Per UTC day (YYYY-MM-DD), the last 30 days; days with none may be missing. */
  readonly daily: Readonly<Record<string, number>>;
  /**
   * Each network's cards in the last day and week, for the admin's traffic split. Missing when
   * the database has not had migration 20261125120000 yet.
   */
  readonly byNetwork?: Readonly<Record<string, NetworkShown>>;
}
export interface NetworkShown { readonly last1d: number; readonly last7d: number }

export interface NetworkImpressionStore {
  /** False when the slot was already counted. */
  record(impression: NetworkImpression, at: number): Promise<boolean>;
  summary(now: number): Promise<NetworkImpressionSummary>;
}

/** Every card id: Zeekend's slot ids look like `slot_p5b3lgsceh`. */
const SLOT_ID = /^slot_[A-Za-z0-9_-]{4,64}$/;
/** An Imprezia card: its impression uuid behind `slot_imp_`. */
export const IMPREZIA_CARD_PREFIX = "slot_imp_";
const IMPREZIA_CARD = /^slot_imp_[0-9A-Fa-f-]{8,55}$/;

/** Which network a card id belongs to; null when it is no card id at all. */
export function cardNetwork(slotId: string): NetworkId | null {
  if (!SLOT_ID.test(slotId)) return null;
  if (slotId.startsWith(IMPREZIA_CARD_PREFIX)) return IMPREZIA_CARD.test(slotId) ? "imprezia" : null;
  return "zeekend";
}

/**
 * The report from the sponsored page or the app, or null when it is not one. The card id says
 * which network it is; a `network` that is not a known one is refused, and a known one that
 * disagrees with the id gives way to it (the 2.6.5 app calls every card Zeekend's).
 */
export function parseNetworkImpression(raw: unknown): NetworkImpression | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const sent = value["network"];
  const layout = value["layout"];
  const slotId = value["slotId"];
  if (typeof slotId !== "string") return null;
  const network = cardNetwork(slotId);
  if (network === null) return null;
  if (sent !== undefined && !(NETWORK_IDS as readonly unknown[]).includes(sent)) return null;
  return {
    slotId,
    network,
    layout: (NETWORK_LAYOUTS as readonly unknown[]).includes(layout) ? (layout as NetworkLayout) : "reply",
  };
}

/** The admin's growth figures with network cards added to every "ads shown" count. */
export function withNetworkImpressions<T extends AdsShownFigures>(stats: T, network: NetworkImpressionSummary | null): T & { networkAdsShown: number; networkAdsShown7d: number } {
  if (network === null) return { ...stats, networkAdsShown: 0, networkAdsShown7d: 0 };
  return {
    ...stats,
    adsShown: stats.adsShown + network.total,
    adsShown7d: stats.adsShown7d + network.last7d,
    adsShown30d: stats.adsShown30d + network.last30d,
    daily: stats.daily.map((day) => ({ ...day, adsShown: day.adsShown + (network.daily[day.day] ?? 0) })),
    networkAdsShown: network.total,
    networkAdsShown7d: network.last7d,
  };
}

import { CARD_DEFAULT_PAID_PER_DAY, CARD_DEFAULT_PAY_MICROS, cardPay, isChatNetwork, networkMix, type AdNetworkConfig } from "./adNetworkConfig.ts";
import { CUSTOM_DOMAIN_FAST_CARDS, HELD_MESSAGE, TOO_FAST_PER_DAY } from "./earningReview.ts";

const DAY_MS = 86_400_000;
const utcDay = (at: number): string => new Date(at).toISOString().slice(0, 10);

/** In memory, for tests and the local server. */
export function createMemoryNetworkImpressionStore(): NetworkImpressionStore {
  const rows = new Map<string, { network: NetworkId; layout: NetworkLayout; at: number }>();
  return {
    async record(impression, at) {
      if (rows.has(impression.slotId)) return false;
      rows.set(impression.slotId, { network: impression.network, layout: impression.layout, at });
      return true;
    },
    async summary(now) {
      const all = [...rows.values()];
      const daily: Record<string, number> = {};
      for (const row of all) if (row.at > now - 30 * DAY_MS) daily[utcDay(row.at)] = (daily[utcDay(row.at)] ?? 0) + 1;
      const byNetwork: Record<string, NetworkShown> = {};
      for (const row of all.filter((one) => one.at > now - 7 * DAY_MS)) {
        const shown = byNetwork[row.network] ?? { last1d: 0, last7d: 0 };
        byNetwork[row.network] = { last1d: shown.last1d + (row.at > now - DAY_MS ? 1 : 0), last7d: shown.last7d + 1 };
      }
      return {
        total: all.length,
        last1d: all.filter((row) => row.at > now - DAY_MS).length,
        last7d: all.filter((row) => row.at > now - 7 * DAY_MS).length,
        last30d: all.filter((row) => row.at > now - 30 * DAY_MS).length,
        daily,
        byNetwork,
      };
    },
  };
}

/*
 * Paying people for partner cards (Zeekend 2026-11-13, Imprezia 2026-11-25): a set amount for
 * each card they were shown.
 *
 * Only from the signed-in app, never from the sponsored page's own report above: that one has
 * no account behind it and anybody could send it. The app reports the card the network counted
 * on its screen, and the credit goes through the ad-network ledger path - a delivery, then an
 * idempotent settle that appends the ledger entry and moves the balance in one step. A
 * delivery's creative id is unique, so one card pays one person, once, ever.
 *
 * A card id cannot be checked with the network from here, so a day's card earnings per person
 * are capped. The rate and the cap are the administrator's, on each network's connection
 * (adNetworkConfig.ts cardPay; 2026-11-21): $0.002 and 300 cards a day unless changed. The
 * day's count is one count for every network, so splitting the slots between two networks pays
 * no more cards a day than one network did; a card pays while that count is within its own
 * network's cap. The rate is copied onto the delivery, so a change applies to cards counted
 * after it.
 *
 * Since 2026-11-24 Zeekend's rate depends on the viewer's country - the one Cloudflare placed
 * the earn request in (regions.ts edgeCountry), never one the app reports - because Zeekend
 * pays ADCode by country. A country may also have its own daily cap; the count it is measured
 * against is the same one per person per day, wherever the cards were seen. Imprezia's
 * connection pays one rate everywhere.
 */
export const ZEEKEND_VIEW_PAYOUT_MICROS = CARD_DEFAULT_PAY_MICROS;
export const ZEEKEND_PAID_PER_DAY = CARD_DEFAULT_PAID_PER_DAY;

/*
 * Pace (2026-11-24): at most this many paid cards per account in a minute, from every network
 * together, however many tabs, windows or devices claim them. One screen shows a chat card every
 * 30 s (SPONSOR_ROTATE_MS) and now and then a notification card, so an honest account never
 * reaches three; ten open tabs on the web each showing cards used to earn ten times over, and a
 * script claiming made-up slot ids earned as fast as it could send. Both now earn what one
 * screen does.
 */
export const CARDS_PAID_PER_MINUTE = 3;
/** The name this had while Zeekend was the only partner. */
export const ZEEKEND_PAID_PER_MINUTE = CARDS_PAID_PER_MINUTE;
/** The prefix of the delivery written for each network's card. */
const DELIVERY_PREFIX: Record<NetworkId, string> = { zeekend: "zk", imprezia: "im" };

/** The connection that pays a network's cards: the first switched on, by priority. */
function payingConnection(configs: readonly AdNetworkConfig[], network: NetworkId): AdNetworkConfig | undefined {
  return configs.filter((config) => config.enabled && isChatNetwork(config) && config.provider === network).sort((a, b) => a.priority - b.priority)[0];
}

export type NetworkCredit =
  | { readonly credited: true; readonly micros: string }
  | { readonly credited: false; readonly reason: "invalid" | "no-network" | "daily-cap" | "already" | "unpaid" | "too-fast" | "review"; readonly message?: string };

/**
 * The earnings review (earningReview.ts), as the card path needs it. Absent: nobody is held.
 * `held` is read for every card; `assess` runs at a card that may change the answer (the
 * day's first, and the one that crosses the custom-domain threshold) and when an account keeps
 * sending cards too fast. Both answer whether the account is held now.
 */
export interface CardReview {
  held(): Promise<boolean>;
  assess(input: { cardsToday?: number; tooFast?: boolean }): Promise<boolean>;
}

export async function creditNetworkImpression(
  deps: {
    readonly adNetworks: import("./adNetworkConfig.ts").AdNetworkStore | undefined;
    readonly bumpDailyCount: (key: string, dayStart: number) => Promise<number>;
    readonly now: number;
    readonly review?: CardReview;
    /** True when the paying connection holds a test or sandbox key (adNetworks.ts servesTestCards): its cards pay nobody. */
    readonly servesTestCards?: (config: AdNetworkConfig) => Promise<boolean>;
    /** Where the edge placed this request; null or absent pays the default rate. */
    readonly country?: string | null;
  },
  uid: string,
  raw: unknown,
): Promise<NetworkCredit> {
  const impression = parseNetworkImpression(raw);
  if (impression === null) return { credited: false, reason: "invalid" };
  const network = deps.adNetworks === undefined ? undefined : payingConnection(await deps.adNetworks.list(), impression.network);
  if (deps.adNetworks === undefined || network === undefined) return { credited: false, reason: "no-network" };
  const { payMicros, perDay } = cardPay(network, deps.country);
  // Paying nothing: the card still counts on the dashboard, but no delivery is written, so the
  // slot is not used up and nobody's daily count moves.
  if (payMicros === 0 || perDay === 0) return { credited: false, reason: "unpaid" };
  // Test cards earn ADCode nothing, so they pay nobody - and leave no delivery behind either.
  if (deps.servesTestCards !== undefined && (await deps.servesTestCards(network))) return { credited: false, reason: "unpaid" };
  const existing = await deps.adNetworks.delivery(uid, impression.slotId);
  if (existing?.settledEvents?.includes("impression") === true) return { credited: false, reason: "already" };
  const dayStart = Math.floor(deps.now / DAY_MS) * DAY_MS;
  if (deps.review !== undefined && (await deps.review.held())) return { credited: false, reason: "review", message: HELD_MESSAGE };
  const minuteStart = Math.floor(deps.now / 60_000) * 60_000;
  if ((await deps.bumpDailyCount(`card-pace:${uid}`, minuteStart)) > CARDS_PAID_PER_MINUTE) {
    // All day at this rate is not a person looking at one screen.
    const refused = await deps.bumpDailyCount(`card-too-fast:${uid}`, dayStart);
    if (deps.review !== undefined && refused === TOO_FAST_PER_DAY && (await deps.review.assess({ tooFast: true }))) return { credited: false, reason: "review", message: HELD_MESSAGE };
    return { credited: false, reason: "too-fast" };
  }
  // One count for every network: see the note above CARDS_PAID_PER_MINUTE.
  const cardsToday = await deps.bumpDailyCount(`cards-paid:${uid}`, dayStart);
  if (cardsToday > perDay) return { credited: false, reason: "daily-cap" };
  if (deps.review !== undefined && (cardsToday === 1 || cardsToday === CUSTOM_DOMAIN_FAST_CARDS) && (await deps.review.assess({ cardsToday }))) {
    return { credited: false, reason: "review", message: HELD_MESSAGE };
  }
  const id = `${DELIVERY_PREFIX[impression.network]}_${impression.slotId}`;
  if (existing === null) {
    try {
      await deps.adNetworks.recordDelivery({
        id,
        networkId: network.id,
        uid,
        creativeId: impression.slotId,
        providerCreativeId: impression.slotId,
        servedAt: deps.now,
        expiresAt: deps.now + DAY_MS,
        viewPayoutMicros: String(payMicros),
        clickPayoutMicros: "0",
        logoLight: "",
        logoDark: "",
      });
    } catch {
      // Somebody already has this slot: it paid them, not a second person.
      return { credited: false, reason: "already" };
    }
  }
  const settled = await deps.adNetworks.settle(existing?.id ?? id, "impression", impression.slotId, deps.now);
  // The delivery's own rate is what settled: a delivery written before a rate change keeps the old one.
  return settled ? { credited: true, micros: existing?.viewPayoutMicros ?? String(payMicros) } : { credited: false, reason: "already" };
}

/**
 * What one partner card pays the person asking, where they are now (2026-11-24): the rate and
 * daily cap for the country the edge places them in, for Earnings to show. Deliberately only
 * their own row - not the table, and never what ADCode earns per card.
 */
export interface SponsoredCardRate {
  /** ISO code, or null when the edge knew no country (the default rate then applies). */
  readonly country: string | null;
  /** Whether the country has its own rate, rather than the default. */
  readonly countryRate: boolean;
  readonly payPerCardMicros: string;
  readonly paidCardsPerDay: number;
  /** False with no live partner connection, or a rate of $0: cards then pay nothing. */
  readonly paying: boolean;
}

/**
 * With more than one partner live (2026-11-25), the rate shown is the partner asked for the
 * most slots - the largest share of the admin's split, then priority - since most cards a
 * person sees come from it.
 */
export async function sponsoredCardRate(adNetworks: import("./adNetworkConfig.ts").AdNetworkStore | undefined, country: string | null): Promise<SponsoredCardRate> {
  const network = adNetworks === undefined ? undefined : (await adNetworks.list())
    .filter((config) => config.enabled && isChatNetwork(config))
    .sort((a, b) => networkMix(b).share - networkMix(a).share || a.priority - b.priority)[0];
  if (network === undefined) return { country, countryRate: false, payPerCardMicros: "0", paidCardsPerDay: 0, paying: false };
  const rate = cardPay(network, country);
  return { country: rate.country, countryRate: rate.listed, payPerCardMicros: String(rate.payMicros), paidCardsPerDay: rate.perDay, paying: rate.payMicros > 0 && rate.perDay > 0 };
}
