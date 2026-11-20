import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONVERSION_DAILY_CAP_MICROS,
  CONVERSION_MAX_MICROS,
  CONVERSION_MIN_MICROS,
  blockedReason,
  checkAmount,
  checkConversion,
  conversionEntry,
  convertibleMaxMicros,
  creditsForEarnings,
  floorToStep,
  parseConversionRequest,
  utcDayStart,
} from "../src/earningsConversion.ts";
import { applyEntry, EMPTY_BALANCE } from "../src/ledger.ts";
import { conversionOutcomeFromRpc } from "../adapters/supabaseRows.ts";

const ID = "3f1c2b9e-7a4d-4e8f-9b1a-2c3d4e5f6a7b";

describe("conversion maths", () => {
  it("is one dollar of credits for one dollar of earnings", () => {
    expect(creditsForEarnings(2_500_000n)).toBe(2_500_000n);
    expect(creditsForEarnings(0n)).toBe(0n);
    expect(creditsForEarnings(-5n)).toBe(0n);
  });

  it("rounds 'everything' down to whole cents, never up", () => {
    expect(floorToStep(1_234_567n)).toBe(1_230_000n);
    expect(floorToStep(9_999n)).toBe(0n);
    expect(floorToStep(-1n)).toBe(0n);
  });

  it("counts the daily cap from midnight UTC", () => {
    expect(utcDayStart(Date.UTC(2026, 10, 19, 23, 59))).toBe(Date.UTC(2026, 10, 19));
    expect(utcDayStart(Date.UTC(2026, 10, 20))).toBe(Date.UTC(2026, 10, 20));
  });

  it("offers the smallest of balance, per-conversion ceiling and what is left today", () => {
    expect(convertibleMaxMicros({ availableMicros: 3_456_789n, convertedTodayMicros: 0n })).toBe(3_450_000n);
    expect(convertibleMaxMicros({ availableMicros: 5_000_000_000n, convertedTodayMicros: 0n })).toBe(CONVERSION_MAX_MICROS);
    expect(convertibleMaxMicros({ availableMicros: 5_000_000_000n, convertedTodayMicros: 999_000_000n })).toBe(1_000_000n);
  });

  it("offers nothing below the minimum, and says why", () => {
    expect(convertibleMaxMicros({ availableMicros: 499_999n, convertedTodayMicros: 0n })).toBe(0n);
    expect(blockedReason({ availableMicros: 499_999n, convertedTodayMicros: 0n })).toBe("below-minimum");
    expect(blockedReason({ availableMicros: 9_000_000n, convertedTodayMicros: CONVERSION_DAILY_CAP_MICROS })).toBe("daily-cap");
    expect(blockedReason({ availableMicros: 9_000_000n, convertedTodayMicros: 0n })).toBeNull();
  });
});

describe("conversion validation", () => {
  it("accepts an amount inside every limit", () => {
    expect(checkConversion({ amountMicros: 1_000_000n, availableMicros: 2_000_000n, convertedTodayMicros: 0n }))
      .toEqual({ ok: true, creditMicros: 1_000_000n });
    expect(checkConversion({ amountMicros: CONVERSION_MIN_MICROS, availableMicros: CONVERSION_MIN_MICROS, convertedTodayMicros: 0n }).ok).toBe(true);
  });

  it.each([
    [400_000n, 9_000_000n, 0n, "below-minimum"],
    [1_000_010_000n, 9_000_000_000n, 0n, "above-maximum"],
    [1_000_001n, 9_000_000n, 0n, "not-whole-cents"],
    [3_000_000n, 2_999_999n, 0n, "insufficient-funds"],
    [2_000_000n, 9_000_000n, 999_000_000n, "daily-cap"],
  ] as const)("refuses %s with %s available and %s converted today: %s", (amountMicros, availableMicros, convertedTodayMicros, error) => {
    expect(checkConversion({ amountMicros, availableMicros, convertedTodayMicros })).toEqual({ ok: false, error });
  });

  it("checks the amount alone without looking at a balance", () => {
    expect(checkAmount(1_000_000n)).toBeNull();
    expect(checkAmount(10_000n)).toBe("below-minimum");
  });

  it("parses exactly { requestId, amountMicros }", () => {
    expect(parseConversionRequest({ requestId: ID.toUpperCase(), amountMicros: "1000000" }))
      .toEqual({ ok: true, requestId: ID, amountMicros: 1_000_000n });
  });

  it.each([
    [null, "invalid-request"],
    [[], "invalid-request"],
    [{ requestId: ID, amountMicros: "1000000", rate: "2" }, "invalid-request"],
    [{ requestId: ID, amountMicros: "1000000", creditMicros: "9000000" }, "invalid-request"],
    [{ requestId: "not-a-uuid", amountMicros: "1000000" }, "invalid-request-id"],
    [{ amountMicros: "1000000" }, "invalid-request-id"],
    [{ requestId: ID, amountMicros: 1_000_000 }, "invalid-amount"],
    [{ requestId: ID, amountMicros: "1e6" }, "invalid-amount"],
    [{ requestId: ID, amountMicros: "-1000000" }, "invalid-amount"],
    [{ requestId: ID, amountMicros: "0" }, "invalid-amount"],
  ])("refuses %j as %s", (raw, error) => {
    expect(parseConversionRequest(raw)).toEqual({ ok: false, error });
  });
});

describe("the earnings ledger", () => {
  it("takes a conversion off what can be withdrawn and keeps it in lifetime earnings", () => {
    const entry = conversionEntry({ uid: "u-1", requestId: ID, amountMicros: 2_000_000n, creditMicros: 2_000_000n, now: 5 });
    expect(entry).toMatchObject({ kind: "credit_conversion", micros: -2_000_000n, refId: ID, entryId: `conv-u-1-${ID}` });
    const balance = applyEntry({ ...EMPTY_BALANCE, availableMicros: 5_000_000n, lifetimeMicros: 5_000_000n }, entry);
    expect(balance).toEqual({ availableMicros: 3_000_000n, lifetimeMicros: 5_000_000n, pendingWithdrawalMicros: 0n });
  });
});

describe("the database rpc's answer", () => {
  it("reads micros from strings without passing through a number", () => {
    const outcome = conversionOutcomeFromRpc("u-1", ID, {
      status: "converted", earningsMicros: "9007199254740993", creditMicros: "1", createdAt: 7, availableMicros: "0", creditBalanceMicros: "12",
    });
    expect(outcome).toMatchObject({ status: "converted", conversion: { earningsMicros: 9_007_199_254_740_993n }, creditBalanceMicros: 12n });
  });

  it("throws on an answer it does not know rather than guessing", () => {
    expect(() => conversionOutcomeFromRpc("u-1", ID, { status: "maybe" })).toThrow();
    expect(() => conversionOutcomeFromRpc("u-1", ID, null)).toThrow();
  });
});

describe("the migration", () => {
  const sql = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../../supabase/migrations/20261119120000_earnings_to_credits.sql"),
    "utf8",
  );

  it("caps a single conversion at the same ceiling the service enforces", () => {
    expect(sql).toContain(`earnings_micros <= ${CONVERSION_MAX_MICROS}`);
    expect(sql).toContain(`p_earnings > ${CONVERSION_MAX_MICROS}`);
  });

  it("locks the same per-account key as a payout request, so both cannot spend one dollar", () => {
    expect(sql).toContain("pg_advisory_xact_lock(hashtextextended(p_uid, 0))");
  });

  it("allows the new ledger kind", () => {
    expect(sql).toMatch(/ledger_entries_kind_check check \(kind in \([^)]*'credit_conversion'/);
  });
});
