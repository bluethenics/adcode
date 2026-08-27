/**
 * Creative artwork: out of the row, onto a URL.
 *
 * The portal lets an advertiser paste or upload a logo, which arrives as a `data:` URL.
 * Storing that string in `creatives.logo_light` is what this module exists to stop, and
 * the reason is not tidiness - it broke serving outright, in two separate places:
 *
 *   1. The row grew to 63 kB, so the `creatives` read inside `/v1/serve` cost ~1,960ms
 *      against a total budget of 3,000ms. Every other call in that handler is ~220ms.
 *      Serve averaged ~3,089ms, the client timed out, and the response was thrown away -
 *      after the server had already recorded the serve. 667 serves, 0 impressions.
 *   2. The client refuses a `data:` URL anyway. `packages/ads/src/validation.ts` caps a
 *      URL at 2,048 characters and requires `https:` on the allowlisted asset host, and
 *      one bad creative fails the whole `parseServeResponse`.
 *
 * So the bytes are stored once, under a key, and the row holds a short https URL on the
 * service's own origin. Same hostname as the API, which is what keeps this to one
 * deployment and one certificate.
 *
 * No imports: this is the parsing and naming half, and it is tested without a database.
 */

/**
 * The formats a logo may be in.
 *
 * Raster only. SVG is deliberately absent for the same reason it is absent from the
 * client's sniffer: it is a script-execution surface, and it would run wherever the card
 * is drawn.
 */
const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** Generous for a logo, and far under the client's 2 MB ceiling. */
export const MAX_ASSET_BYTES = 512_000;

export interface ParsedAsset {
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

/**
 * Decode a `data:image/...;base64,...` URL.
 *
 * `atob` rather than `Buffer`: this runs on Cloudflare's runtime, which has no Node
 * globals. Returns null for anything that is not one of the three raster types, so a
 * caller cannot be talked into storing an SVG or an executable by relabelling it.
 */
export function parseDataUrl(value: string): ParsedAsset | null {
  const match = /^data:([a-z/+-]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (match === null) return null;

  const contentType = match[1] ?? "";
  const payload = match[2] ?? "";
  if (EXTENSIONS[contentType] === undefined) return null;

  let binary: string;
  try {
    binary = atob(payload);
  } catch {
    return null;
  }

  if (binary.length > MAX_ASSET_BYTES) return null;

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  return { contentType, bytes };
}

/**
 * The storage key for one creative's artwork.
 *
 * Derived from the creative id rather than random, so re-submitting the same creative
 * overwrites its own artwork instead of leaking a new object every time. The extension is
 * chosen from the content type, never from anything the advertiser sent.
 */
export function assetKey(creativeId: string, variant: "light" | "dark", contentType: string): string {
  const extension = EXTENSIONS[contentType] ?? "bin";
  return `${creativeId}-${variant}.${extension}`;
}

/**
 * A key, as the client will be asked to fetch it.
 *
 * `origin` is the service's own origin, taken from the request rather than configured:
 * the Worker answers on one hostname and that hostname is the one the caller reached, so
 * there is no second place for it to drift out of step with.
 */
export function assetUrl(origin: string, key: string): string {
  return `${origin}/assets/${key}`;
}

/**
 * Keys are generated here, but they arrive back from the network on the read path.
 *
 * A key is a filename and nothing more - no slashes, no dots leading anywhere. This is
 * what stops `/assets/../../something` from reaching the storage layer as a path.
 */
export function isSafeAssetKey(key: string): boolean {
  return /^[A-Za-z0-9_-]{1,80}\.(png|jpg|webp)$/.test(key);
}

/** Whether a stored logo value still needs converting. */
export function isDataUrl(value: string): boolean {
  return value.startsWith("data:");
}
