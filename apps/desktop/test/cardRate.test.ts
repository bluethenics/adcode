import { describe, expect, it } from "vitest";
import { cardRateLabel, formatCardPay, parseCardRate } from "../src/main/cardRate.ts";

// Earnings shows this person's own pay per card, by country (2026-11-25).
describe("pay per card in Earnings", () => {
  it("reads the server's answer and refuses anything else", () => {
    expect(parseCardRate({ country: "GB", countryRate: true, payPerCardMicros: "4500", paidCardsPerDay: 300, paying: true })).toEqual({ country: "GB", countryRate: true, payPerCardMicros: "4500", paidCardsPerDay: 300, paying: true });
    expect(parseCardRate({ country: null, countryRate: false, payPerCardMicros: "2000", paidCardsPerDay: 300, paying: true })?.country).toBeNull();
    for (const bad of [null, "x", { country: "gb", payPerCardMicros: "1", paidCardsPerDay: 1 }, { country: "GB", payPerCardMicros: 4500, paidCardsPerDay: 300 }, { country: "GB", payPerCardMicros: "4500", paidCardsPerDay: -1 }]) expect(parseCardRate(bad)).toBeNull();
  });
  it("words the rate with the country and the daily limit", () => {
    expect(cardRateLabel({ country: "GB", countryRate: true, payPerCardMicros: "4500", paidCardsPerDay: 300, paying: true })).toBe("$0.0045 a card in United Kingdom, up to 300 a day");
    expect(cardRateLabel({ country: null, countryRate: false, payPerCardMicros: "2000", paidCardsPerDay: 1000, paying: true })).toBe("$0.002 a card, up to 1,000 a day");
    expect(cardRateLabel({ country: "RU", countryRate: true, payPerCardMicros: "0", paidCardsPerDay: 300, paying: false })).toBe("Cards are not paying right now");
  });
  it("formats amounts without trailing zeros, cents as cents", () => {
    expect(formatCardPay(900)).toBe("$0.0009");
    expect(formatCardPay(100_000)).toBe("$0.10");
  });
});
