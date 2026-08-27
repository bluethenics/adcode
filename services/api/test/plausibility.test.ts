import { describe, it, expect } from "vitest";
import { checkReceipt, MIN_DWELL_MS, MAX_DWELL_MS } from "../src/plausibility.ts";
import type { SubmittedReceipt } from "../src/contract.ts";
import type { ServeRecord } from "../src/store.ts";

const NOW = 1_700_000_100_000;

const receipt = (over: Partial<SubmittedReceipt> = {}): SubmittedReceipt => ({
  receiptId: "r-1",
  creativeId: "c-1",
  shownAt: NOW - 10_000,
  dwellMs: 4200,
  themeKind: "dark",
  outcome: "impression",
  ...over,
});

const serve = (over: Partial<ServeRecord> = {}): ServeRecord => ({
  serveId: "s-1",
  uid: "u-1",
  creativeId: "c-1",
  campaignId: "camp-1",
  servedAt: NOW - 20_000,
  expiresAt: NOW + 20_000,
  maxBidCpmMicros: 8_000_000n,
  clearingCpmMicros: 5_010_000n,
  costMicros: 5_010n,
  ...over,
});

describe("checkReceipt", () => {
  it("accepts an ordinary impression", () => {
    expect(checkReceipt(receipt(), serve(), NOW)).toEqual({ ok: true });
  });

  it("refuses a receipt with no matching serve - this is the whole defence", () => {
    expect(checkReceipt(receipt(), null, NOW)).toEqual({ ok: false, reason: "no-serve" });
  });

  it("refuses a dwell too short to have been seen", () => {
    expect(checkReceipt(receipt({ dwellMs: MIN_DWELL_MS - 1 }), serve(), NOW)).toEqual({
      ok: false,
      reason: "dwell-too-short",
    });
  });

  it("accepts a dwell exactly at the floor", () => {
    expect(checkReceipt(receipt({ dwellMs: MIN_DWELL_MS }), serve(), NOW)).toEqual({ ok: true });
  });

  it("refuses a dwell longer than any plausible session", () => {
    expect(checkReceipt(receipt({ dwellMs: MAX_DWELL_MS + 1 }), serve(), NOW)).toEqual({
      ok: false,
      reason: "dwell-too-long",
    });
  });

  it("refuses a receipt claiming to have been shown in the future", () => {
    expect(checkReceipt(receipt({ shownAt: NOW + 60_000 }), serve(), NOW)).toEqual({
      ok: false,
      reason: "shown-in-future",
    });
  });

  it("tolerates a client clock that runs slightly fast", () => {
    expect(checkReceipt(receipt({ shownAt: NOW + 5_000 }), serve(), NOW)).toEqual({ ok: true });
  });

  it("refuses to pay for a dismissal, without calling it fraud", () => {
    // A dismissal is honest and worth recording; it just earns nothing.
    expect(checkReceipt(receipt({ outcome: "dismissed" }), serve(), NOW)).toEqual({
      ok: false,
      reason: "not-earning",
    });
  });

  it("accepts a click", () => {
    expect(checkReceipt(receipt({ outcome: "click" }), serve(), NOW)).toEqual({ ok: true });
  });
});
