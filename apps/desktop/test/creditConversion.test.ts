import { describe, expect, it } from "vitest";
import {
  WITHDRAW_URL,
  blockedMessage,
  conversionErrorMessage,
  creditsAtRate,
  dollarInputText,
  formatUsd,
  isConversionRequest,
  parseConversionQuote,
  parseConversionResponse,
  parseDollarAmount,
  previewConversion,
  type CreditConversionQuote,
} from "../src/shared/creditConversion.ts";

/** A quote as `GET /v1/earnings/convert` sends it. */
const QUOTE: CreditConversionQuote = {
  availableMicros: "12345678",
  creditBalanceMicros: "2000000",
  convertedTodayMicros: "0",
  minMicros: "500000",
  maxMicros: "1000000000",
  dailyCapMicros: "1000000000",
  stepMicros: "10000",
  convertibleMaxMicros: "12340000",
  rate: { earningsMicros: "1", creditMicros: "1" },
  blocked: null,
};

describe("typed dollar amounts", () => {
  it.each([
    ["5", 5_000_000n],
    ["5.5", 5_500_000n],
    ["5.", 5_000_000n],
    [".5", 500_000n],
    ["$1,234.56", 1_234_560_000n],
    [" 0.50 ", 500_000n],
  ])("reads %j as %s micros", (text, micros) => {
    expect(parseDollarAmount(text)).toBe(micros);
  });

  it.each(["", ".", "abc", "1.234", "-5", "1e3", "5 dollars", "12345678"])("refuses %j", (text) => {
    expect(parseDollarAmount(text)).toBeNull();
  });

  it("writes an amount back into the box without symbols", () => {
    expect(dollarInputText(12_340_000n)).toBe("12.34");
    expect(dollarInputText("500000")).toBe("0.50");
  });
});

describe("formatting", () => {
  it("shows dollars to the cent, truncated, with separators", () => {
    expect(formatUsd(1_234_567_891n)).toBe("$1,234.56");
    expect(formatUsd("9999")).toBe("$0.00");
    expect(formatUsd(-2_350_000n)).toBe("-$2.35");
  });
});

describe("the preview before confirming", () => {
  it("shows what the amount buys at the server's rate", () => {
    expect(previewConversion(QUOTE, "10")).toEqual({ ok: true, amountMicros: "10000000", amountLabel: "$10.00", creditLabel: "$10.00" });
  });

  it("uses the quoted rate, not one of its own", () => {
    const doubled = { ...QUOTE, rate: { earningsMicros: "1", creditMicros: "2" } };
    expect(creditsAtRate(doubled, 3_000_000n)).toBe(6_000_000n);
    expect(previewConversion(doubled, "3")).toMatchObject({ ok: true, creditLabel: "$6.00" });
  });

  it("explains each refusal before anything is sent", () => {
    expect(previewConversion(QUOTE, "")).toEqual({ ok: false, message: "Enter an amount." });
    expect(previewConversion(QUOTE, "ten")).toMatchObject({ ok: false });
    expect(previewConversion(QUOTE, "0.25")).toEqual({ ok: false, message: "The smallest conversion is $0.50." });
    expect(previewConversion(QUOTE, "13")).toEqual({ ok: false, message: "You can convert up to $12.34 available." });
    const capped = { ...QUOTE, availableMicros: "5000000000", convertedTodayMicros: "999000000", convertibleMaxMicros: "1000000" };
    expect(previewConversion(capped, "2")).toEqual({ ok: false, message: "You can convert up to $1.00 today." });
    const rich = { ...QUOTE, availableMicros: "5000000000", convertibleMaxMicros: "1000000000" };
    expect(previewConversion(rich, "1001")).toEqual({ ok: false, message: "You can convert up to $1,000.00 at a time." });
  });

  it("accepts exactly everything that is convertible", () => {
    expect(previewConversion(QUOTE, dollarInputText(QUOTE.convertibleMaxMicros))).toMatchObject({ ok: true, amountMicros: "12340000" });
  });
});

describe("reading the server", () => {
  it("accepts a well-formed quote, including a negative credit balance", () => {
    expect(parseConversionQuote(QUOTE)).toEqual(QUOTE);
    expect(parseConversionQuote({ ...QUOTE, creditBalanceMicros: "-2350000" })?.creditBalanceMicros).toBe("-2350000");
  });

  it.each([
    null,
    { ...QUOTE, availableMicros: 5 },
    { ...QUOTE, availableMicros: "-5" },
    { ...QUOTE, rate: { earningsMicros: "0", creditMicros: "1" } },
    { ...QUOTE, rate: undefined },
    { ...QUOTE, blocked: "something-new" },
  ])("refuses a malformed quote %#", (raw) => {
    expect(parseConversionQuote(raw)).toBeNull();
  });

  it("reads a conversion answer and refuses anything else", () => {
    const body = { status: "converted", requestId: "x", earningsMicros: "2000000", creditMicros: "2000000", availableMicros: "3000000", creditBalanceMicros: "4000000" };
    expect(parseConversionResponse(body)).toEqual({ ok: true, status: "converted", earningsMicros: "2000000", creditMicros: "2000000", availableMicros: "3000000", creditBalanceMicros: "4000000" });
    expect(parseConversionResponse({ ...body, status: "pending" })).toBeNull();
    expect(parseConversionResponse({ ...body, creditMicros: 2 })).toBeNull();
  });

  it("only sends a request with a uuid and a whole number of micros", () => {
    expect(isConversionRequest({ requestId: "3f1c2b9e-7a4d-4e8f-9b1a-2c3d4e5f6a7b", amountMicros: "1000000" })).toBe(true);
    expect(isConversionRequest({ requestId: "3f1c2b9e-7a4d-4e8f-9b1a-2c3d4e5f6a7b", amountMicros: "1.5" })).toBe(false);
    expect(isConversionRequest({ requestId: "1", amountMicros: "1000000" })).toBe(false);
  });
});

describe("words", () => {
  it("says why nothing can be converted", () => {
    expect(blockedMessage("below-minimum", QUOTE)).toContain("$0.50");
    expect(blockedMessage("daily-cap", QUOTE)).toContain("$1,000.00");
    expect(blockedMessage("verify-email")).toMatch(/confirm your email/);
  });

  it("tells somebody whose conversion failed that nothing moved, and that retrying is safe", () => {
    expect(conversionErrorMessage("insufficient-funds")).toMatch(/Nothing was converted/);
    expect(conversionErrorMessage("offline")).toMatch(/never convert twice/);
  });

  it("withdraws on the website's payouts section", () => {
    expect(WITHDRAW_URL).toBe("https://adcode.bluethenics.com/dashboard#payouts");
  });
});
