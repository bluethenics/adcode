/**
 * The advertiser side: sign up, create campaigns, submit creatives, read reports.
 *
 * Two rules shape everything here.
 *
 * Ownership is checked on every read and every write, against the verified UID rather
 * than an id in the request. An advertiser who guesses another advertiser's campaign id
 * gets a 404, not their data.
 *
 * Money is committed before it is spent. A campaign can only go active if the advertiser
 * has funded enough to cover its whole budget, and that budget is reserved the moment it
 * does. Two campaigns cannot promise the same dollar.
 */
import {
  ADVERTISER_LIMITS,
  LIMITS,
  type CampaignBody,
  type CreateAdvertiserBody,
  type CreativeBody,
} from "./contract.ts";
import { startOfDayBefore } from "./day.ts";
import { formatMicros } from "./money.ts";
import type {
  AdvertiserRecord,
  CampaignRecord,
  CampaignStats,
  Clock,
  CreativeRecord,
  IdGen,
  Store,
} from "./store.ts";
import { assetKey, assetUrl, isDataUrl, parseDataUrl } from "./assets.ts";

export interface AdvertiserDeps {
  store: Store;
  clock: Clock;
  ids: IdGen;
}

export type AdvertiserError =
  | "no-advertiser"
  | "already-advertiser"
  | "suspended"
  | "not-found"
  | "insufficient-funds"
  | "no-approved-creative"
  | "invalid-state";

export type Outcome<T> = { ok: true; value: T } | { ok: false; error: AdvertiserError };

const ok = <T>(value: T): Outcome<T> => ({ ok: true, value });
const fail = (error: AdvertiserError): Outcome<never> => ({ ok: false, error });

/* ── Views ──────────────────────────────────────────────────────────────── */

export interface AdvertiserView {
  advertiserId: string;
  name: string;
  status: string;
  fundedMicros: string;
  reservedMicros: string;
  availableMicros: string;
}

export interface CampaignView {
  campaignId: string;
  name: string;
  status: string;
  cpmMicros: string;
  budgetMicros: string;
  spentMicros: string;
  targetTags: string[];
  createdAt: number;
  serves: number;
  impressions: number;
  clicks: number;
}

export function advertiserView(record: AdvertiserRecord): AdvertiserView {
  return {
    advertiserId: record.advertiserId,
    name: record.name,
    status: record.status,
    fundedMicros: formatMicros(record.fundedMicros),
    reservedMicros: formatMicros(record.reservedMicros),
    availableMicros: formatMicros(record.fundedMicros - record.reservedMicros),
  };
}

function campaignView(campaign: CampaignRecord, stats: CampaignStats): CampaignView {
  return {
    campaignId: campaign.campaignId,
    name: campaign.name,
    status: campaign.status,
    cpmMicros: formatMicros(campaign.cpmMicros),
    budgetMicros: formatMicros(campaign.budgetMicros),
    spentMicros: formatMicros(stats.spentMicros),
    targetTags: campaign.targetTags,
    createdAt: campaign.createdAt,
    serves: stats.serves,
    impressions: stats.impressions,
    clicks: stats.clicks,
  };
}

/* ── Sign-up and lookup ─────────────────────────────────────────────────── */

export async function createAdvertiser(
  deps: AdvertiserDeps,
  uid: string,
  body: CreateAdvertiserBody,
): Promise<Outcome<AdvertiserView>> {
  const existing = await deps.store.advertiserForOwner(uid);
  if (existing !== null) return fail("already-advertiser");

  const record: AdvertiserRecord = {
    advertiserId: deps.ids.next("adv"),
    name: body.name,
    ownerUids: [uid],
    status: "active",
    fundedMicros: 0n,
    reservedMicros: 0n,
    createdAt: deps.clock.now(),
  };

  await deps.store.putAdvertiser(record);
  return ok(advertiserView(record));
}

/** The advertiser this user owns, or a typed refusal. Every other handler starts here. */
async function requireAdvertiser(
  deps: AdvertiserDeps,
  uid: string,
): Promise<Outcome<AdvertiserRecord>> {
  const record = await deps.store.advertiserForOwner(uid);
  if (record === null) return fail("no-advertiser");
  if (record.status === "suspended") return fail("suspended");
  return ok(record);
}

export async function getMyAdvertiser(
  deps: AdvertiserDeps,
  uid: string,
): Promise<Outcome<AdvertiserView>> {
  const found = await requireAdvertiser(deps, uid);
  return found.ok ? ok(advertiserView(found.value)) : found;
}

