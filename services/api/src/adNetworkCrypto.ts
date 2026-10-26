/** API credentials encrypted separately from the configuration, bound to their network ID. */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import type { EncryptedAdNetworkKey } from "./adNetworkConfig.ts";
function keyBytes(raw: string): Buffer {
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32 || key.toString("base64") !== raw) throw new Error("AD_NETWORK_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  return key;
}
export function adNetworkEncryptionKeys(): string[] {
  const current = process.env["AD_NETWORK_ENCRYPTION_KEY"];
  if (current) {
    const previous = process.env["AD_NETWORK_ENCRYPTION_KEY_PREVIOUS"];
    return previous ? [current, previous] : [current];
  }
  // Existing installations already have a payout root key. HKDF separates the ad-key namespace.
  const payout = process.env["PAYOUT_ENCRYPTION_KEY"];
  if (!payout) return [];
  const derive = (raw: string): string => Buffer.from(hkdfSync("sha256", keyBytes(raw), Buffer.alloc(0), "adcode:ad-network-encryption:v1", 32)).toString("base64");
  const previous = process.env["PAYOUT_ENCRYPTION_KEY_PREVIOUS"];
  return previous ? [derive(payout), derive(previous)] : [derive(payout)];
}
export function encryptAdNetworkKey(id: string, value: string, key: string): EncryptedAdNetworkKey {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(key), nonce);
  cipher.setAAD(Buffer.from(`adcode:ad-network:${id}:v1`));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { version: 1, nonce: nonce.toString("base64"), ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}
export function decryptAdNetworkKey(id: string, encrypted: EncryptedAdNetworkKey, keys: readonly string[]): string {
  if (encrypted.version !== 1) throw new Error("Unsupported ad network credential version");
  for (const key of keys) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", keyBytes(key), Buffer.from(encrypted.nonce, "base64"));
      decipher.setAAD(Buffer.from(`adcode:ad-network:${id}:v1`));
      decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
      return Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext, "base64")), decipher.final()]).toString("utf8");
    } catch { /* Rotation: only the current key writes; previous keys may still read. */ }
  }
  throw new Error("Ad network credential cannot be decrypted");
}
