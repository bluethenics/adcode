import { createHash } from "node:crypto";
import type { AdNetworkConfig, AdNetworkStore } from "./adNetworkConfig.ts";
import { adNetworkEncryptionKeys, decryptAdNetworkKey } from "./adNetworkCrypto.ts";
import { impreziaBaseUrl, impreziaKeyMode } from "./impreziaChatAds.ts";
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
 * - only the SDK's monetize, display and event paths are forwarded, so the key cannot be used to reach
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
  /** Hears one line per ad answer (impreziaAnswerSummary), for the Worker's logs. */
  readonly log?: (line: Record<string, unknown>) => void;
  /**
   * Pages allowed to call the relay (the sponsored page's own origin). A request whose Origin
   * is another site is refused. Absent: no origin check (tests, the local server).
   */
  readonly allowedOrigins?: readonly string[];
  /** Requests a minute from everybody together; past it the relay answers busy (2026-11-26 audit, finding 3). */
  readonly globalPerMinute?: number;
}

/**
 * One line about an ad answer from Imprezia, for the Worker's logs (2026-11-25: its first live
 * answers carried no ad, and the reason was nowhere to be seen). Only the answer's shape: its
 * status, whether it filled, how many ads, its field names, any reason or error it gives, and
 * which environment the saved key is for. Never the person's message or the reply (the monetize
 * answer repeats it), their address, or the key itself.
 */
export function impreziaAnswerSummary(path: string, status: number, text: string, keyMode: string): Record<string, unknown> | null {
  const kind = path.startsWith("/v1/display") ? "display" : path.startsWith("/v1/monetize/") ? "monetize" : null;
  if (kind === null) return null;
  let parsed: unknown = null;
  try { parsed = JSON.parse(text); } catch { /* not JSON: noted below */ }
  const record = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {});
  const body = record(parsed);
  const metadata = record(body["metadata"]);
  const links = Object.keys(record(body["linkData"]));
  const reasonNames = ["error", "message", "reason", "noFillReason", "no_fill_reason", "skipReason"];
  const said = [...reasonNames.map((name) => body[name]), ...reasonNames.map((name) => metadata[name])].find((value) => typeof value === "string") as string | undefined;
  return {
    imprezia: kind,
    status,
    keyMode,
    ...(kind === "display" ? { noFill: body["no_fill"] === true } : {}),
    ads: links.length,
    cards: links.filter((name) => name.startsWith("card-")).length,
    fields: Object.keys(body).slice(0, 15),
    ...(Object.keys(metadata).length > 0 ? { metadataFields: Object.keys(metadata).slice(0, 15) } : {}),
    ...(said === undefined ? {} : { said: said.slice(0, 160) }),
    ...(parsed === null && text.length > 0 ? { notJson: text.slice(0, 80) } : {}),
  };
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
  /** The Origin header, when the browser sent one. Same-origin GETs and beacons may not. */
  readonly origin?: string | undefined;
}

export interface ImpreziaProxyResponse {
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
}

/**
 * The SDK's own calls: monetizing a reply, its 320x50 banner for the ad box above the chat's
 * message box (`/v1/display`, 2026-11-25), and the events it reports about what it showed.
 */
const FORWARDED = /^\/v1\/(?:(?:monetize|events)\/[A-Za-z0-9/_-]{1,80}|display)(?:\?[A-Za-z0-9=&%._-]{0,200})?$/;
const PER_NETWORK_PER_MINUTE = 120;
/** Callers with no address Imprezia could locate share one bucket; it is kept small so one cannot starve the rest. */
const NO_ADDRESS_PER_MINUTE = 30;
/** Everybody together, by default: far above today's traffic, far below what a script farm would send. */
export const RELAY_GLOBAL_PER_MINUTE = 3_000;
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

  // Another site's page cannot spend ADCode's key through this relay. "null" is a sandboxed
  // frame (the partner's own card renderer); a missing Origin is a same-origin GET or a beacon.
  if (deps.allowedOrigins !== undefined && request.origin !== undefined && request.origin !== "null" && !deps.allowedOrigins.includes(request.origin)) return json(403, "origin-not-allowed");

  const ip = forwardableIp(request.ip);
  const now = deps.now();
  const minute = now - (now % 60_000);
  const network = createHash("sha256").update(`imprezia-relay:${ip ?? "none"}`).digest("hex").slice(0, 32);
  if (await deps.bump(`imprezia-relay:${network}`, minute) > (ip === undefined ? NO_ADDRESS_PER_MINUTE : PER_NETWORK_PER_MINUTE)) return json(429, "busy");
  if (await deps.bump("imprezia-relay:all", minute) > (deps.globalPerMinute ?? RELAY_GLOBAL_PER_MINUTE)) return json(429, "busy");

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
    const text = await upstream.text();
    if (deps.log !== undefined) {
      try {
        const line = impreziaAnswerSummary(path, upstream.status, text, impreziaKeyMode(key));
        if (line !== null) deps.log(line);
      } catch { /* a log line never breaks the card */ }
    }
    return { status: upstream.status, contentType: upstream.headers.get("content-type") ?? "application/json", body: text };
  } catch {
    return json(502, "upstream-unavailable");
  }
}