/* ── Campaigns ──────────────────────────────────────────────────────────── */

export async function listCampaigns(
  deps: AdvertiserDeps,
  uid: string,
): Promise<Outcome<CampaignView[]>> {
  const found = await requireAdvertiser(deps, uid);
  if (!found.ok) return found;

  const campaigns = await deps.store.campaignsForAdvertiser(found.value.advertiserId);
  const views = await Promise.all(
    campaigns.map(async (c) => campaignView(c, await deps.store.statsForCampaign(c.campaignId))),
  );

  return ok(views);
}

export async function createCampaign(
  deps: AdvertiserDeps,
  uid: string,
  body: CampaignBody,
): Promise<Outcome<CampaignView>> {
  const found = await requireAdvertiser(deps, uid);
  if (!found.ok) return found;

  // Created paused. Activation is where money is committed, and doing both at once would
  // mean a typo in a budget starts spending before it can be re-read.
  const campaign: CampaignRecord = {
    campaignId: deps.ids.next("camp"),
    advertiserId: found.value.advertiserId,
    name: body.name,
    createdAt: deps.clock.now(),
    cpmMicros: BigInt(body.cpmMicros),
    budgetMicros: BigInt(body.budgetMicros),
    targetTags: body.targetTags,
    status: "paused",
  };

  await deps.store.putCampaign(campaign);
  return ok(campaignView(campaign, await deps.store.statsForCampaign(campaign.campaignId)));
}

/** A campaign this user's advertiser owns, or `not-found` - never another's record. */
async function ownedCampaign(
  deps: AdvertiserDeps,
  uid: string,
  campaignId: string,
): Promise<Outcome<{ advertiser: AdvertiserRecord; campaign: CampaignRecord }>> {
  const found = await requireAdvertiser(deps, uid);
  if (!found.ok) return found;

  const campaign = await deps.store.getCampaign(campaignId);
  // A campaign belonging to someone else is reported as missing rather than forbidden:
  // "forbidden" confirms the id exists, which is a lookup oracle for competitors.
  if (campaign === null || campaign.advertiserId !== found.value.advertiserId) {
    return fail("not-found");
  }

  return ok({ advertiser: found.value, campaign });
}

export async function setCampaignStatus(
  deps: AdvertiserDeps,
  uid: string,
  campaignId: string,
  next: "active" | "paused" | "ended",
): Promise<Outcome<CampaignView>> {
  const owned = await ownedCampaign(deps, uid, campaignId);
  if (!owned.ok) return owned;

  const { campaign } = owned.value;
  if (campaign.status === "ended") return fail("invalid-state");
  if (campaign.status === next) {
    return ok(campaignView(campaign, await deps.store.statsForCampaign(campaignId)));
  }

  const spent = await deps.store.getSpend(campaignId);

  if (next === "active") {
    const approved = await deps.store.creativesForCampaign(campaignId);
    if (approved.length === 0) return fail("no-approved-creative");

  }

  const transition = await deps.store.transitionCampaignCommitment({
    advertiserId: campaign.advertiserId,
    campaignId,
    next,
    spentMicros: spent,
  });
  if (!transition.ok) return fail(transition.reason);
  const updated = transition.campaign;

  return ok(campaignView(updated, await deps.store.statsForCampaign(campaignId)));
}

/* ── Creatives ──────────────────────────────────────────────────────────── */

export interface CreativeView {
  creativeId: string;
  campaignId: string;
  advertiser: string;
  headline: string;
  body: string | null;
  clickUrl: string;
  logoLight: string;
  logoDark: string;
  status: string;
}

const creativeView = (record: CreativeRecord): CreativeView => ({
  creativeId: record.creativeId,
  campaignId: record.campaignId,
  advertiser: record.advertiser,
  headline: record.headline,
  body: record.body,
  clickUrl: record.clickUrl,
  logoLight: record.logoLight,
  logoDark: record.logoDark,
  status: record.status,
});

/**
 * Store one logo and return the URL the row should hold.
 *
 * An https URL is already hosted somewhere the client can reach, so it passes straight
 * through. A `data:` URL that cannot be decoded also passes through unchanged rather than
 * failing the submission - `parseCreative` has already checked it against `LOGO_DATA`, so
 * reaching that branch means something changed underneath, and losing a creative is worse
 * than storing one the review step will look at anyway.
 */
