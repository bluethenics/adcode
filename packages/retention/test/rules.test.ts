import { describe, expect, it } from "vitest";
import {
  CHURN_REASONS,
  CHURN_REASON_LABELS,
  churnReason,
  dayOf,
  foldEvents,
  furthestStep,
  isChurned,
  isoDay,
  summarize,
  weekStartOf,
  type UserFacts,
} from "@adcode/retention";
import { DAY, NOW, POPULATION } from "./fixture.ts";

const facts = (uid: string): UserFacts => {
  const person = POPULATION.find((candidate) => candidate.uid === uid)!;
  return foldEvents(person.uid, person.events)!;
};
const everyone = (): UserFacts[] => POPULATION.map((person) => foldEvents(person.uid, person.events)!);

describe("foldEvents", () => {
  it("keeps first and last times, counts by name and by name:code, and distinct days", () => {
    const failing = facts("u-failing");
    expect(failing.counts["turn_failed"]).toBe(3);
    expect(failing.counts["turn_failed:network"]).toBe(2);
    expect(failing.counts["turn_failed:server"]).toBe(1);
    expect(failing.activeDays).toBe(2);
    expect(failing.lastError).toEqual({ name: "turn_failed", code: "server", at: NOW - 33 * DAY });
    expect(failing.version).toBe("2.6.3");
  });

  it("remembers how the last session ended", () => {
    expect(facts("u-crashed").lastSession).toEqual({ code: "unclean", ms: 600_000, at: NOW - 18 * DAY });
  });

  it("has nothing to say about nobody", () => {
    expect(foldEvents("x", [])).toBeNull();
  });
});

describe("churnReason", () => {
  for (const person of POPULATION) {
    it(`${person.uid} left because: ${person.expected}`, () => {
      expect(churnReason(foldEvents(person.uid, person.events)!)).toBe(person.expected);
    });
  }

  it("labels every reason", () => {
    for (const reason of CHURN_REASONS) expect(CHURN_REASON_LABELS[reason].length).toBeGreaterThan(5);
  });

  it("puts a crash ahead of the limit hit in the same session", () => {
    const person = foldEvents("x", [
      { name: "first_launch", at: NOW - 10 * DAY }, { name: "limit_reached", at: NOW - 10 * DAY, code: "daily" },
      { name: "renderer_gone", at: NOW - 10 * DAY + 1, code: "crashed" },
    ])!;
    expect(churnReason(person)).toBe("crashed");
  });

  it("does not blame a limit hit days before the last session", () => {
    expect(churnReason(facts("u-new-active"))).toBe("faded");
  });
});

describe("furthestStep", () => {
  it("is the last funnel step reached, in funnel order", () => {
    expect(furthestStep(facts("u-noproject"))).toBe("first_launch");
    expect(furthestStep(facts("u-noedit"))).toBe("ai_turn_ok");
    expect(furthestStep(facts("u-faded"))).toBe("preview_opened");
  });
});

describe("isChurned", () => {
  it("needs N silent days, inside the lookback", () => {
    expect(isChurned(facts("u-noproject"), NOW, 3)).toBe(true);
    expect(isChurned(facts("u-noproject"), NOW, 7)).toBe(false);
    expect(isChurned(facts("u-loyal"), NOW, 3)).toBe(false);
    expect(isChurned(facts("u-ancient"), NOW, 7)).toBe(false);
  });
});

describe("dates", () => {
  it("formats days and finds Mondays without a clock", () => {
    expect(isoDay(0)).toBe("1970-01-01");
    expect(isoDay(dayOf(NOW))).toBe("2026-11-20");
    expect(isoDay(dayOf(Date.UTC(2024, 1, 29)))).toBe("2024-02-29");
    expect(isoDay(weekStartOf(dayOf(NOW)))).toBe("2026-11-16");
    expect(isoDay(weekStartOf(dayOf(Date.UTC(2026, 10, 16))))).toBe("2026-11-16");
  });
});

describe("summarize", () => {
  const summary = summarize(everyone(), NOW, 7);

  it("counts the pool, installs, activity and churn", () => {
    expect(summary.totals).toEqual({ users: 17, newInstalls: 16, active1d: 2, active7d: 5, active30d: 13, churned: 12 });
  });

  it("ranks churn reasons, biggest first", () => {
    expect(summary.reasons[0]).toEqual({ reason: "crashed", users: 2 });
    expect(summary.reasons.reduce((total, row) => total + row.users, 0)).toBe(12);
    expect(summary.reasons.find((row) => row.reason === "no_project")).toEqual({ reason: "no_project", users: 0 });
  });

  it("builds twelve weekly cohorts, judging day N only once N days have passed", () => {
    expect(summary.cohorts).toHaveLength(12);
    const thisWeek = summary.cohorts.at(-1)!;
    expect(thisWeek.weekStart).toBe("2026-11-16");
    // u-noproject (Sun 15th) is last week; this week: u-new-active (Tue 17th).
    expect(thisWeek.users).toBe(1);
    expect(thisWeek.d1).toEqual({ eligible: 1, retained: 1 });
    expect(thisWeek.d7).toEqual({ eligible: 0, retained: 0 });
  });

  it("shows where new installs dropped", () => {
    const steps = Object.fromEntries(summary.funnel.steps.map((row) => [row.step, row.users]));
    // u-ancient started outside the lookback and u-upgrader never had a first launch.
    expect(summary.funnel.base).toBe(16);
    expect(steps["first_launch"]).toBe(16);
    expect(steps["project_opened"]).toBe(15);
    expect(steps["ai_message"]).toBe(13);
    expect(steps["returned_day1"]).toBe(7);
    expect(steps["returned_day7"]).toBe(4);
  });

  it("ranks friction by churned users who hit it, with the top codes", () => {
    const failed = summary.friction.find((row) => row.name === "turn_failed")!;
    expect(failed.churned).toBe(3);
    expect(failed.users).toBe(4);
    // One churned user each; ties keep the code list's order.
    expect(failed.topCodes).toEqual([{ code: "auth", churned: 1 }, { code: "network", churned: 1 }, { code: "server", churned: 1 }]);
    expect(summary.friction[0]!.churned).toBeGreaterThanOrEqual(summary.friction.at(-1)!.churned);
    const limits = summary.friction.find((row) => row.name === "limit_reached")!;
    expect(limits).toEqual({ name: "limit_reached", churned: 1, users: 2, topCodes: [{ code: "daily", churned: 1 }] });
  });
});
