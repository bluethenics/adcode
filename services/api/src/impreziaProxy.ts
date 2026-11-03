import { createHash } from "node:crypto";
import type { AdNetworkConfig, AdNetworkStore } from "./adNetworkConfig.ts";
import { adNetworkEncryptionKeys, decryptAdNetworkKey } from "./adNetworkCrypto.ts";
import { impreziaBaseUrl } from "./impreziaChatAds.ts";
import { validImpreziaSdkPreview } from "./impreziaSdkPreview.ts";

/**
 * `/v1/imprezia/*` - the server-side relay Imprezia's SDK recommends for production.
 *
 * The SDK runs on ADCode's sponsored-card page (`/sponsored/chat`), never in the editor's own
 * window, and points its `endpoint` here. This adds the publisher key the admin saved in
 * Ad networks - so no key ships in any client - and forwards the call unchanged.
 *
 * Deliberately narrow:
 * - only the Imprezia Chat Ads connection the admin has turned on, with a saved key, is used,
 *   so Admin > Ad networks > Turn off stops live sponsored cards;
 * - an authenticated admin can issue a five-minute permit to preview one saved connection,
 *   including a disabled connection, using exactly the same SDK and relay;
 * - only the SDK's monetize and event paths are forwarded, so the key cannot be used to reach
 *   anything else on Imprezia's API;
 * - each network address gets a request budget per minute, because these calls carry no
 *   sign-in (impression beacons are `navigator.sendBeacon`, which cannot send one).
 *
 * The person's network address goes upstream in `X-Forwarded-For`, as Imprezia asks, so its
 * geo targeting and fraud checks see the person rather than Cloudflare. It is never stored.
 */

export interface ImpreziaProxyDeps {
  readonly adNetworks: AdNetworkStore | undefined;
  readonly fetchImpl?: typeof fetch;
  readonly encryptionKeys?: () => readonly string[];
  /** Counts a request in a window and answers the new count. */
  readonly bump: (bucket: string, windowStart: number) => Promise<number>;
  readonly now: () => number;
}

export interface ImpreziaProxyRequest {
  readonly method: string;
  /** Everything after `/v1/imprezia`, query included: `/v1/monetize/append?x=1`. */
  readonly path: string;
  readonly body: string;
  readonly contentType: string;
  readonly sdkVersion: string | undefined;
  /** The SDK's own platform marker: `browser`, `android`, `ios` or `node`. */
  readonly sdkPlatform: string | undefined;
  readonly userAgent: string | undefined;
  readonly ip: string | undefined;
}

export interface ImpreziaProxyResponse {
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
}

/** The SDK's own calls: monetizing a reply, and the events it reports about what it showed. */
const FORWARDED = /^\/v1\/(?:monetize|events)\/[A-Za-z0-9/_-]{1,80}(?:\?[A-Za-z0-9=&%._-]{0,200})?$/;
const PER_NETWORK_PER_MINUTE = 120;
const MAX_BODY_CHARS = 64_000;

const json = (status: number, error: string): ImpreziaProxyResponse => ({ status, contentType: "application/json", body: JSON.stringify({ error }) });

/**
 * The SDK reports what it is running on, and Imprezia gates web features (the CSP-isolated
 * card renderer, tracker frames) on it. The relay must forward that answer, not claim to be
 * `node`: the SDK in the sponsored-card page is a browser, and calling it a server would
 * silently downgrade every card it serves.
 */
function sdkPlatform(value: string | undefined): string {
  return value === "browser" || value === "android" || value === "ios" || value === "node" ? value : "browser";
}

/** A public, routable address, or nothing - never a placeholder Imprezia cannot locate. */
export function forwardableIp(ip: string | undefined): string | undefined {
  const value = ip?.trim();
  if (!value || value.length > 45 || !/^[0-9a-fA-F:.]+$/.test(value)) return undefined;
  if (/^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|0\.)/.test(value)) return undefined;
  if (/^(?:::1$|f[cd][0-9a-f]{2}:|fe80:)/i.test(value)) return undefined;
  return value;
}

