import { createHash } from "node:crypto";
import { LIMITS, type ServedCreative, type ServeRequestBody } from "./contract.ts";
import { publicHttpsUrl } from "./adNetworkConfig.ts";
import { AdNetworkProviderError, json } from "./adNetworkHttp.ts";

/**
 * Imprezia's Chat Ads API, server to server (https://demo.imprezia.ai/docs, verified
 * 27 October 2026). A publisher key picks its environment by prefix; partner endpoints
 * refuse any request carrying an Origin header, so this only ever runs on the server.
 *
 * Privacy: Imprezia targets on a request/response pair. ADCode never sends the user's
 * prompt, code or answer - only the workspace's language and framework tags.
 */
export function impreziaBaseUrl(key: string): string {
  if (key.startsWith("api_pub_sandbox_")) return "https://api-sandbox.imprezia.ai";
  if (key.startsWith("api_pub_beta_")) return "https://api-beta.imprezia.ai";
  return "https://api.imprezia.ai";
}

/** Sandbox ads are house ads with no revenue behind them; they never pay a user. */
export const isImpreziaSandboxKey = (key: string): boolean => key.startsWith("api_pub_sandbox_");

/** What settlement needs later: the impression to report, packed into the delivery row. */
export interface ImpreziaImpression { uuid: string; token: string; issuedAt: number; kid: string }
const PREFIX = "imprezia1:";
export function packImpression(impression: ImpreziaImpression): string {
  return PREFIX + JSON.stringify([impression.uuid, impression.token, impression.issuedAt, impression.kid]);
}
export function unpackImpression(raw: string): ImpreziaImpression | null {
  if (!raw.startsWith(PREFIX)) return null;
  try {
    const [uuid, token, issuedAt, kid] = JSON.parse(raw.slice(PREFIX.length)) as unknown[];
    return typeof uuid === "string" && typeof token === "string" && typeof kid === "string" && Number.isSafeInteger(issuedAt)
      ? { uuid, token, issuedAt: issuedAt as number, kid } : null;
  } catch { return null; }
}

/**
 * One stable session per person per UTC day. Imprezia asks for a conversation ID; an ad
 * slot in an editor has no conversation, and a raw user ID is exactly what its docs say
 * not to send. A one-way daily hash keeps frequency control working without identifying anyone.
 */
export function impreziaSessionId(uid: string, now: number): string {
  return `adc_${createHash("sha256").update(`${uid}:${Math.floor(now / 86_400_000)}`).digest("hex").slice(0, 32)}`;
}

/** The context Imprezia sees: tags only, in the request/response shape its API requires. */
export function impreziaContext(tags: readonly string[]): { request: string; response: string } {
  // Targeting tags arrive as "lang:typescript"; Imprezia reads plain words.
  const topics = [...new Set(tags.map(tag => tag.replace(/^[a-z]+:/, "")).filter(tag => /^[A-Za-z0-9.+#-]{1,30}$/.test(tag)))].slice(0, 8);
  const subject = topics.length > 0 ? topics.join(", ") : "software";
  return {
    request: `Help me with my ${subject} project`,
    response: `Working on the ${subject} code in ADCode, an AI code editor.`,
  };
}

const clip = (value: string, max: number): string => value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

export async function requestImpreziaChatAd(
  key: string,
  body: Pick<ServeRequestBody, "tags">,
  sessionId: string,
  ttlMs: number,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 2_000,
): Promise<(ServedCreative & { providerCreativeId: string }) | null> {
  const raw = await json(`${impreziaBaseUrl(key)}/v1/ads/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", "X-API-Key": key },
    body: JSON.stringify({ ...impreziaContext(body.tags), sessionId }),
  }, fetchImpl, timeoutMs) as { ad?: unknown } | null;
  const ad = raw?.ad as { format?: unknown; creative?: Record<string, unknown>; clickUrl?: unknown; impression?: { impressionUuid?: unknown; beaconToken?: { token?: unknown; issuedAt?: unknown; kid?: unknown } } } | null | undefined;
  if (ad === null || ad === undefined) return null;
  const creative = ad.creative, impression = ad.impression, beacon = impression?.beaconToken;
  // Native cards only: banner HTML would have to execute in the editor, which it never does.
  if (ad.format !== "native" || !creative || !text(creative["title"]) || !publicHttpsUrl(ad.clickUrl) || !publicHttpsUrl(creative["imageUrl"])
    || !text(impression?.impressionUuid) || !text(beacon?.token) || !Number.isSafeInteger(beacon?.issuedAt) || !text(beacon?.kid)) throw new AdNetworkProviderError();
  const image = creative["imageUrl"];
  return {
    creativeId: "",
    providerCreativeId: packImpression({ uuid: impression.impressionUuid, token: beacon.token, issuedAt: beacon.issuedAt as number, kid: beacon.kid }),
    // The advertiser is whoever bought the ad; Imprezia is only the network that served it.
    advertiser: clip(text(creative["brandName"]) ? creative["brandName"] : "Ad via Imprezia", LIMITS.advertiser),
    headline: clip(creative["title"], LIMITS.headline),
    body: text(creative["description"]) ? clip(creative["description"], LIMITS.body) : null,
    clickUrl: ad.clickUrl,
    logoLight: image,
    logoDark: image,
    // The image URL is signed for an hour; never cache the card past it.
    ttlMs: Math.min(ttlMs, 50 * 60_000),
  };
}

/**
 * Tell Imprezia the card was seen. The endpoint answers 204 to anything, so this proves
 * nothing back to us: Imprezia's own reporting is the record of what it counted.
 */
export async function reportImpreziaImpression(key: string, impression: ImpreziaImpression, fetchImpl: typeof fetch = fetch): Promise<void> {
  const response = await fetchImpl(`${impreziaBaseUrl(key)}/v1/events/sdk-impression`, {
    method: "POST", redirect: "manual", signal: AbortSignal.timeout(1_500),
    headers: { "content-type": "application/json", "X-API-Key": key },
    body: JSON.stringify({ impressionUuid: impression.uuid, beaconToken: { token: impression.token, issuedAt: impression.issuedAt, kid: impression.kid } }),
  });
  if (!response.ok) throw new AdNetworkProviderError();
}
