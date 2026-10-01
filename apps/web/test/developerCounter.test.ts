import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { countUpValue, DeveloperCounter, DeveloperCounterView } from "../src/components/DeveloperCounter";

describe("countUpValue", () => {
  it("starts at zero and lands exactly on the real value", () => {
    expect(countUpValue(632, 0)).toBe(0);
    expect(countUpValue(632, 1)).toBe(632);
    expect(countUpValue(632, 5)).toBe(632);
  });
  it("only ever climbs", () => {
    let previous = 0;
    for (let step = 0; step <= 20; step += 1) {
      const value = countUpValue(632, step / 20);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
});

describe("DeveloperCounter", () => {
  /*
   * The hero once showed a hard-coded 47,298 that ticked up by a random amount every
   * minute, on a site that sells advertisers access to these developers. The number on the
   * page is now the API's count or nothing.
   */
  it("shows the API's count and this week's sign-ups, without zero-padding", () => {
    const markup = renderToStaticMarkup(createElement(DeveloperCounterView, { state: { status: "ready", developers: 632, thisWeek: 214 } }));
    expect(markup).toContain(">632<");
    expect(markup).toMatch(/\+(<!-- -->)?214</);
    expect(markup).not.toContain("000632");
    expect(markup).toContain("632 developers on ADCode, 214 joined this week");
  });

  it("groups thousands", () => {
    const markup = renderToStaticMarkup(createElement(DeveloperCounterView, { state: { status: "ready", developers: 12_345, thisWeek: 1_500 } }));
    expect(markup).toContain(">12,345<");
    expect(markup).toContain("1,500<");
  });

  it("leaves out the weekly figure in a week without sign-ups", () => {
    const markup = renderToStaticMarkup(createElement(DeveloperCounterView, { state: { status: "ready", developers: 632, thisWeek: 0 } }));
    expect(markup).not.toContain("joined this week</dt>");
  });

  it("renders blank figures while loading rather than a guess", () => {
    const markup = renderToStaticMarkup(createElement(DeveloperCounter));
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("hero-dev-counter-blank");
    expect(markup).not.toMatch(/<dd>\+?\d/);
  });

  it("gets out of the way when the count is unavailable", () => {
    expect(renderToStaticMarkup(createElement(DeveloperCounterView, { state: { status: "offline" } }))).toBe("");
  });

  it("has no invented baseline or random growth left in it", () => {
    const source = readFileSync(new URL("../src/components/DeveloperCounter.tsx", import.meta.url), "utf8");
    expect(source).not.toMatch(/Math\.random|HARDCODED|localStorage/);
  });
});
