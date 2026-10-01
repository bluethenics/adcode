import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  DeveloperCounter,
  DeveloperCounterView,
  splitPaddedDigits,
  weeklyLine,
} from "../src/components/DeveloperCounter";

describe("splitPaddedDigits", () => {
  it("pads to six boxes with leading zeros", () => {
    expect(splitPaddedDigits(632)).toEqual(["0", "0", "0", "6", "3", "2"]);
  });
  it("keeps every digit when the total outgrows the width", () => {
    expect(splitPaddedDigits(1234567)).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
  });
});

describe("weeklyLine", () => {
  it("states the week's sign-ups when there were any", () => {
    expect(weeklyLine(214)).toBe("+214 joined this week");
    expect(weeklyLine(1500)).toBe("+1,500 joined this week");
  });
  it("says nothing about growth in a week without any", () => {
    expect(weeklyLine(0)).toBe("on ADCode");
  });
});

describe("DeveloperCounter", () => {
  /*
   * The hero once showed a hard-coded 47,298 that ticked up by a random amount every
   * minute, on a site that sells advertisers access to these developers. The number on the
   * page is now the API's count or nothing.
   */
  it("shows the API's count, not a number of its own", () => {
    const markup = renderToStaticMarkup(createElement(DeveloperCounterView, { state: { status: "ready", developers: 632, thisWeek: 214 } }));
    for (const digit of ["0", "0", "0", "6", "3", "2"]) expect(markup).toContain(`hero-dev-counter-digit">${digit}<`);
    expect(markup).toContain("+214 joined this week");
    expect(markup).toContain("632 developers on ADCode");
  });

  it("renders empty boxes while loading rather than a guess", () => {
    const markup = renderToStaticMarkup(createElement(DeveloperCounter));
    expect(markup).toContain('aria-busy="true"');
    expect(markup).not.toMatch(/hero-dev-counter-digit">\d</);
  });

  it("gets out of the way when the count is unavailable", () => {
    expect(renderToStaticMarkup(createElement(DeveloperCounterView, { state: { status: "offline" } }))).toBe("");
  });

  it("has no invented baseline or random growth left in it", () => {
    const source = readFileSync(new URL("../src/components/DeveloperCounter.tsx", import.meta.url), "utf8");
    expect(source).not.toMatch(/Math\.random|HARDCODED|localStorage/);
  });
});
