import { describe, expect, it } from "vitest";
import { buildPost, dollars, parseGrowth, shareLine, xIntentUrl } from "../src/lib/growth";

const wire = {
  developers: 632, joined7d: 214, joined30d: 496, active1d: 31, active7d: 128, active30d: 324,
  adsShown: 194, adsShown7d: 102, adsShown30d: 150, clicks: 11, creditedMicros: "226800",
  daily: [{ day: "2026-10-01", active: 31, joined: 47, adsShown: 20 }], asOf: Date.UTC(2026, 9, 2),
};

describe("admin growth numbers", () => {
  it("reads the API's answer, with money as an exact bigint", () => {
    const growth = parseGrowth(wire);
    expect(growth?.developers).toBe(632);
    expect(growth?.creditedMicros).toBe(226_800n);
    expect(growth?.daily).toHaveLength(1);
  });

  it("reads who came back and how far new people got, when the API reports it", () => {
    const growth = parseGrowth({
      ...wire,
      accounts: 633,
      developers: 419,
      returning1d: 1,
      returning7d: 3,
      daily: [{ day: "2026-10-01", active: 31, returning: 2, joined: 28, adsShown: 20 }],
      cohorts: [{ weekStart: "2026-09-28", joined: 48, back1d: 1, back7d: 0 }],
      funnel: { base: 283, steps: [{ name: "welcome_shown", accounts: 0 }, { name: "turn_ok", accounts: 0 }] },
    });
    expect(growth?.accounts).toBe(633);
    expect(growth?.returning7d).toBe(3);
    expect(growth?.daily[0]?.returning).toBe(2);
    expect(growth?.cohorts).toEqual([{ weekStart: "2026-09-28", joined: 48, back1d: 1, back7d: 0 }]);
    expect(growth?.funnel?.base).toBe(283);
  });

  it("still reads an API deployed before those numbers existed", () => {
    const growth = parseGrowth(wire);
    expect(growth?.accounts).toBeNull();
    expect(growth?.returning7d).toBeNull();
    expect(growth?.cohorts).toEqual([]);
    expect(growth?.funnel).toBeNull();
    expect(growth?.daily[0]?.returning).toBeNull();
  });

  it("refuses anything malformed rather than showing a wrong number", () => {
    expect(parseGrowth({ ...wire, active7d: -1 })).toBeNull();
    expect(parseGrowth({ ...wire, creditedMicros: 226800 })).toBeNull();
    expect(parseGrowth({ ...wire, daily: [{ day: "x", active: "1" }] })).toBeNull();
    expect(parseGrowth(null)).toBeNull();
  });

  it("rounds money down to the cent - never claims a cent that was not paid", () => {
    expect(dollars(226_800n)).toBe("$0.22");
    expect(dollars(1_234_567_890n)).toBe("$1,234.56");
  });
});

describe("the post", () => {
  const growth = parseGrowth(wire)!;

  it("says exactly the figures picked, in order, and links the site", () => {
    expect(buildPost(growth, ["developers", "joined7d", "active30d"])).toBe(
      "ADCode, by the numbers:\n\n632 developers on ADCode\n+214 joined this week\n324 active this month\n\nThe free AI code editor that pays you to build.\nadcode.bluethenics.com",
    );
  });

  it("fits in a post with every figure picked", () => {
    expect(buildPost(growth, ["developers", "joined7d", "active30d", "adsShown"]).length).toBeLessThanOrEqual(280);
  });

  it("labels each figure for what it counts", () => {
    expect(shareLine(growth, "adsShown")).toEqual({ metric: "adsShown", value: "194", label: "sponsored cards shown" });
    expect(shareLine(growth, "credited").value).toBe("$0.22");
  });

  it("opens X's compose window rather than posting anything itself", () => {
    expect(xIntentUrl("a b\nc")).toBe("https://x.com/intent/post?text=a%20b%0Ac");
  });
});