async function activeKey(deps: ImpreziaProxyDeps): Promise<string | null> {
  const port = deps.adNetworks;
  const keys = (deps.encryptionKeys ?? adNetworkEncryptionKeys)();
  if (!port || keys.length === 0) return null;
  const chat = (await port.list())
    .filter((config: AdNetworkConfig) => config.enabled && config.provider === "imprezia" && config.imprezia?.kind === "chat")
    .sort((a, b) => a.priority - b.priority);
  for (const config of chat) {
    const encrypted = await port.key(config.id);
    if (encrypted) return decryptAdNetworkKey(config.id, encrypted, keys);
  }
  return null;
}

export async function relayImprezia(deps: ImpreziaProxyDeps, request: ImpreziaProxyRequest): Promise<ImpreziaProxyResponse> {
  if (request.method !== "POST" && request.method !== "GET") return json(405, "method-not-allowed");
  const preview = /^\/preview\/([a-z][a-z0-9-]{1,39})\/([A-Za-z0-9_.-]{1,100})(\/.*)$/.exec(request.path);
  const path = preview?.[3] ?? request.path;
  if (!FORWARDED.test(path)) return json(404, "not-found");
  if (request.body.length > MAX_BODY_CHARS) return json(413, "too-large");
  // Beacons arrive as text/plain to avoid a preflight while the page unloads; both are JSON.
  let body: unknown = undefined;
  if (request.method === "POST") {
    try { body = request.body.trim() === "" ? {} : JSON.parse(request.body); } catch { return json(400, "malformed-body"); }
  }

  const ip = forwardableIp(request.ip);
  const now = deps.now();
  const network = createHash("sha256").update(`imprezia-relay:${ip ?? "none"}`).digest("hex").slice(0, 32);
  if (await deps.bump(`imprezia-relay:${network}`, now - (now % 60_000)) > PER_NETWORK_PER_MINUTE) return json(429, "busy");

  let key: string | null;
  try {
    if (preview) {
      const id = preview[1]!, keys = (deps.encryptionKeys ?? adNetworkEncryptionKeys)();
      const config = await deps.adNetworks?.get(id);
      const encrypted = await deps.adNetworks?.key(id);
      key = config?.provider === "imprezia" && config.imprezia?.kind === "chat" && encrypted ? decryptAdNetworkKey(id, encrypted, keys) : null;
      if (key === null || !validImpreziaSdkPreview(id, key, preview[2]!, keys, now)) return json(403, "preview-expired");
    } else key = await activeKey(deps);
  } catch { key = null; }
  // Off in the admin, or no key saved: the SDK falls back to the reply unchanged.
  if (key === null) return json(503, "not-configured");

  try {
    const upstream = await (deps.fetchImpl ?? fetch)(`${impreziaBaseUrl(key)}${path}`, {
      method: request.method,
      // Workers only accepts "follow" or "manual"; a 3xx is refused below rather than followed with the key.
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
      headers: {
        "content-type": "application/json",
        "X-API-Key": key,
        "X-SDK-Platform": sdkPlatform(request.sdkPlatform),
        "X-SDK-Version": (request.sdkVersion ?? "").slice(0, 40),
        "X-Forwarded-User-Agent": (request.userAgent ?? "").slice(0, 400),
        ...(ip === undefined ? {} : { "X-Forwarded-For": ip }),
      },
      ...(request.method === "GET" ? {} : { body: JSON.stringify(body) }),
    });
    if (upstream.status >= 300 && upstream.status < 400) return json(502, "upstream-unavailable");
    return { status: upstream.status, contentType: upstream.headers.get("content-type") ?? "application/json", body: await upstream.text() };
  } catch {
    return json(502, "upstream-unavailable");
  }
}
