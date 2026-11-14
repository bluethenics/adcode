/**
 * Ad-network cards counted in the admin's "Ads shown" (2026-11-13).
 *
 * "Ads shown" was counted from ADCode's own billed receipts, so a Zeekend card - drawn and
 * measured by Zeekend on the sponsored page - never reached it, however many were seen. The
 * sponsored page now reports each Zeekend impression here, at the moment Zeekend counts it
 * (half the card on screen for a second), and the growth figures add them in.
 *
 * One row per Zeekend slot: Zeekend bills a slot's impression once, ever, so a slot reported
 * twice is counted once. The endpoint has no sign-in (the sponsored page has none), so it is
 * rate limited per address and takes nothing but a slot id of Zeekend's shape. These are
 * counts on the admin's dashboard and never money: nobody is credited or charged from them.
 */
/** The parts of the admin growth figures (store.ts GrowthStats) that count ads shown. */
interface AdsShownFigures {
  adsShown: number;
  adsShown7d: number;
  adsShown30d: number;
  daily: ReadonlyArray<{ day: string; adsShown: number }>;
}

export const NETWORK_IDS = ["zeekend"] as const;
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
}

export interface NetworkImpressionStore {
  /** False when the slot was already counted. */
  record(impression: NetworkImpression, at: number): Promise<boolean>;
  summary(now: number): Promise<NetworkImpressionSummary>;
}

/** Zeekend's slot ids look like `slot_p5b3lgsceh`. */
const SLOT_ID = /^slot_[A-Za-z0-9_-]{4,64}$/;

/** The report from the sponsored page, or null when it is not one. */
export function parseNetworkImpression(raw: unknown): NetworkImpression | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const network = value["network"];
  const layout = value["layout"];
  const slotId = value["slotId"];
  if (typeof slotId !== "string" || !SLOT_ID.test(slotId)) return null;
  if (!(NETWORK_IDS as readonly unknown[]).includes(network)) return null;
  return {
    slotId,
    network: network as NetworkId,
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
      return {
        total: all.length,
        last1d: all.filter((row) => row.at > now - DAY_MS).length,
        last7d: all.filter((row) => row.at > now - 7 * DAY_MS).length,
        last30d: all.filter((row) => row.at > now - 30 * DAY_MS).length,
        daily,
      };
    },
  };
}

/*
 * Paying people for Zeekend cards (2026-11-13): $0.002 for each card they were shown.
 *
 * Only from the signed-in app, never from the sponsored page's own report above: that one has
 * no account behind it and anybody could send it. The app reports the slot Zeekend counted
 * on its screen, and the credit goes through the ad-network ledger path - a delivery, then an
 * idempotent settle that appends the ledger entry and moves the balance in one step. A
 * delivery's creative id is unique, so one Zeekend slot pays one person, once, ever.
 *
 * A slot id cannot be checked with Zeekend from here, so a day's Zeekend earnings per person
 * are capped: ZEEKEND_PAID_PER_DAY cards, $0.60 a day at the rate below.
 */
export const ZEEKEND_VIEW_PAYOUT_MICROS = 2_000;
export const ZEEKEND_PAID_PER_DAY = 300;

export type NetworkCredit =
  | { readonly credited: true; readonly micros: string }
  | { readonly credited: false; readonly reason: "invalid" | "no-network" | "daily-cap" | "already" };

export async function creditNetworkImpression(
  deps: {
    readonly adNetworks: import("./adNetworkConfig.ts").AdNetworkStore | undefined;
    readonly bumpDailyCount: (key: string, dayStart: number) => Promise<number>;
    readonly now: number;
  },
  uid: string,
  raw: unknown,
): Promise<NetworkCredit> {
  const impression = parseNetworkImpression(raw);
  if (impression === null) return { credited: false, reason: "invalid" };
  const network = deps.adNetworks === undefined ? undefined : (await deps.adNetworks.list()).find((config) => config.provider === "zeekend" && config.enabled);
  if (deps.adNetworks === undefined || network === undefined) return { credited: false, reason: "no-network" };
  const existing = await deps.adNetworks.delivery(uid, impression.slotId);
  if (existing?.settledEvents?.includes("impression") === true) return { credited: false, reason: "already" };
  const dayStart = Math.floor(deps.now / DAY_MS) * DAY_MS;
  if ((await deps.bumpDailyCount(`zeekend-paid:${uid}`, dayStart)) > ZEEKEND_PAID_PER_DAY) return { credited: false, reason: "daily-cap" };
  const id = `zk_${impression.slotId}`;
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
        viewPayoutMicros: String(ZEEKEND_VIEW_PAYOUT_MICROS),
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
  return settled ? { credited: true, micros: String(ZEEKEND_VIEW_PAYOUT_MICROS) } : { credited: false, reason: "already" };
}
