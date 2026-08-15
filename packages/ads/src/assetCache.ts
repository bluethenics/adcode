/**
 * Fetch and cache creative assets, so they are never hot-linked.
 *
 * Brief §1: "Creative assets are `https` only, from an allowlisted host, fetched and
 * cached by us. Never hot-linked from advertiser servers. Hot-linking would hand every
 * advertiser the user's IP address and a fingerprinting beacon on every impression."
 *
 * The host check is duplicated here rather than trusted from `validation.ts`. That is
 * deliberate: this module is the one that actually opens a socket, so it is the last
 * place the rule can be enforced, and a caller that skipped validation must not be able
 * to turn this into a general-purpose fetcher.
 */
import {
  FETCH_TIMEOUT_MS,
  err,
  ok,
  type AssetError,
  type Clock,
  type FileStore,
  type HttpTransport,
  type Result,
} from "./types.ts";

const KEY_PREFIX = "ads/assets/";
const MAX_ASSET_BYTES = 2_000_000;

const assetError = (kind: AssetError["kind"], detail: string): Result<never, AssetError> =>
  err({ kind, detail });

/**
 * A stable, filesystem-safe key.
 *
 * FNV-1a over the URL. The URL is attacker-controlled, so it never touches a path:
 * writing it directly would hand a path traversal to anyone who can serve a creative.
 * A hash collision costs one wrong logo, which is why a cryptographic digest would be
 * over-engineering here.
 */
function cacheKey(url: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) {
    hash ^= url.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${KEY_PREFIX}${hash.toString(36)}${url.length.toString(36)}`;
}

export interface AssetCacheDeps {
  readonly http: HttpTransport;
  readonly store: FileStore;
  readonly clock: Clock;
  readonly allowedHost: string;
  readonly maxBytes?: number;
}

export interface AssetCache {
  get(url: string): Promise<Result<Uint8Array, AssetError>>;
  has(url: string): Promise<boolean>;
}

export function createAssetCache(deps: AssetCacheDeps): AssetCache {
  const maxBytes = deps.maxBytes ?? MAX_ASSET_BYTES;

  function check(url: string): Result<true, AssetError> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return assetError("disallowed-host", "malformed URL");
    }

    if (parsed.protocol !== "https:") {
      return assetError("insecure-scheme", `scheme ${parsed.protocol} is not https`);
    }
    // Exact equality. `endsWith` would accept `evil-cdn.adcode.test`.
    if (parsed.hostname !== deps.allowedHost) {
      return assetError("disallowed-host", `host ${parsed.hostname} is not allowlisted`);
    }
    return ok(true);
  }

  return {
    async has(url: string): Promise<boolean> {
      if (!check(url).ok) return false;
      return (await deps.store.read(cacheKey(url))) !== null;
    },

    async get(url: string): Promise<Result<Uint8Array, AssetError>> {
      const allowed = check(url);
      if (!allowed.ok) return allowed;

      const key = cacheKey(url);

      const cached = await deps.store.read(key);
      if (cached !== null) return ok(cached);

      let response;
      try {
        response = await deps.http.request({
          method: "GET",
          url,
          headers: { accept: "image/*" },
          timeoutMs: FETCH_TIMEOUT_MS,
        });
      } catch (error) {
        return assetError("network", error instanceof Error ? error.message : "fetch failed");
      }

      if (response.status < 200 || response.status >= 300) {
        return assetError("network", `HTTP ${response.status}`);
      }

      if (response.body.byteLength > maxBytes) {
        return assetError("too-large", `${response.body.byteLength} bytes exceeds ${maxBytes}`);
      }

      await deps.store.write(key, response.body);
      return ok(response.body);
    },
  };
}
