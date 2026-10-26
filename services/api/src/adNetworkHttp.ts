import { LIMITS, type ServedCreative, type ServeRequestBody } from "./contract.ts";
import { publicHttpsUrl, type AdNetworkConfig, type AdNetworkDelivery } from "./adNetworkConfig.ts";

export class AdNetworkProviderError extends Error {
  constructor() { super("The provider could not return a valid response. Check its endpoint, mappings and API key."); }
}
function at(raw: unknown, path: string): unknown {
  if (path === "") return undefined;
  let value = raw;
  for (const part of path.split(".")) {
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, part)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}
function template(raw: unknown, values: Record<string, unknown>, depth = 0): unknown {
  if (depth > 12) throw new AdNetworkProviderError();
  if (typeof raw === "string") {
    const placeholder = /^\{\{([A-Za-z]+)\}\}$/.exec(raw);
    if (placeholder) { if (!Object.hasOwn(values, placeholder[1]!)) throw new AdNetworkProviderError(); return values[placeholder[1]!]; }
    return raw;
  }
  if (Array.isArray(raw)) return raw.map(value => template(value, values, depth + 1));
  if (raw && typeof raw === "object") return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, template(value, values, depth + 1)]));
  return raw;
}
/** Never follow redirects with an API key and never reflect upstream bodies or errors into the admin page. */
async function json(url: string, init: RequestInit, fetchImpl: typeof fetch): Promise<unknown> {
  try {
    const response = await fetchImpl(url, { ...init, redirect: "error", signal: AbortSignal.timeout(1_200) });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw new AdNetworkProviderError();
    const reader = response.body?.getReader();
    if (!reader) throw new AdNetworkProviderError();
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const next = await reader.read(); if (next.done) break;
        size += next.value.byteLength;
        if (size > 128_000) { await reader.cancel(); throw new AdNetworkProviderError(); }
        chunks.push(next.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { throw new AdNetworkProviderError(); }
}
const text = (raw: unknown, max: number): raw is string => typeof raw === "string" && raw.trim().length > 0 && raw.length <= max;
export async function requestNetworkCreative(config: AdNetworkConfig, key: string, body: ServeRequestBody, requestId: string, ttlMs: number, fetchImpl: typeof fetch = fetch): Promise<(ServedCreative & { providerCreativeId: string }) | null> {
  const http = config.http;
  if (config.provider !== "http-json" || !http) throw new AdNetworkProviderError();
  const headers = { "content-type": "application/json", accept: "application/json", [http.authHeader]: `${http.authPrefix}${key}` };
  const payload = template(http.requestTemplate, { tags: body.tags, theme: body.themeKind, requestId });
  let url = http.serveUrl;
  if (http.method === "GET" && payload && typeof payload === "object" && !Array.isArray(payload)) {
    const query = new URL(url);
    for (const [name, value] of Object.entries(payload)) query.searchParams.set(name, typeof value === "string" ? value : JSON.stringify(value));
    url = query.href;
  }
  const raw = await json(url, { method: http.method, headers, ...(http.method === "POST" ? { body: JSON.stringify(payload) } : {}) }, fetchImpl);
  const creative = http.creativePath ? at(raw, http.creativePath) : raw;
  if (creative === null || creative === undefined || Array.isArray(creative) && creative.length === 0) return null;
  const fields = Object.fromEntries(Object.entries(http.fields).map(([name, path]) => [name, at(creative, path)]));
  if (!text(fields["id"], 200) || !text(fields["advertiser"], LIMITS.advertiser) || !text(fields["headline"], LIMITS.headline) || !publicHttpsUrl(fields["clickUrl"]) || !publicHttpsUrl(fields["logoLight"]) || fields["body"] != null && !text(fields["body"], LIMITS.body) || fields["logoDark"] != null && !publicHttpsUrl(fields["logoDark"])) throw new AdNetworkProviderError();
  return { creativeId: "", providerCreativeId: fields["id"], advertiser: fields["advertiser"], headline: fields["headline"], body: fields["body"] as string | undefined ?? null, clickUrl: fields["clickUrl"], logoLight: fields["logoLight"], logoDark: fields["logoDark"] as string | undefined ?? fields["logoLight"], ttlMs };
}
export async function verifyNetworkEvent(config: AdNetworkConfig, key: string, delivery: AdNetworkDelivery, event: "impression" | "click", fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const http = config.http;
  if (config.provider !== "http-json" || !http) return null;
  const eventId = `${delivery.id}:${event}`;
  const body = template(http.verifyTemplate, { providerCreativeId: delivery.providerCreativeId, requestId: delivery.id, event, eventId });
  const raw = await json(http.verifyUrl, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", [http.authHeader]: `${http.authPrefix}${key}`, "idempotency-key": eventId }, body: JSON.stringify(body) }, fetchImpl);
  const providerEvent = at(raw, http.eventIdPath);
  return at(raw, http.verifiedPath) === true && text(providerEvent, 200) ? providerEvent : null;
}
/** beehiiv provides newsletter-offer content, not an in-app impression/click settlement API. Read-only. */
export async function previewBeehiiv(config: AdNetworkConfig, key: string, fetchImpl: typeof fetch = fetch): Promise<{ id: string; name: string; headline: string; text: string; description: string }[]> {
  if (config.provider !== "beehiiv" || !config.beehiiv) throw new AdNetworkProviderError();
  const { publicationId, offerId } = config.beehiiv;
  const raw = await json(`https://api.beehiiv.com/v2/publications/${encodeURIComponent(publicationId)}/ad_network/offers/${encodeURIComponent(offerId)}/advertisements`, { headers: { authorization: `Bearer ${key}`, accept: "application/json" } }, fetchImpl);
  const ads = at(raw, "advertisements");
  if (!Array.isArray(ads) || ads.length > 100) throw new AdNetworkProviderError();
  return ads.map(ad => {
    const item = ad as Record<string, unknown>;
    if (!item || !text(item["id"], 200)) throw new AdNetworkProviderError();
    const safe = (name: string): string => typeof item[name] === "string" ? (item[name] as string).slice(0, 8000) : "";
    return { id: String(item["id"]), name: safe("name"), headline: safe("headline"), text: safe("text"), description: safe("description") };
  });
}
