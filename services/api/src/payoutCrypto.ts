import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { PayoutDestination } from "./store.ts";

export interface EncryptedDestination {
  version: 1;
  nonce: string;
  ciphertext: string;
  tag: string;
}

function decodeKey(encoded: string): Buffer {
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("PAYOUT_ENCRYPTION_KEY must decode to exactly 32 bytes");
  return key;
}

export function encryptDestination(
  encodedKey: string,
  destination: PayoutDestination,
): EncryptedDestination {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", decodeKey(encodedKey), nonce);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(destination), "utf8"),
    cipher.final(),
  ]);
  return {
    version: 1,
    nonce: nonce.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptDestination(
  encodedKey: string,
  encrypted: EncryptedDestination,
): PayoutDestination {
  if (encrypted.version !== 1) throw new Error("unsupported payout destination version");
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      decodeKey(encodedKey),
      Buffer.from(encrypted.nonce, "base64"),
    );
    decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(plaintext) as PayoutDestination;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("PAYOUT_ENCRYPTION_KEY")) throw error;
    throw new Error("payout destination authentication failed");
  }
}

export function maskDestination(destination: PayoutDestination): {
  country: string;
  currency: string;
  accountHint: string;
} {
  const account = destination.fields?.accountNumber ?? destination.fields?.iban ?? "";
  return {
    country: destination.country,
    currency: destination.currency,
    accountHint: account.length === 0 ? "Bank details saved" : `••••${account.slice(-4)}`,
  };
}
