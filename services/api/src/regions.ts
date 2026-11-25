/**
 * Region targeting: which countries a campaign serves in.
 *
 * Stored with the context tags in `campaigns.target_tags`, as `geo:US`, `geo:DE` and so on,
 * so it needed no new column. The two kinds combine differently, and `campaignMatches` is
 * the one place that says how: a campaign must match one of its context tags (if it has
 * any) AND one of its regions (if it has any).
 *
 * Where a request comes from is never something the client says. The editor sends only its
 * context tags; `/v1/serve` reads the country Cloudflare's edge attaches to the connection
 * (`cf-ipcountry`), turns it into a `geo:` tag for that one auction, and stores it nowhere.
 * A client-sent `geo:` tag is dropped by `parseServeRequest`, because `isTag` does not know
 * the prefix. An unknown country (`XX`, Tor's `T1`) adds no tag, so a region-targeted
 * campaign simply does not serve there: it cannot be shown to somewhere it was not bought for.
 */

/** ISO 3166-1 alpha-2, the codes Cloudflare reports. */
export const COUNTRY_CODES = [
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT", "AU", "AW", "AX", "AZ",
  "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ", "BR", "BS",
  "BT", "BV", "BW", "BY", "BZ", "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN",
  "CO", "CR", "CU", "CV", "CW", "CX", "CY", "CZ", "DE", "DJ", "DK", "DM", "DO", "DZ", "EC", "EE",
  "EG", "EH", "ER", "ES", "ET", "FI", "FJ", "FK", "FM", "FO", "FR", "GA", "GB", "GD", "GE", "GF",
  "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS", "GT", "GU", "GW", "GY", "HK", "HM",
  "HN", "HR", "HT", "HU", "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT", "JE", "JM",
  "JO", "JP", "KE", "KG", "KH", "KI", "KM", "KN", "KP", "KR", "KW", "KY", "KZ", "LA", "LB", "LC",
  "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY", "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK",
  "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ", "NA",
  "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ", "OM", "PA", "PE", "PF", "PG",
  "PH", "PK", "PL", "PM", "PN", "PR", "PS", "PT", "PW", "PY", "QA", "RE", "RO", "RS", "RU", "RW",
  "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS",
  "ST", "SV", "SX", "SY", "SZ", "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO",
  "TR", "TT", "TV", "TW", "TZ", "UA", "UG", "UM", "US", "UY", "UZ", "VA", "VC", "VE", "VG", "VI",
  "VN", "VU", "WF", "WS", "YE", "YT", "ZA", "ZM", "ZW", "XK",
] as const;

const COUNTRY_SET: ReadonlySet<string> = new Set(COUNTRY_CODES);
export const REGION_PREFIX = "geo:";

/** The most countries one campaign may list, so a row cannot become the whole table. */
export const MAX_REGIONS = 60;

/**
 * Shortcuts the portal offers: picking one selects its countries. Only the countries are
 * stored, so a group can change without rewriting a campaign.
 */
export const REGION_GROUPS: readonly { id: string; label: string; countries: readonly string[] }[] = [
  { id: "na", label: "North America", countries: ["US", "CA"] },
  { id: "eu", label: "European Union", countries: ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"] },
  { id: "uk", label: "UK and Ireland", countries: ["GB", "IE"] },
  { id: "dach", label: "Germany, Austria, Switzerland", countries: ["DE", "AT", "CH"] },
  { id: "nordics", label: "Nordics", countries: ["DK", "FI", "IS", "NO", "SE"] },
  { id: "latam", label: "Latin America", countries: ["AR", "BO", "BR", "CL", "CO", "CR", "DO", "EC", "GT", "HN", "MX", "NI", "PA", "PE", "PY", "SV", "UY", "VE"] },
  { id: "india", label: "India and South Asia", countries: ["IN", "BD", "LK", "NP", "PK"] },
  { id: "sea", label: "Southeast Asia", countries: ["ID", "MY", "PH", "SG", "TH", "VN"] },
  { id: "eastasia", label: "East Asia", countries: ["JP", "KR", "TW", "HK"] },
  { id: "anz", label: "Australia and New Zealand", countries: ["AU", "NZ"] },
  { id: "mena", label: "Middle East and North Africa", countries: ["AE", "SA", "QA", "KW", "BH", "OM", "IL", "JO", "EG", "MA", "TN", "TR"] },
  { id: "africa", label: "Sub-Saharan Africa", countries: ["NG", "KE", "ZA", "GH", "ET", "UG", "TZ", "RW", "SN", "CM"] },
];

export function isCountryCode(value: string): boolean {
  return COUNTRY_SET.has(value);
}

export function isRegionTag(value: string): boolean {
  return value.startsWith(REGION_PREFIX) && isCountryCode(value.slice(REGION_PREFIX.length));
}

export function regionTag(country: string): string {
  return `${REGION_PREFIX}${country}`;
}

/** The `geo:` tag for a request's country header, or null when it names no real country. */
export function requestRegionTag(header: string | null | undefined): string | null {
  const code = (header ?? "").trim().toUpperCase();
  return isCountryCode(code) ? regionTag(code) : null;
}

/**
 * Where a request comes from, as the edge saw it (2026-11-24): what decides a Zeekend card's pay.
 *
 * On the Worker, the fetch handler stamps each request with Cloudflare's own `request.cf.country`
 * under this symbol - null when Cloudflare knew none - and then nothing else is consulted: no
 * header can be trusted to have come from the edge rather than from the caller. Only a server
 * with no edge in front (the local Node server and the tests) falls back to `cf-ipcountry`.
 * Anything that is not a real ISO code (`XX`, Tor's `T1`) is null: no country, the default rate.
 */
export const EDGE_COUNTRY: unique symbol = Symbol.for("adcode.edgeCountry");
export interface EdgeCountryCarrier { headers: Record<string, string | string[] | undefined>; [EDGE_COUNTRY]?: string | null }
export function edgeCountry(req: EdgeCountryCarrier): string | null {
  const raw = req[EDGE_COUNTRY] !== undefined ? req[EDGE_COUNTRY] : req.headers["cf-ipcountry"];
  const code = (Array.isArray(raw) ? raw[0] ?? "" : raw ?? "").trim().toUpperCase();
  return isCountryCode(code) ? code : null;
}

/** The countries a set of target tags names, in the order given. */
export function regionsOf(tags: readonly string[]): string[] {
  return tags.filter(isRegionTag).map((tag) => tag.slice(REGION_PREFIX.length));
}

/**
 * Whether a campaign's targeting admits a request's tags.
 *
 * Context tags are any-of: a campaign for Rust or Go serves to someone in either. Regions
 * are any-of too, but required on top: a campaign for Rust in Germany serves to a Rust
 * developer in Germany, never to a Rust developer elsewhere or a Python one in Berlin.
 * No tags of a kind means no restriction of that kind.
 */
export function campaignMatches(targetTags: readonly string[], requestTags: readonly string[]): boolean {
  const wanted = new Set(requestTags);
  let contexts = 0;
  let contextHit = false;
  let regions = 0;
  let regionHit = false;
  for (const tag of targetTags) {
    if (isRegionTag(tag)) {
      regions++;
      if (wanted.has(tag)) regionHit = true;
    } else {
      contexts++;
      if (wanted.has(tag)) contextHit = true;
    }
  }
  return (contexts === 0 || contextHit) && (regions === 0 || regionHit);
}
