import { describe, expect, it } from "vitest";
import { countdown, limitPauseView, parseLimitPause, resumeClock } from "../src/renderer/ai/limitPause.ts";

const now = new Date(2026, 9, 27, 14, 0, 0).getTime();
const at = (hours: number, minutes = 0): number => now + hours * 3_600_000 + minutes * 60_000;

describe("the usage-limit card", () => {
  it("accepts only a well-formed pause from the main process", () => {
    expect(parseLimitPause({ reason: "paid", resumeAt: at(5), recheckAt: at(0, 2), buyUrl: "https://adcode.bluethenics.com/ai-tokens" }))
      .toEqual({ reason: "paid", resumeAt: at(5), recheckAt: at(0, 2), buyUrl: "https://adcode.bluethenics.com/ai-tokens" });
    expect(parseLimitPause({ reason: "paid", resumeAt: at(5), recheckAt: at(0, 2), buyUrl: "javascript:alert(1)" })).not.toHaveProperty("buyUrl");
    for (const bad of [null, "paid", { reason: "free", resumeAt: 1, recheckAt: 1 }, { reason: "paid", resumeAt: "soon", recheckAt: 1 }]) expect(parseLimitPause(bad)).toBeNull();
  });
  it("says when, in the person's own clock, and counts down without ever showing zero", () => {
    expect(resumeClock(at(2, 30), now, "en-US")).toBe("4:30 PM");
    expect(resumeClock(at(20), now, "en-US")).toBe("tomorrow at 10:00 AM");
    expect(resumeClock(at(72), now, "en-US")).toMatch(/^Fri, Oct 30, 2:00 PM$/);
    expect(countdown(at(2, 14), now)).toBe("in 2 h 14 min");
    expect(countdown(at(0, 0) + 59_001, now)).toBe("in 1 min");
    expect(countdown(at(0, 0) + 30_000, now)).toBe("in 30 s");
    expect(countdown(at(0, 0) + 500, now)).toBe("any moment now");
    expect(countdown(at(96), now)).toBe("in 4 days");
  });
  it("offers an upgrade and the wait, and promises the task carries on by itself", () => {
    const paid = limitPauseView({ reason: "paid", resumeAt: at(2, 30), recheckAt: at(0, 2) }, now, "en-US");
    expect(paid.title).toBe("You've reached today's included AI limit");
    expect(paid.body).toContain("Upgrade your plan or buy tokens to keep going now, or wait until 4:30 PM");
    expect(paid.resume).toBe("Continues automatically at 4:30 PM (in 2 h 30 min) - keep ADCode open.");
    expect(paid.actions).toEqual(["upgrade-plan", "buy-tokens", "models"]);
    const weekly = limitPauseView({ reason: "weekly", resumeAt: at(20), recheckAt: at(0, 2) }, now, "en-US");
    expect(weekly.title).toBe("You've reached this week's free AI limit");
    expect(weekly.body).toContain("Wait until tomorrow at 10:00 AM");
    expect(weekly.resume).toBe("Continues automatically tomorrow at 10:00 AM (in 20 h) - keep ADCode open.");
    expect(weekly.actions[0]).toBe("upgrade-plan");
  });
  it("does not sell a plan for a per-minute or provider limit a plan cannot lift", () => {
    for (const reason of ["rate", "upstream"] as const) {
      const view = limitPauseView({ reason, resumeAt: at(0, 1), recheckAt: at(0, 1) }, now, "en-US");
      expect(view.actions).toEqual(["models"]);
      expect(view.resume).toContain("Tries again automatically at 2:01 PM");
    }
  });
});
