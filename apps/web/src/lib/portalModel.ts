/**
 * The advertiser portal's rules, kept out of the components so they can be tested.
 *
 * Everything here describes what the API already does. A campaign is created paused and
 * goes live the moment it has a card and the balance covers what is left of its budget
 * (`createCreative` and `transitionCampaignCommitment` in services/api). There is no
 * review queue: cards pass automated checks on submit. So the states below are about
 * money and serving, never about waiting for a person.
 */
import type { AdvertiserView, CampaignView, SeriesPointView } from "./api";
import { ECONOMICS } from "./site";

export type CampaignTone = "live" | "waiting" | "paused" | "ended";

export interface CampaignState {
  label: string;
  tone: CampaignTone;
  /** Micros still to fund before it can serve; zero unless `tone` is "waiting". */
  shortfallMicros: bigint;
}

const big = (value: string | undefined): bigint => {
  try {
    return BigInt(value ?? "0");
  } catch {
    return 0n;
  }
};

/** What is left of a campaign's budget: the amount going live has to reserve. */
export function remainingMicros(campaign: CampaignView): bigint {
  const left = big(campaign.budgetMicros) - big(campaign.spentMicros);
  return left > 0n ? left : 0n;
}

/**
 * The one status an advertiser needs to see. A paused campaign the balance cannot cover is
 * "Needs credits", because that is the only thing between it and serving.
 */
export function campaignState(campaign: CampaignView, advertiser: AdvertiserView | null): CampaignState {
  if (campaign.status === "ended") return { label: "Ended", tone: "ended", shortfallMicros: 0n };
  if (campaign.status === "active") {
    return remainingMicros(campaign) === 0n
      ? { label: "Budget spent", tone: "ended", shortfallMicros: 0n }
      : { label: "Live", tone: "live", shortfallMicros: 0n };
  }
  const shortfall = remainingMicros(campaign) - big(advertiser?.availableMicros);
  if (shortfall > 0n) return { label: "Needs credits", tone: "waiting", shortfallMicros: shortfall };
  return { label: "Paused", tone: "paused", shortfallMicros: 0n };
}

/** "acme.dev" from "https://www.acme.dev/developers", or the input when it is not a URL. */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** A complete https address with a dotted host, the only kind the API accepts. */
export function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && url.hostname.includes(".") && !url.hostname.endsWith(".");
  } catch {
    return false;
  }
}

/** Clicks as a percentage of views, to two places, or null before there are views. */
export function ctr(clicks: number, views: number): string | null {
  return views > 0 ? `${((clicks / views) * 100).toFixed(2)}%` : null;
}

