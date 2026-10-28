/**
 * Usage campaign: a time-boxed window in which paid-provider (Heabsy) models have no weekly cap.
 * Tagflow models are already unmetered, so this is what "unlimited for every model" means.
 *
 * While a campaign is live the relay holds nothing against anyone's free week or purchased
 * balance, so usage during it is never counted and nobody is capped when it ends.
 * Stored on the Tagflow config record, so an administrator starts and stops it from the web
 * admin with no desktop release. Pure.
 */
export interface UsageCampaign { name: string; startsAt: number; endsAt: number }

export const MAX_CAMPAIGN_DAYS = 31;
const DAY_MS = 86_400_000;

export function parseCampaign(raw: unknown): UsageCampaign | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).some((key) => !["name", "startsAt", "endsAt"].includes(key))) return null;
  const { name, startsAt, endsAt } = r;
  if (typeof name !== "string" || name.trim().length === 0 || name.length > 80) return null;
  const at = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 9_000_000_000_000;
  if (!at(startsAt) || !at(endsAt) || endsAt <= startsAt || endsAt - startsAt > MAX_CAMPAIGN_DAYS * DAY_MS) return null;
  return { name: name.trim(), startsAt, endsAt };
}

/** The campaign that is running at `now`, or null. */
export function activeCampaign(campaign: UsageCampaign | undefined, now: number): UsageCampaign | null {
  return campaign !== undefined && campaign.startsAt <= now && now < campaign.endsAt ? campaign : null;
}

/** A campaign that starts now and runs for whole days. Null for a name or length that is not allowed. */
export function startCampaign(name: unknown, days: unknown, now: number): UsageCampaign | null {
  if (typeof days !== "number" || !Number.isSafeInteger(days) || days < 1 || days > MAX_CAMPAIGN_DAYS) return null;
  return parseCampaign({ name, startsAt: now, endsAt: now + days * DAY_MS });
}
