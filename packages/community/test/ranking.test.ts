import { describe, expect, it } from "vitest";
import { checkWaitlistPrice, compactCount, creatorLevel, creatorProfile, newlyEarnedBadges, streakDays, timeAgo, trendingScore } from "@adcode/community";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 4, 12);
const totals = { plugins: 0, artifacts: 0, installs: 0, stars: 0, remixes: 0, acceptedImprovements: 0, streakDays: 0 };

describe("trending", () => {
  it("lets a busy new listing overtake a quiet old one", () => {
    const fresh = trendingScore({ weekly: 20, stars: 3, remixes: 1, createdAt: NOW - 2 * DAY, updatedAt: NOW - DAY }, NOW);
    const old = trendingScore({ weekly: 5, stars: 200, remixes: 10, createdAt: NOW - 400 * DAY, updatedAt: NOW - 100 * DAY }, NOW);
    expect(fresh).toBeGreaterThan(old);
  });
});

describe("creator progress", () => {
  it("levels up with points and says how far the next level is", () => {
    expect(creatorLevel(0)).toMatchObject({ name: "Newcomer", next: "Tinkerer", toNext: 25 });
    expect(creatorLevel(150)).toMatchObject({ name: "Builder", next: "Maker", toNext: 150 });
    expect(creatorLevel(50_000)).toMatchObject({ name: "Legend", next: null, progress: 1 });
  });

  it("weights an accepted improvement above an install", () => {
    const profile = creatorProfile("u", "Ana", { ...totals, plugins: 1, installs: 12, acceptedImprovements: 1 });
    expect(profile.points).toBe(10 + 12 + 20);
    expect(profile.badges.filter((badge) => badge.earned).map((badge) => badge.id)).toEqual(["first-plugin", "helper", "ten-installs"]);
  });

  it("announces only badges crossed by this change", () => {
    expect(newlyEarnedBadges({ ...totals, installs: 9 }, { ...totals, installs: 10 })).toEqual(["Ten installs"]);
    expect(newlyEarnedBadges({ ...totals, installs: 10 }, { ...totals, installs: 11 })).toEqual([]);
  });

  it("counts a streak that ends today or yesterday", () => {
    const today = Math.floor(NOW / DAY);
    expect(streakDays([today, today - 1, today - 2, today - 4], NOW)).toBe(3);
    expect(streakDays([today - 1, today - 2], NOW)).toBe(2);
    expect(streakDays([today - 2], NOW)).toBe(0);
  });
});

describe("formatting", () => {
  it("compacts counts and dates", () => {
    expect(compactCount(999)).toBe("999");
    expect(compactCount(1200)).toBe("1.2k");
    expect(compactCount(45_000)).toBe("45k");
    expect(timeAgo(NOW - 3 * DAY, NOW)).toBe("3 days ago");
    expect(timeAgo(NOW - 1000, NOW)).toBe("just now");
  });

  it("validates a waitlist price", () => {
    expect(checkWaitlistPrice(4.999)).toBe(5);
    expect(checkWaitlistPrice(null)).toBeNull();
    expect(() => checkWaitlistPrice(-1)).toThrow();
  });
});