/** Whole cents to the dollar string the API's micros fields expect. */
export function dollarsFromMicros(micros: bigint): string {
  const cents = (micros + 9_999n) / 10_000n; // round up: a shortfall must be covered in full
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

export interface ReachEstimate {
  /** Verified views if every block clears at your maximum bid. */
  viewsLow: number;
  /** Verified views if every block clears at the floor. */
  viewsHigh: number;
  /** Clicks over the same range, when there is a click rate worth projecting from. */
  clicksLow: number | null;
  clicksHigh: number | null;
  /** Where the click rate came from, so the page can say. */
  clickRateSource: "yours" | "network" | null;
}

/**
 * What a budget buys, from the real price rules.
 *
 * The second-price auction charges between the floor and your maximum bid for each 500-view
 * block, so the honest answer is a range: all blocks at your bid at one end, all at the
 * floor at the other. Clicks use your own click rate once you have views, else the
 * network's from `/v1/stats`; a rate outside 0-20% is not projected, because a figure that
 * odd says more about the data than about what a campaign will get.
 */
export function estimateReach(
  budgetMicros: bigint,
  bidBlockMicros: bigint,
  rates: { yours?: { clicks: number; views: number } | null; network?: { clicks: number; impressions: number } | null } = {},
): ReachEstimate {
  const floor = ECONOMICS.floorBlockMicros;
  const bid = bidBlockMicros < floor ? floor : bidBlockMicros;
  const perBlock = Number(ECONOMICS.impressionsPerBlock);
  const viewsLow = Number(budgetMicros / bid) * perBlock;
  const viewsHigh = Number(budgetMicros / floor) * perBlock;

  const sane = (clicks: number, views: number) => views >= 500 && clicks >= 0 && clicks / views <= 0.2;
  let rate: number | null = null;
  let source: ReachEstimate["clickRateSource"] = null;
  if (rates.yours != null && sane(rates.yours.clicks, rates.yours.views)) {
    rate = rates.yours.clicks / rates.yours.views;
    source = "yours";
  } else if (rates.network != null && sane(rates.network.clicks, rates.network.impressions)) {
    rate = rates.network.clicks / rates.network.impressions;
    source = "network";
  }

  return {
    viewsLow,
    viewsHigh,
    clicksLow: rate === null ? null : Math.floor(viewsLow * rate),
    clicksHigh: rate === null ? null : Math.round(viewsHigh * rate),
    clickRateSource: source,
  };
}

/** "12K", "1.2M", "940": short enough for a large figure, exact below a thousand. */
export function compact(value: number): string {
  if (value < 1_000) return value.toLocaleString("en-US");
  if (value < 1_000_000) return `${trim(value / 1_000)}K`;
  return `${trim(value / 1_000_000)}M`;
}

function trim(value: number): string {
  return value >= 100 ? Math.round(value).toString() : value.toFixed(1).replace(/\.0$/, "");
}

/** "12K-44K", or one figure when both ends agree. */
export function range(low: number, high: number): string {
  return compact(low) === compact(high) ? compact(high) : `${compact(low)}-${compact(high)}`;
}

/** The last `count` UTC days, oldest first: the calendar every chart is drawn over. */
export function calendar(count: number, now: number = Date.now()): string[] {
  return Array.from({ length: count }, (_, index) =>
    new Date(now - (count - 1 - index) * 86_400_000).toISOString().slice(0, 10),
  );
}

/** One campaign's (or every campaign's) series laid over a calendar. */
export function seriesTotals(series: readonly SeriesPointView[], days: readonly string[], campaignId?: string) {
  const views = new Map<string, number>();
  const clicks = new Map<string, number>();
  const spend = new Map<string, number>();
  for (const point of series) {
    if (campaignId !== undefined && point.campaignId !== campaignId) continue;
    views.set(point.day, (views.get(point.day) ?? 0) + point.impressions);
    clicks.set(point.day, (clicks.get(point.day) ?? 0) + point.clicks);
    spend.set(point.day, (spend.get(point.day) ?? 0) + Number(big(point.spentMicros)) / 1_000_000);
  }
  return {
    views: days.map((day) => views.get(day) ?? 0),
    clicks: days.map((day) => clicks.get(day) ?? 0),
    spend: days.map((day) => spend.get(day) ?? 0),
  };
}

/** "Acme · Nov 2026": recognisable in a list six months later without being typed. */
export function defaultCampaignName(brand: string, now: Date = new Date()): string {
  const month = now.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  return `${brand} · ${month}`;
}

/**
 * Where an old portal address now lives. The portal used to be one long page of anchors,
 * and links to those anchors are in emails, docs and the payment provider's return URL.
 */
export function legacyPortalTarget(hash: string, search: string): string | null {
  const params = new URLSearchParams(search);
  const campaign = params.get("campaign");
  if (campaign !== null && /^[A-Za-z0-9_-]{1,80}$/.test(campaign)) {
    return `/portal/campaigns/${campaign}${params.get("created") === "1" ? "?created=1" : ""}`;
  }
  if (hash === "#new-campaign") return "/portal/campaigns/new";
  if (hash === "#credits") return "/portal/billing";
  if (hash === "#refer") return "/portal/settings";
  return null;
}
