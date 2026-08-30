/**
 * Payout destinations, encrypted at rest.
 *
 * These are the only bank details the system stores, so they are the one thing in the
 * schema that is not readable from a database dump. AES-256-GCM, fresh 12-byte nonce per
 * record, auth tag kept beside the ciphertext.
 *
 * The envelope carries a `keyId` so the key can be rotated. Without one, rotation is a
 * cliff: every stored destination becomes undecryptable at the moment the environment
 * variable changes, with nothing to say which key a given row was sealed with and no way
 * to re-wrap it. With one, `PAYOUT_ENCRYPTION_KEY_PREVIOUS` stays readable while
 * `PAYOUT_ENCRYPTION_KEY` does the writing, and each record re-wraps the next time it is
 * saved. The id is the first eight hex characters of the key's SHA-256 - derived from the
 * key but not a way back to it, and stable across processes.
 *
 * Records written before the id existed have no `keyId` and are tried against every key in
 * the ring, which is exactly the behaviour that was there before.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { PayoutDestination } from "./store.ts";

export interface EncryptedDestination {
  version: 1;
  nonce: string;
  ciphertext: string;
  tag: string;
  /** Absent on records sealed before rotation support. */
  keyId?: string;
}

/**
 * The keys this process may read with, newest first.
 *
 * A plain string is accepted for the common case of a single key, so callers that never
 * rotate stay unchanged.
 */
export type PayoutKeyring = string | readonly string[];

function decodeKey(encoded: string): Buffer {
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("PAYOUT_ENCRYPTION_KEY must decode to exactly 32 bytes");
  return key;
}

/** Short, stable, and safe to store beside the ciphertext. */
export function keyIdFor(encodedKey: string): string {
  return createHash("sha256").update(decodeKey(encodedKey)).digest("hex").slice(0, 8);
}

/** The ring as a list, newest first. The first entry is always the one that writes. */
function ring(keys: PayoutKeyring): string[] {
  const list = (typeof keys === "string" ? [keys] : [...keys]).filter((key) => key.length > 0);
  if (list.length === 0) throw new Error("PAYOUT_ENCRYPTION_KEY is required for payout data");
  return list;
}

export function encryptDestination(
  keys: PayoutKeyring,
  destination: PayoutDestination,
): EncryptedDestination {
  const encodedKey = ring(keys)[0] as string;
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
    keyId: keyIdFor(encodedKey),
  };
}

function openWith(encodedKey: string, encrypted: EncryptedDestination): PayoutDestination {
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
}

export function decryptDestination(
  keys: PayoutKeyring,
  encrypted: EncryptedDestination,
): PayoutDestination {
  if (encrypted.version !== 1) throw new Error("unsupported payout destination version");

  const all = ring(keys);
  // A record that names its key is only tried against that key: failing against the right
  // key is a tampering signal, and quietly trying the others would hide it.
  const candidates =
    encrypted.keyId === undefined
      ? all
      : all.filter((key) => keyIdFor(key) === encrypted.keyId);
  if (candidates.length === 0) {
    throw new Error(`no payout encryption key matches keyId ${encrypted.keyId ?? "(none)"}`);
  }

  for (const key of candidates) {
    try {
      return openWith(key, encrypted);
    } catch (error) {
      // A malformed key is the operator's problem and must not read as a bad ciphertext.
      if (error instanceof Error && error.message.startsWith("PAYOUT_ENCRYPTION_KEY")) throw error;
    }
  }
  throw new Error("payout destination authentication failed");
}

/** True when this record was sealed with a key that is no longer the writing key. */
export function needsRewrap(keys: PayoutKeyring, encrypted: EncryptedDestination): boolean {
  return encrypted.keyId !== keyIdFor(ring(keys)[0] as string);
}

export function maskDestination(destination: PayoutDestination): {
  country: string;
  currency: string;
  accountHint: string;
} {
  // A Wise address is the destination for `wise-email`, and masking it to the domain is
  // enough for an admin to recognise the row without the list handing out addresses.
  if (destination.method === "wise-email" && destination.email !== null) {
    const at = destination.email.lastIndexOf("@");
    const hint = at <= 0 ? "Wise address saved" : `••••@${destination.email.slice(at + 1)}`;
    return { country: destination.country, currency: destination.currency, accountHint: hint };
  }
  const account = destination.fields?.accountNumber ?? destination.fields?.iban ?? "";
  return {
    country: destination.country,
    currency: destination.currency,
    accountHint: account.length === 0 ? "Bank details saved" : `••••${account.slice(-4)}`,
  };
}