async function hostLogo(
  deps: AdvertiserDeps,
  origin: string,
  creativeId: string,
  variant: "light" | "dark",
  value: string,
): Promise<string> {
  if (!isDataUrl(value)) return value;

  const parsed = parseDataUrl(value);
  if (parsed === null) return value;

  const key = assetKey(creativeId, variant, parsed.contentType);
  await deps.store.putAsset(key, parsed);
  return assetUrl(origin, key);
}

export async function createCreative(
  deps: AdvertiserDeps,
  uid: string,
  body: CreativeBody,
  /** The service's own origin, for addressing artwork it stores. See `assets.ts`. */
  origin: string,
): Promise<Outcome<CreativeView>> {
  const owned = await ownedCampaign(deps, uid, body.campaignId);
  if (!owned.ok) return owned;

  /*
   * Submitted pending, never approved. Creatives are shown inside people's editors, and
   * the only thing standing between an advertiser and that surface is this review step.
   */
  const record: CreativeRecord = {
    // The client's `creativeId` pattern is [A-Za-z0-9_-]{1,64}; ids are generated to fit.
    creativeId: deps.ids.next("cr").slice(0, LIMITS.creativeId),
    campaignId: body.campaignId,
    advertiser: body.advertiser,
    headline: body.headline,
    body: body.body,
    clickUrl: body.clickUrl,
    // Placeholders: the artwork is stored below, once the id above exists to key it by.
    logoLight: body.logoLight,
    logoDark: body.logoDark,
    status: "pending",
  };

  /*
   * The artwork leaves the row here, and this is the whole point of the change.
   *
   * The portal sends a `data:` URL, which is a good thing to accept and a fatal thing to
   * store: it made the `creatives` read cost ~1,960ms inside a 3,000ms serve budget, and
   * the client rejects a `data:` URL outright anyway. See `assets.ts` for the numbers.
   */
  record.logoLight = await hostLogo(deps, origin, record.creativeId, "light", body.logoLight);
  record.logoDark = await hostLogo(deps, origin, record.creativeId, "dark", body.logoDark);

  await deps.store.putCreative(record);
  return ok(creativeView(record));
}

export async function listCreatives(
  deps: AdvertiserDeps,
  uid: string,
  campaignId: string,
): Promise<Outcome<CreativeView[]>> {
  const owned = await ownedCampaign(deps, uid, campaignId);
  if (!owned.ok) return owned;

  const records = await deps.store.allCreativesForCampaign(campaignId);
  return ok(records.map(creativeView));
}

/* ── Reporting ──────────────────────────────────────────────────────────── */

/** One campaign's numbers for one UTC day, as the portal reads them. */
export interface SeriesPointView {
  day: string;
  campaignId: string;
  impressions: number;
  clicks: number;
  spentMicros: string;
}

/**
 * The daily rollup behind the portal's charts.
 *
 * Bounded rather than open-ended: `days` is clamped to a sane window by the caller, and
 * every point is aggregate. An advertiser never learns who saw anything - the same rule
 * `campaignView` follows, and the reason the ads are tolerated at all.
 */
export async function campaignSeries(
  deps: AdvertiserDeps,
  uid: string,
  days: number,
): Promise<Outcome<SeriesPointView[]>> {
  const found = await requireAdvertiser(deps, uid);
  if (!found.ok) return found;

  const since = startOfDayBefore(deps.clock.now(), days);
  const points = await deps.store.seriesForAdvertiser(found.value.advertiserId, since);

  return ok(
    points.map((point) => ({
      day: point.day,
      campaignId: point.campaignId,
      impressions: point.impressions,
      clicks: point.clicks,
      spentMicros: formatMicros(point.spentMicros),
    })),
  );
}

/* ── Limits, published so the portal can validate before submitting ─────── */

export const PORTAL_LIMITS = {
  ...ADVERTISER_LIMITS,
  minCpmMicros: ADVERTISER_LIMITS.minCpmMicros.toString(),
  maxCpmMicros: ADVERTISER_LIMITS.maxCpmMicros.toString(),
  minBudgetMicros: ADVERTISER_LIMITS.minBudgetMicros.toString(),
  maxBudgetMicros: ADVERTISER_LIMITS.maxBudgetMicros.toString(),
  headline: LIMITS.headline,
  body: LIMITS.body,
  advertiser: LIMITS.advertiser,
} as const;
