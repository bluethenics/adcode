import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptDestination, encryptDestination, maskDestination } from "../src/payoutCrypto.ts";

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
    expect(() => decryptDestination(key, { ...first, ciphertext: `${first.ciphertext.slice(0, -2)}AA` }))
      .toThrow("payout destination authentication failed");
  });

  it("returns only a useful masked summary", () => {
    expect(maskDestination(destination)).toEqual({
      country: "IN",
      currency: "INR",
      accountHint: "••••7890",
    });
  });
});
