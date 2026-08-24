/**
 * Everything about the site that changes when the domain does.
 *
 * One module rather than scattered literals, because canonical URLs, the sitemap, the
 * JSON-LD, the Open Graph tags, and the installer command all have to agree. When they
 * disagree, search engines index one host and users install from another.
 */

/** Swap this, or set NEXT_PUBLIC_SITE_ORIGIN, when the real domain is registered. */
export const SITE_ORIGIN = process.env["NEXT_PUBLIC_SITE_ORIGIN"] ?? "https://adcode.bluethenics.com";

/** The Firebase project everything is deployed into. */
export const FIREBASE_PROJECT = process.env["NEXT_PUBLIC_FIREBASE_PROJECT_ID"] ?? "adcode-idle";

/**
 * Where the API lives.
 *
 * The site's own origin, because `services/api` is served by this deployment at `/v1/*`
 * rather than by a separate host - see `src/app/v1/[...segments]/route.ts`. That is what
 * makes every call from these pages same-origin, so there is no CORS preflight and no
 * second deployment to keep alive. Override only to point at a locally running API.
 */
export const API_ORIGIN = process.env["NEXT_PUBLIC_API_ORIGIN"] ?? SITE_ORIGIN;

/** Owner/repo that release artifacts are published to. */
export const GITHUB_REPO = process.env["NEXT_PUBLIC_GITHUB_REPO"] ?? "bluethenics/adcode";

export const SITE = {
  name: "ADCode",
  tagline: "An editor that pays you back",
  description:
    "ADCode is a full IDE - Monaco editing, real terminals, git, four AI providers - that shows an occasional sponsored card and credits you for it. Every cent is on an append-only ledger you can audit.",
  origin: SITE_ORIGIN,
  locale: "en_US",
} as const;

export const url = (path = "/"): string => new URL(path, SITE_ORIGIN).toString();

/**
 * The numbers the site quotes, in one place.
 *
 * These mirror `DEFAULT_CONFIG` in `services/api/src/memoryStore.ts`. Marketing copy that
 * drifts from the server's actual rates is worse than no copy at all, so anything on the
 * page that states a figure reads it from here.
 */
export const ECONOMICS = {
  cpmMicros: 8_000_000n,
  revSharePercent: 50n,
  /** Ads per hour at the default "standard" cadence. */
  adsPerHourStandard: 4,
} as const;

/** What one impression pays the user, in micros. Same arithmetic the server does. */
export const perImpressionMicros =
  ((ECONOMICS.cpmMicros / 1000n) * ECONOMICS.revSharePercent) / 100n;

/** Micros to a currency string. Six decimals: the ledger does not round, so neither does this. */
export function formatMicros(micros: bigint, decimals = 6): string {
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, "0").slice(0, decimals);
  return `${negative ? "-" : ""}$${whole}.${frac}`;
}
