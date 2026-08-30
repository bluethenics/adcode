/**
 * Everything about the site that changes when the domain does.
 *
 * One module rather than scattered literals, because canonical URLs, the sitemap, the
 * JSON-LD, the Open Graph tags, and the installer command all have to agree. When they
 * disagree, search engines index one host and users install from another.
 */

import packageJson from "../../package.json";

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
 *
 * Empty counts as unset. `.env.example` ships the key with no value - which is what "leave
 * this alone unless you mean it" looks like in an env file - and `??` would happily hand
 * back that empty string, making every server-side call a relative URL that no fetch can
 * resolve. Anyone copying the example into `.env.production`, as SETUP.md step 8 says to,
 * would hit it.
 */
const CONFIGURED_API_ORIGIN = process.env["NEXT_PUBLIC_API_ORIGIN"];

export const API_ORIGIN =
  CONFIGURED_API_ORIGIN === undefined || CONFIGURED_API_ORIGIN === ""
    ? SITE_ORIGIN
    : CONFIGURED_API_ORIGIN;

/** Owner/repo that release artifacts are published to. */
export const GITHUB_REPO = process.env["NEXT_PUBLIC_GITHUB_REPO"] ?? "bluethenics/adcode";

/**
 * The version this build documents.
 *
 * Read from the package rather than typed here, so `npm version` moves it and the
 * SoftwareApplication data cannot claim a release that was never cut. It is the app the
 * site is about, and this workspace is versioned in lockstep with the desktop one.
 */
export const APP_VERSION: string = packageJson.version;

export const SITE = {
  name: "ADCode",
  tagline: "Earn while you code",
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
  impressionsPerBlock: 500n,
  floorBlockMicros: 1_000_000n,
  floorCpmMicros: 2_000_000n,
  cpmMicros: 2_000_000n,
  revSharePercent: 50n,
  /** Ads per hour at the default "standard" cadence: one every ten minutes. */
  adsPerHourStandard: 6,
} as const;

/** CPM is retained at the API boundary; the marketplace quotes 500-impression blocks. */
export const cpmMicrosToBlockMicros = (cpmMicros: bigint): bigint =>
  (cpmMicros * ECONOMICS.impressionsPerBlock) / 1000n;

export const blockMicrosToCpmMicros = (blockMicros: bigint): bigint =>
  (blockMicros * 1000n) / ECONOMICS.impressionsPerBlock;

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
