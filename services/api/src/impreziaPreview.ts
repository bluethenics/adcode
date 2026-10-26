import { LIMITS, type ServedCreative } from "./contract.ts";
import { publicHttpsUrl, type AdNetworkConfig } from "./adNetworkConfig.ts";
import { AdNetworkProviderError } from "./adNetworkHttp.ts";

/** Verified against https://demo.imprezia.ai/docs/exchange on 25 October 2026.
 * Test auctions only: never execute returned HTML, trackers, or bearer notice URLs.
 */
export async function previewImprezia(config: AdNetworkConfig, key: string, requestId: string, fetchImpl: typeof fetch = fetch): Promise<ServedCreative | null> {
  const supply = config.imprezia;
  if (config.provider !== "imprezia" || !supply) throw new AdNetworkProviderError();
  const native = { ver: "1.2", assets: [
    { id: 1, required: 1, title: { len: LIMITS.headline } },
    { id: 2, required: 1, img: { type: 3, wmin: 300, hmin: 157 } },
    { id: 3, required: 0, data: { type: 2, len: 140 } },
    { id: 4, required: 0, data: { type: 1, len: LIMITS.advertiser } },
  ], eventtrackers: [{ event: 1, methods: [1] }] };
  try {
    const response = await fetchImpl("https://x.imprezia.ai/v1/bid", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(700),
      headers: { "content-type": "application/json", "X-API-Key": key, "X-OpenRTB-Version": "2.6" },
      body: JSON.stringify({ id: requestId, at: 1, test: 1, tmax: 250, cur: ["USD"],
        imp: [{ id: "1", secure: 1, native: { ver: "1.2", request: JSON.stringify(native) } }],
        ...(supply.kind === "app" ? { app: { bundle: supply.id } } : { site: { domain: supply.id, page: `https://${supply.id}/` } }),
      }),
    });
    if (response.status === 204) return null;
    if (response.status !== 200 || !response.headers.get("content-type")?.includes("application/json")) throw new AdNetworkProviderError();
    const reader = response.body?.getReader();
    if (!reader) throw new AdNetworkProviderError();
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 128_000) { await reader.cancel(); throw new AdNetworkProviderError(); }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const raw = JSON.parse(new TextDecoder().decode(bytes));
    const bid = raw?.seatbid?.[0]?.bid?.[0];
    if (raw?.id !== requestId || raw.cur !== "USD" || bid?.impid !== "1" || typeof bid.id !== "string" || !bid.id || typeof bid.price !== "number" || !Number.isFinite(bid.price) || bid.price < 0 || !Number.isSafeInteger(bid.exp) || bid.exp <= 0 || typeof bid.adm !== "string") throw new AdNetworkProviderError();
    const parsed = JSON.parse(bid.adm); const ad = parsed.native ?? parsed;
    if (!Array.isArray(ad.assets) || ad.assets.length > 50) throw new AdNetworkProviderError();
    const ids = ad.assets.map((asset: { id?: unknown }) => asset?.id);
    if (new Set(ids).size !== ids.length) throw new AdNetworkProviderError();
    const asset = (id: number) => ad.assets.find((item: { id?: unknown }) => item?.id === id);
    const headline = asset(1)?.title?.text, logo = asset(2)?.img?.url;
    const body = asset(3)?.data?.value, advertiser = asset(4)?.data?.value ?? "Sponsored";
    const text = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;
    if (!text(headline, LIMITS.headline) || !text(advertiser, LIMITS.advertiser) || body !== undefined && !text(body, LIMITS.body) || !publicHttpsUrl(logo) || !publicHttpsUrl(ad.link?.url)) throw new AdNetworkProviderError();
    return { creativeId: "test-only", headline, advertiser, body: body ?? null, clickUrl: ad.link.url, logoLight: logo, logoDark: logo, ttlMs: Math.min(bid.exp * 1000, 3_600_000) };
  } catch { throw new AdNetworkProviderError(); }
}
