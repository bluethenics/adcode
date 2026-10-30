import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const TTL_MS = 5 * 60_000;
const signature = (id: string, credential: string, value: string, key: string): Buffer =>
  createHmac("sha256", Buffer.from(key, "base64")).update(JSON.stringify(["imprezia-sdk-preview-v1", id, credential, value])).digest();

/** A short-lived, network-scoped relay permit. The publisher key never reaches the browser. */
export function impreziaSdkPreviewEndpoint(id: string, credential: string, key: string, now: number): string {
  const value = `${now + TTL_MS}.${randomBytes(12).toString("base64url")}`;
  return `/v1/imprezia/preview/${id}/${value}.${signature(id, credential, value, key).toString("base64url")}`;
}

export function validImpreziaSdkPreview(id: string, credential: string, token: string, keys: readonly string[], now: number): boolean {
  const match = /^(\d{1,16})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return false;
  const expires = Number(match[1]);
  if (!Number.isSafeInteger(expires) || expires <= now || expires > now + TTL_MS) return false;
  const received = Buffer.from(match[3]!, "base64url");
  return keys.some(key => {
    const expected = signature(id, credential, `${match[1]}.${match[2]}`, key);
    return received.length === expected.length && timingSafeEqual(received, expected);
  });
}
