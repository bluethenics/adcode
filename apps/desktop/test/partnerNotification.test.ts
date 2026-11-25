import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MIN_TICK_DELAY_MS, PARTNER_RETRY_MS, nextTickDelay, partnerRetryDelay } from "../src/main/partnerNotification.ts";

const TICK = 60_000;

describe("what a partner is asked about", () => {
  // Zeekend suspended ADCode on 2026-11-25 for questions "no user wrote". ADCode never writes a
  // message in a person's name: a partner hears only what a person sent.
  it("never writes a question for a notification", () => {
    const source = readFileSync(new URL("../src/main/partnerNotification.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/partnerExchange|What's worth buying|software developer working/);
    const ads = readFileSync(new URL("../src/main/ads.ts", import.meta.url), "utf8");
    expect(ads).not.toContain("partnerExchange");
  });
});

describe("when the next sponsored notification is due", () => {
  it("wakes exactly when the frequency's gap ends, not a whole tick later", () => {
    expect(nextTickDelay(1_000_000, 1_000_000 + 25_000, TICK)).toBe(25_000);
  });

  it("waits a regular tick when the slot is already open but something else held the card back", () => {
    // The window was unfocused, a debug session ran, or the app was still settling.
    expect(nextTickDelay(1_000_000, 990_000, TICK)).toBe(TICK);
    expect(nextTickDelay(1_000_000, 1_000_000, TICK)).toBe(TICK);
  });

  it("asks again soon after Zeekend left a slot empty", () => {
    expect(nextTickDelay(1_000_000, 990_000, TICK, 1_000_000 + PARTNER_RETRY_MS)).toBe(PARTNER_RETRY_MS);
  });

  it("is never longer than the tick nor shorter than a second", () => {
    expect(nextTickDelay(0, 10 * TICK, TICK)).toBe(TICK);
    expect(nextTickDelay(1_000_000, 1_000_010, TICK)).toBe(MIN_TICK_DELAY_MS);
    expect(nextTickDelay(1_000_000, 990_000, TICK, 999_000)).toBe(MIN_TICK_DELAY_MS);
  });
});

describe("asking again after an empty answer", () => {
  it("backs off - 20s, 40s, then past the regular tick, which caps it", () => {
    expect(partnerRetryDelay(0)).toBe(PARTNER_RETRY_MS);
    expect(partnerRetryDelay(1)).toBe(2 * PARTNER_RETRY_MS);
    expect(partnerRetryDelay(2)).toBeGreaterThan(TICK);
    expect(nextTickDelay(0, -1, TICK, partnerRetryDelay(5))).toBe(TICK);
  });
});

describe("the conversation id a counted card carries to the earn claim", () => {
  it("accepts only the server's plain-id shape, and drops anything else", async () => {
    const { partnerConversationId } = await import("../src/main/partnerNotification.ts");
    expect(partnerConversationId("adc_0123456789abcdef01234567")).toBe("adc_0123456789abcdef01234567");
    expect(partnerConversationId("a:b.c-d_e")).toBe("a:b.c-d_e");
    for (const bad of [undefined, null, 42, "", "a b", "x".repeat(129), "../etc", "é"]) expect(partnerConversationId(bad)).toBeUndefined();
  });

  it("puts it in the claim body only when there is one", async () => {
    const { partnerEarnBody } = await import("../src/main/partnerNotification.ts");
    expect(partnerEarnBody("slot_abcd1234", "adc_1")).toEqual({ network: "zeekend", slotId: "slot_abcd1234", conversationId: "adc_1" });
    expect(partnerEarnBody("slot_imp_abcd1234", "bad id")).toEqual({ network: "imprezia", slotId: "slot_imp_abcd1234" });
    expect(partnerEarnBody("slot_abcd1234")).toEqual({ network: "zeekend", slotId: "slot_abcd1234" });
  });
});
