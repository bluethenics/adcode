/**
 * Public API reads, answered from Cloudflare's cache instead of the database.
 *
 * The API's public reads have always sent `cache-control: public, max-age=60` and the code said
 * they were "cached at the edge" - but a response a Worker generates never enters Cloudflare's
 * cache by itself. Every status-page refresh and every editor's model-list fetch was a database
 * read: about 55,000 a day for `/v1/status` alone on 2026-10-21, the day the database ran out of
 * I/O and hung. Here the Worker stores them itself, in the data centre's shared cache, so one
 * read per data centre per minute serves everybody there.
 *
 * Copies are kept for a day after they go stale. When the database cannot answer, a person gets
 * the last good copy instead of an error - a model list from ten minutes ago is far better than
 * an editor that says included AI does not exist.
 *
 * Only unauthenticated GETs of the routes listed here, keyed on the parameters each one reads
 * (so a random query string cannot force a database read) and on the Origin header (CORS echoes
 * it, so one origin's answer must never be handed to another).
 */

export interface EdgeCacheStore {
  match(key: Request): Promise<Response | undefined>;
  put(key: Request, response: Response): Promise<void>;
}

export interface EdgeCacheDeps {
  /** `caches.default` on Cloudflare; null where there is none (tests, `next dev`). */
  readonly cache: EdgeCacheStore | null;
  readonly waitUntil: (task: Promise<unknown>) => void;
  readonly now: () => number;
}

interface PublicRead {
  readonly path: RegExp;
  /** How long a copy is answered without asking the database. */
  readonly freshMs: number;
  /** The query parameters the route reads; any others are left out of the key. */
  readonly params: readonly string[];
}

export const PUBLIC_READS: readonly PublicRead[] = [
  { path: /^\/v1\/ai\/tagflow\/config$/, freshMs: 60_000, params: [] },
  { path: /^\/v1\/status$/, freshMs: 60_000, params: ["days"] },
  { path: /^\/v1\/models\/overrides$/, freshMs: 300_000, params: [] },
  { path: /^\/v1\/demand$/, freshMs: 60_000, params: [] },
  { path: /^\/v1\/stats$/, freshMs: 60_000, params: [] },
  { path: /^\/v1\/impressions$/, freshMs: 15_000, params: [] },
  { path: /^\/v1\/releases$/, freshMs: 300_000, params: [] },
  { path: /^\/v1\/posts(\/[^/]+)?$/, freshMs: 300_000, params: [] },
];

/** How long a stale copy may stand in for a database that cannot answer. */
export const KEEP_STALE_MS = 24 * 3_600_000;

const STORED_AT = "x-adcode-stored-at";
const STATE = "x-adcode-edge-cache";

export function publicReadFor(request: Request): PublicRead | null {
  if (request.method !== "GET" || request.headers.has("authorization")) return null;
  const { pathname } = new URL(request.url);
  return PUBLIC_READS.find((read) => read.path.test(pathname)) ?? null;
}

export function cacheKey(request: Request, read: PublicRead): Request {
  const url = new URL(request.url);
  const key = new URL(url.pathname, url.origin);
  for (const name of read.params) {
    const value = url.searchParams.get(name);
    if (value !== null) key.searchParams.set(name, value);
  }
  key.searchParams.set("__origin", request.headers.get("origin") ?? "");
  return new Request(key.toString(), { method: "GET" });
}

/** What a person receives: the stored answer, as the API sent it, saying where it came from. */
function answer(body: BodyInit | null, status: number, source: Headers, read: PublicRead, state: "HIT" | "MISS" | "STALE"): Response {
  const headers = new Headers(source);
  headers.delete(STORED_AT);
  headers.set(STATE, state);
  headers.set("cache-control", `public, max-age=${Math.round(read.freshMs / 1000)}`);
  if (headers.has("access-control-allow-origin")) headers.set("vary", "Origin");
  return new Response(body, { status, headers });
}

export async function withEdgeCache(request: Request, handle: (request: Request) => Promise<Response>, deps: EdgeCacheDeps): Promise<Response> {
  const read = publicReadFor(request);
  if (read === null || deps.cache === null) return handle(request);
  const cache = deps.cache;
  const key = cacheKey(request, read);
  const kept = await cache.match(key).catch(() => undefined);
  const age = kept === undefined ? Infinity : deps.now() - Number(kept.headers.get(STORED_AT));
  if (kept !== undefined && age >= 0 && age < read.freshMs) return answer(kept.body, kept.status, kept.headers, read, "HIT");

  const fresh = await handle(request).catch(() => null);
  if (fresh !== null && fresh.status === 200) {
    const body = await fresh.arrayBuffer();
    const stored = new Headers(fresh.headers);
    stored.set(STORED_AT, String(deps.now()));
    // Kept well past its freshness so it can stand in during an outage; freshness is ours to judge.
    stored.set("cache-control", `public, max-age=${KEEP_STALE_MS / 1000}`);
    stored.delete("vary");
    stored.delete("set-cookie");
    deps.waitUntil(cache.put(key, new Response(body, { status: 200, headers: stored })).catch(() => undefined));
    return answer(body, 200, fresh.headers, read, "MISS");
  }
  if ((fresh === null || fresh.status >= 500) && kept !== undefined && age < KEEP_STALE_MS) {
    await fresh?.body?.cancel().catch(() => undefined);
    return answer(kept.body, kept.status, kept.headers, read, "STALE");
  }
  return fresh ?? new Response(JSON.stringify({ error: "unavailable" }), { status: 503, headers: { "content-type": "application/json" } });
}
