import { publicHttpsUrl } from "./adNetworkConfig.ts";
import { MAX_ASSET_BYTES, type ParsedAsset } from "./assets.ts";
import type { Store } from "./store.ts";

/** Only already-issued artwork can be proxied. No caller-supplied URL or provider key is fetched. */
export async function readAdNetworkArtwork(store: Store, key: string, fetchImpl: typeof fetch = fetch): Promise<ParsedAsset | null> {
  const match = /^network_(an_[A-Za-z0-9_-]{1,61})_(light|dark)\.png$/.exec(key);
  if (!match || !store.adNetworks) return null;
  const source = await store.adNetworks.artwork(match[1]!, match[2] as "light" | "dark");
  if (!publicHttpsUrl(source)) return null;
  const response = await fetchImpl(source, { headers: { accept: "image/png,image/jpeg,image/webp" }, redirect: "error", signal: AbortSignal.timeout(1_200) });
  if (!response.ok) return null;
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim();
  if (contentType !== "image/png" && contentType !== "image/jpeg" && contentType !== "image/webp") return null;
  const reader = response.body?.getReader(); if (!reader) return null;
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_ASSET_BYTES) { await reader.cancel(); return null; }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  // MIME alone is insufficient: an upstream error page must not become an image on our origin.
  const png = bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((value,index) => bytes[index] === value);
  const jpeg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0,4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8,12)) === "WEBP";
  if (contentType === "image/png" && !png || contentType === "image/jpeg" && !jpeg || contentType === "image/webp" && !webp) return null;
  return { bytes, contentType };
}
