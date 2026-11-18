import { describe, expect, it } from "vitest";
import { ago, continueHint, streakLine } from "../src/renderer/ai/comeback.ts";

const now = Date.UTC(2026, 10, 17, 12);
const hour = 3_600_000;

describe("coming back", () => {
  it("says why the last conversation is worth reopening", () => {
    expect(continueHint([{ role: "user", text: "fix it" }], now - hour, now)).toBe("Your last message has no answer yet - send it again");
    expect(continueHint([{ role: "user", text: "fix it" }, { role: "assistant", text: "Should I also update the tests?" }], now, now)).toBe("It is waiting on your answer");
    expect(continueHint([{ role: "assistant", text: "Done. Let me know if you want the README too." }], now, now)).toBe("It is waiting on your answer");
    expect(continueHint([{ role: "assistant", text: "Done - all tests pass." }], now - 3 * hour, now)).toBe("Last worked on 3 hours ago");
    expect(continueHint([], now, now)).toBe("Pick up where you left off");
  });

  it("says how long ago in coarse words", () => {
    expect(ago(now - 30_000, now)).toBe("just now");
    expect(ago(now - 25 * hour, now)).toBe("yesterday");
    expect(ago(now - 5 * 24 * hour, now)).toBe("5 days ago");
    expect(ago(now - 30 * 24 * hour, now)).toBe("4 weeks ago");
  });

  it("mentions a streak only when there is one, and how to keep it", () => {
    expect(streakLine(1, false)).toBeNull();
    expect(streakLine(4, false)).toBe("4-day streak - one message today keeps it going.");
    expect(streakLine(4, true)).toBe("4 days in a row.");
  });
});
