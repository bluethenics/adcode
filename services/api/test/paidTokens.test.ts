import { describe, expect, it } from "vitest";
import { chargeTokens, DEFAULT_PAID_CONFIG, holdTokens, isPaidModel, parsePaidConfig, tokensView } from "../src/paidTokens.ts";

const WEEK = 7 * 86_400_000;
const none = { purchased: 0, reserved: 0 };

describe("paid AI tokens", () => {
  it("parses the defaults and refuses anything else", () => {
    expect(parsePaidConfig(DEFAULT_PAID_CONFIG)).toEqual(DEFAULT_PAID_CONFIG);
    expect(parsePaidConfig({ ...DEFAULT_PAID_CONFIG, extra: 1 })).toBeNull();
    expect(parsePaidConfig({ ...DEFAULT_PAID_CONFIG, freeWeeklyTokens: -1 })).toBeNull();
    expect(parsePaidConfig({ ...DEFAULT_PAID_CONFIG, packs: [{ id: "x", priceCents: 0, tokens: 1 }] })).toBeNull();
    expect(parsePaidConfig({ ...DEFAULT_PAID_CONFIG, packs: [DEFAULT_PAID_CONFIG.packs[0], DEFAULT_PAID_CONFIG.packs[0]] })).toBeNull();
    expect(parsePaidConfig({ ...DEFAULT_PAID_CONFIG, providers: ["tagflow"] })).toBeNull();
  });

  it("charges only the listed providers, and only when switched on", () => {
    const on = { ...DEFAULT_PAID_CONFIG, enabled: true };
    expect(isPaidModel({ provider: "custom-heabsy" }, on)).toBe(true);
    expect(isPaidModel({}, on)).toBe(false);
    expect(isPaidModel({ provider: "tagflow" }, on)).toBe(false);
    expect(isPaidModel({ provider: "custom-heabsy" }, DEFAULT_PAID_CONFIG)).toBe(false);
    expect(isPaidModel({ provider: "custom-heabsy" }, undefined)).toBe(false);
  });

  it("opens a free window on first use and holds free tokens first", () => {
    const held = holdTokens(null, none, 10_000_000, 120_000, 1000);
    expect(held).toEqual({ ok: true, window: { startedAt: 1000, endsAt: 1000 + WEEK, usedTokens: 0, reservedTokens: 120_000 }, balance: none, hold: { freeTokens: 120_000, paidTokens: 0, windowStartedAt: 1000 } });
  });

  it("splits a hold across the end of the free allowance", () => {
    const free = { startedAt: 0, endsAt: WEEK, usedTokens: 9_950_000, reservedTokens: 0 };
    const held = holdTokens(free, { purchased: 1_000_000, reserved: 0 }, 10_000_000, 120_000, 5);
    expect(held.ok && held.hold).toEqual({ freeTokens: 50_000, paidTokens: 70_000, windowStartedAt: 0 });
    expect(held.ok && held.balance).toEqual({ purchased: 1_000_000, reserved: 70_000 });
  });

  it("admits while any tokens are left, and refuses with the refill time when none are", () => {
    const spent = { startedAt: 0, endsAt: WEEK, usedTokens: 10_000_000, reservedTokens: 0 };
    expect(holdTokens(spent, { purchased: 1, reserved: 0 }, 10_000_000, 120_000, 5).ok).toBe(true);
    expect(holdTokens(spent, none, 10_000_000, 120_000, 5)).toEqual({ ok: false, resetsAt: WEEK });
    expect(holdTokens(spent, none, 10_000_000, 120_000, WEEK).ok).toBe(true);
  });

  it("charges what was really used, free first, and releases the rest", () => {
    const free = { startedAt: 0, endsAt: WEEK, usedTokens: 9_950_000, reservedTokens: 50_000 };
    const balance = { purchased: 1_000_000, reserved: 70_000 };
    const done = chargeTokens(free, balance, { freeTokens: 50_000, paidTokens: 70_000, windowStartedAt: 0 }, 80_000);
    expect(done).toEqual({ window: { startedAt: 0, endsAt: WEEK, usedTokens: 10_000_000, reservedTokens: 0 }, balance: { purchased: 970_000, reserved: 0 }, paidCharged: 30_000 });
  });

  it("lets one long request take the balance below zero, never more", () => {
    const done = chargeTokens(null, { purchased: 10, reserved: 120_000 }, { freeTokens: 0, paidTokens: 120_000, windowStartedAt: 0 }, 120_000);
    expect(done.balance).toEqual({ purchased: -119_990, reserved: 0 });
  });

  it("leaves a window that restarted since the hold alone", () => {
    const newer = { startedAt: 100, endsAt: 100 + WEEK, usedTokens: 0, reservedTokens: 0 };
    const done = chargeTokens(newer, none, { freeTokens: 5_000, paidTokens: 0, windowStartedAt: 0 }, 5_000);
    expect(done.window).toEqual(newer);
  });

  it("describes the allowance as the account sees it", () => {
    const on = { ...DEFAULT_PAID_CONFIG, enabled: true };
    expect(tokensView(on, { startedAt: 0, endsAt: WEEK, usedTokens: 4_000_000, reservedTokens: 100_000 }, { purchased: 50_000_000, reserved: 0 }, 10))
      .toEqual({ enabled: true, free: { limit: 10_000_000, used: 4_000_000, held: 100_000, remaining: 5_900_000, resetsAt: WEEK }, purchased: 50_000_000 });
    expect(tokensView(on, { startedAt: 0, endsAt: WEEK, usedTokens: 9e6, reservedTokens: 0 }, { purchased: -5, reserved: 0 }, WEEK + 1).free)
      .toEqual({ limit: 10_000_000, used: 0, held: 0, remaining: 10_000_000, resetsAt: null });
    expect(tokensView(on, null, { purchased: -5, reserved: 0 }, 0).purchased).toBe(0);
  });
});
