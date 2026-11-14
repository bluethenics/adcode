import { describe, expect, it } from "vitest";
import { MIN_TICK_DELAY_MS, PARTNER_RETRY_MS, nextTickDelay, partnerExchange, partnerRetryDelay } from "../src/main/partnerNotification.ts";

const TICK = 60_000;

describe("what Zeekend picks a notification from", () => {
  it("names only the project's topics, in a question about the working day", () => {
    const exchange = partnerExchange(["typescript", "react"], 1);
    expect(exchange.request).toContain("typescript, react");
    expect(exchange.response).toContain("typescript, react");
    expect(exchange.request.endsWith("?")).toBe(true);
  });

  it("says software when nothing is open, and keeps at most six topics", () => {
    expect(partnerExchange([], 1).request).toContain("software");
    const many = partnerExchange(["a", "b", "c", "d", "e", "f", "g", "h"], 1).request;
    expect(many).toContain("a, b, c, d, e, f");
    expect(many).not.toContain(", g");
  });

  it("turns the wording with each notification, and comes back round", () => {
    const first = partnerExchange(["rust"], 1).request;
    expect(partnerExchange(["rust"], 2).request).not.toBe(first);
    expect(partnerExchange(["rust"], 4).request).toBe(first);
    // A turn below one is read as the first.
    expect(partnerExchange(["rust"], 0).request).toBe(first);
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
