import { describe, expect, it } from "vitest";
import { MAX_OFFER_DAYS, MAX_OFFER_PERCENT, OFFER_GRACE_MS, activeOffer, chargeDiscount, endOffer, offerDiscount, parseOffer, publicOffer, startOffer } from "../src/priceOffer.ts";
import { WALLET_MARKUP_PERCENT, walletCharge, walletPriceFactor } from "../src/modelWallet.ts";

const DAY = 86_400_000;

describe("price offer rules", () => {
  it("starts now and runs for whole days", () => {
    expect(startOffer("Launch offer", 15, 14, 1000)).toEqual({ name: "Launch offer", percent: 15, startsAt: 1000, endsAt: 1000 + 14 * DAY });
    expect(startOffer("  Launch offer  ", 15, 14, 1000)?.name).toBe("Launch offer");
  });

  it("never discounts a price below what the provider charges", () => {
    expect(MAX_OFFER_PERCENT).toBe(25);
    // The deepest offer still leaves every listed price at or above the provider's own.
    expect(walletPriceFactor(MAX_OFFER_PERCENT)).toBeGreaterThanOrEqual(1);
    expect(walletPriceFactor(MAX_OFFER_PERCENT + 1)).toBeLessThan(1);
    expect(startOffer("Too deep", MAX_OFFER_PERCENT + 1, 7, 1000)).toBeNull();
    expect(WALLET_MARKUP_PERCENT).toBe(35);
  });

  it("refuses a missing name, a bad percent or length, and unknown fields", () => {
    expect(startOffer("", 15, 7, 1000)).toBeNull();
    expect(startOffer(7, 15, 7, 1000)).toBeNull();
    expect(startOffer("x".repeat(61), 15, 7, 1000)).toBeNull();
    expect(startOffer("A", 0, 7, 1000)).toBeNull();
    expect(startOffer("A", 12.5, 7, 1000)).toBeNull();
    expect(startOffer("A", "15", 7, 1000)).toBeNull();
    expect(startOffer("A", 15, 0, 1000)).toBeNull();
    expect(startOffer("A", 15, 1.5, 1000)).toBeNull();
    expect(startOffer("A", 15, MAX_OFFER_DAYS + 1, 1000)).toBeNull();
    expect(parseOffer({ name: "A", percent: 15, startsAt: 1, endsAt: 2, extra: true })).toBeNull();
    expect(parseOffer({ name: "A", percent: 15, startsAt: 5, endsAt: 5 })).toBeNull();
  });

  it("is active from its start up to, but not including, its end", () => {
    const offer = { name: "A", percent: 15, startsAt: 100, endsAt: 200 };
    expect(activeOffer(offer, 99)).toBeNull();
    expect(activeOffer(offer, 100)).toBe(offer);
    expect(offerDiscount(offer, 199)).toBe(15);
    expect(offerDiscount(offer, 200)).toBe(0);
    expect(offerDiscount(undefined, 150)).toBe(0);
    expect(publicOffer(offer, 150)).toEqual({ name: "A", percent: 15, endsAt: 200 });
    expect(publicOffer(offer, 250)).toBeNull();
  });

  it("keeps charging the offer price for a grace period after it ends, never before it starts", () => {
    const offer = { name: "A", percent: 15, startsAt: 100, endsAt: 200 };
    expect(chargeDiscount(offer, 99)).toBe(0);
    expect(chargeDiscount(offer, 150)).toBe(15);
    expect(chargeDiscount(offer, 200 + OFFER_GRACE_MS - 1)).toBe(15);
    expect(chargeDiscount(offer, 200 + OFFER_GRACE_MS)).toBe(0);
    expect(chargeDiscount(undefined, 150)).toBe(0);
  });

  it("ends an offer now without deleting it, and leaves an ended one alone", () => {
    const offer = { name: "A", percent: 15, startsAt: 100, endsAt: 200 };
    expect(endOffer(offer, 150)).toEqual({ ...offer, endsAt: 150 });
    expect(endOffer(offer, 100)).toEqual({ ...offer, endsAt: 101 });
    expect(endOffer(offer, 300)).toBe(offer);
    expect(parseOffer(endOffer(offer, 100))).not.toBeNull();
  });

  it("takes the percent off the price people pay, and changes nothing without an offer", () => {
    expect(walletPriceFactor()).toBe(1.35);
    expect(walletPriceFactor(15)).toBeCloseTo(1.1475, 10);
    // $0.0002 of provider cost is 270 microdollars at list price; 15% off makes it 229.5, rounded up.
    expect(walletCharge({ inputPrice: 1, outputPrice: 5 }, 1000, 200, 0, 0.0002)).toBe(270);
    expect(walletCharge({ inputPrice: 1, outputPrice: 5 }, 1000, 200, 0, 0.0002, 0, 15)).toBe(230);
    expect(walletCharge({ inputPrice: 1, outputPrice: 5, cacheInputPrice: 0.1 }, 1000, 200, 800, undefined, 0, 0)).toBe(1728);
  });
});
