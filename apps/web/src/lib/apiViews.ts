/**
 * The API's response shapes that the development-only fixtures also build (portalPreview.ts).
 * They live here, not in api.ts, so the fixtures never import api.ts - api.ts imports the
 * fixtures, and the dependency firewall forbids the cycle. api.ts re-exports them, so
 * `import type { CampaignView } from "./api"` keeps working everywhere.
 */

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

/** One campaign's numbers for one UTC day. `/portal/series` returns these oldest first. */
export interface SeriesPointView {
  day: string;
  campaignId: string;
  impressions: number;
  clicks: number;
  spentMicros: string;
}
