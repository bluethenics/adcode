/**
 * Made-up advertiser data for building the portal, in development only.
 *
 * `/portal?portal-preview=live` (or `new`, `waiting`, `none`, `error`) renders the portal
 * as a signed-in advertiser in that state without an account or an API, the same way
 * `adminPreview.ts` does for the admin panel. `portal-preview=off` clears it. A production
 * build drops all of this: every entry point checks NODE_ENV first.
 */
import type { AdvertiserView, CampaignView, CreativeView, SeriesPointView } from "./apiViews";

export type PortalPreview = "live" | "new" | "waiting" | "none" | "error";
const KEY = "adcode-portal-preview";
const VALUES: readonly PortalPreview[] = ["live", "new", "waiting", "none", "error"];

export function portalPreview(): PortalPreview | null {
  if (process.env["NODE_ENV"] !== "development" || typeof window === "undefined") return null;
  try {
    const asked = new URLSearchParams(window.location.search).get("portal-preview");
    if (asked === "off") sessionStorage.removeItem(KEY);
    else if (VALUES.includes(asked as PortalPreview)) sessionStorage.setItem(KEY, asked as string);
    const saved = sessionStorage.getItem(KEY);
    return VALUES.includes(saved as PortalPreview) ? (saved as PortalPreview) : null;
  } catch {
    return null;
  }
}

const DAY = 86_400_000;
const LOGO =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#2b2a24"/><path d="M9 21l5-10 4 7 2-3 3 6" stroke="#f1efe7" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  );

function campaigns(preview: PortalPreview): CampaignView[] {
  if (preview === "new" || preview === "none") return [];
  const now = Date.now();
  const list: CampaignView[] = [
    { campaignId: "camp_tracewell_launch", name: "Tracewell · Nov 2026", status: preview === "waiting" ? "paused" : "active", cpmMicros: "2400000", budgetMicros: "250000000", spentMicros: preview === "waiting" ? "0" : "61840000", targetTags: ["lang:typescript", "fw:next", "tool:docker"], createdAt: now - 19 * DAY, serves: 41_327, impressions: preview === "waiting" ? 0 : 28_413, clicks: preview === "waiting" ? 0 : 389 },
  ];
  if (preview === "live") {
    list.push(
      { campaignId: "camp_tracewell_rust", name: "Tracewell for Rust", status: "paused", cpmMicros: "2000000", budgetMicros: "80000000", spentMicros: "12410000", targetTags: ["lang:rust", "tool:cargo"], createdAt: now - 33 * DAY, serves: 9_214, impressions: 6_205, clicks: 71 },
      { campaignId: "camp_tracewell_beta", name: "Tracewell beta invite", status: "ended", cpmMicros: "2000000", budgetMicros: "25000000", spentMicros: "25000000", targetTags: [], createdAt: now - 61 * DAY, serves: 17_902, impressions: 12_500, clicks: 143 },
    );
  }
  return list;
}

function series(preview: PortalPreview, days: number): SeriesPointView[] {
  if (preview !== "live") return [];
  const out: SeriesPointView[] = [];
  for (let index = days - 1; index >= 0; index--) {
    const day = new Date(Date.now() - index * DAY).toISOString().slice(0, 10);
    const wave = Math.round(1180 + 420 * Math.sin(index / 2.3) + (days - index) * 9);
    if (index < 19) out.push({ day, campaignId: "camp_tracewell_launch", impressions: wave, clicks: Math.round(wave * 0.0137), spentMicros: String(wave * 2_176) });
    if (index > 10 && index < 33) out.push({ day, campaignId: "camp_tracewell_rust", impressions: Math.round(wave / 4.4), clicks: Math.round(wave / 330), spentMicros: String(Math.round(wave / 4.4) * 2_000) });
  }
  return out;
}

function creatives(campaignId: string): CreativeView[] {
  const base = { campaignId, advertiser: "Tracewell", clickUrl: "https://tracewell.dev/developers", logoLight: LOGO, logoDark: LOGO };
  return [
    { ...base, creativeId: `${campaignId}_a`, headline: "Find the line that broke prod", body: "Error tracking that opens the failing commit for you.", status: "approved" },
    { ...base, creativeId: `${campaignId}_b`, headline: "Stack traces that point at the commit", body: null, status: "approved" },
    { ...base, creativeId: `${campaignId}_c`, headline: "Free for teams under five", body: "No card needed.", status: "rejected" },
  ];
}

/** A pretend success for a portal write, shaped like what the API returns. */
export function portalPreviewWrite(path: string): unknown {
  const bare = path.split("?")[0] ?? path;
  if (bare === "/portal/advertiser") return { advertiserId: "adv_tracewell", name: "Tracewell", status: "active", fundedMicros: "0", reservedMicros: "0", availableMicros: "0" };
  if (bare === "/portal/campaigns") return campaigns("waiting")[0];
  if (bare === "/portal/creatives") return creatives("camp_tracewell_launch")[0];
  if (bare === "/portal/checkout") return { orderId: "ord_preview", sessionId: "ses_preview", checkoutUrl: "/portal?checkout=success" };
  return campaigns("live")[0];
}

/** A fixture for a portal GET, or null when the path is not one the portal reads. */
export function portalPreviewResponse(preview: PortalPreview, path: string): { ok: true; value: unknown } | { ok: false; error: "no-advertiser" | "server-error" } | null {
  if (preview === "error") return { ok: false, error: "server-error" };
  const bare = path.split("?")[0] ?? path;
  if (bare === "/portal/advertiser") {
    if (preview === "none") return { ok: false, error: "no-advertiser" };
    const funded = preview === "live" ? 400_000_000n : preview === "waiting" ? 40_000_000n : 0n;
    const reserved = preview === "live" ? 188_160_000n : 0n;
    const view: AdvertiserView = { advertiserId: "adv_tracewell", name: "Tracewell", status: "active", fundedMicros: funded.toString(), reservedMicros: reserved.toString(), availableMicros: (funded - reserved).toString() };
    return { ok: true, value: view };
  }
  if (bare === "/portal/campaigns") return { ok: true, value: campaigns(preview) };
  if (bare === "/portal/series") return { ok: true, value: series(preview, Number(new URLSearchParams(path.split("?")[1] ?? "").get("days") ?? 30)) };
  const cards = /^\/portal\/campaigns\/([^/]+)\/creatives$/.exec(bare);
  if (cards !== null) return { ok: true, value: creatives(cards[1] ?? "") };
  if (bare === "/referrals") return { ok: false, error: "server-error" };
  return null;
}

/** Network figures for the preview, shaped like `/v1/stats`; null outside the preview. */
export function previewNetworkStats(): import("./publicStats").PublicStats | null {
  return portalPreview() === null ? null : { impressions: 412_930, clicks: 5_861, activeCampaigns: 4, developers: 15_284, developersThisWeek: 1_127, asOf: Date.now() };
}
