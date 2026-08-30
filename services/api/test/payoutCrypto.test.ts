import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptDestination,
  encryptDestination,
  keyIdFor,
  maskDestination,
  needsRewrap,
} from "../src/payoutCrypto.ts";

const key = randomBytes(32).toString("base64");
const destination = {
  method: "bank" as const,
  legalName: "Ada Lovelace",
  country: "IN",
  currency: "INR",
  email: null,
  bankDetails: null,
  fields: { accountNumber: "1234567890", ifsc: "HDFC0001234", bankName: "HDFC Bank" },
};

/**
 * Flip one bit of the ciphertext.
 *
 * Deliberately not `ciphertext.slice(0, -2) + "AA"`, which is what this used to do.
 * Substituting base64 *characters* is a no-op whenever the ciphertext already ends in
 * "AA" - the decoded bytes are unchanged, GCM authenticates correctly, and the test fails
 * for being right. Measured at 52 silent passes in 200,000 cycles, about 1 in 3,850, which
 * is exactly often enough to look like a moody suite rather than a broken test. Mutating
 * the decoded buffer is unconditional.
 */
function tamper(ciphertext: string): string {
  const bytes = Buffer.from(ciphertext, "base64");
  bytes[0] = (bytes[0] ?? 0) ^ 0x01;
  return bytes.toString("base64");
}

describe("payout destination encryption", () => {
  it("round-trips with AES-GCM without exposing account data", () => {
    const encrypted = encryptDestination(key, destination);
    expect(JSON.stringify(encrypted)).not.toContain("1234567890");
    expect(decryptDestination(key, encrypted)).toEqual(destination);
  });

  it("uses a fresh nonce and rejects tampering", () => {
    const first = encryptDestination(key, destination);
    const second = encryptDestination(key, destination);
    expect(first.nonce).not.toBe(second.nonce);
    expect(() => decryptDestination(key, { ...first, ciphertext: tamper(first.ciphertext) }))
      .toThrow("payout destination authentication failed");
  });

  it("rejects a tampered auth tag and a swapped nonce", () => {
    const sealed = encryptDestination(key, destination);
    const other = encryptDestination(key, destination);
    expect(() => decryptDestination(key, { ...sealed, tag: tamper(sealed.tag) })).toThrow(
      "payout destination authentication failed",
    );
    expect(() => decryptDestination(key, { ...sealed, nonce: other.nonce })).toThrow(
      "payout destination authentication failed",
    );
  });

  it("returns only a useful masked summary", () => {
    expect(maskDestination(destination)).toEqual({
      country: "IN",
      currency: "INR",
      accountHint: "••••7890",
    });
  });

  it("masks a Wise address to its domain", () => {
    expect(
      maskDestination({
        method: "wise-email",
        legalName: "Ada Lovelace",
        country: "GB",
        currency: "GBP",
        email: "ada@example.com",
        bankDetails: null,
      }),
    ).toEqual({ country: "GB", currency: "GBP", accountHint: "••••@example.com" });
  });
});

describe("key rotation", () => {
  const next = randomBytes(32).toString("base64");

  it("names the key a record was sealed with", () => {
    const sealed = encryptDestination(key, destination);
    expect(sealed.keyId).toBe(keyIdFor(key));
    expect(keyIdFor(key)).not.toBe(keyIdFor(next));
  });

  it("reads a record sealed with the previous key", () => {
    const sealed = encryptDestination(key, destination);
    // The ring is newest first: `next` writes, `key` can still read.
    expect(decryptDestination([next, key], sealed)).toEqual(destination);
  });

  it("writes with the head of the ring and flags the rest for re-wrapping", () => {
    const old = encryptDestination(key, destination);
    const fresh = encryptDestination([next, key], destination);
    expect(fresh.keyId).toBe(keyIdFor(next));
    expect(needsRewrap([next, key], old)).toBe(true);
    expect(needsRewrap([next, key], fresh)).toBe(false);
  });

  it("refuses a record whose key is not in the ring, rather than guessing", () => {
    const sealed = encryptDestination(key, destination);
    expect(() => decryptDestination(next, sealed)).toThrow(/no payout encryption key matches/);
  });

  it("still reads a record written before key ids existed", () => {
    const { keyId: _dropped, ...legacy } = encryptDestination(key, destination);
    expect(decryptDestination([next, key], legacy)).toEqual(destination);
  });

  it("tells a bad key apart from a bad ciphertext", () => {
    const sealed = encryptDestination(key, destination);
    expect(() => decryptDestination("dG9vLXNob3J0", sealed)).toThrow(/must decode to exactly 32/);
  });
});
