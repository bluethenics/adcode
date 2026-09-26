import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  advanceDeveloperCount,
  DeveloperCounter,
  DEVELOPER_COUNT_MAX_CATCHUP_MINUTES,
  DEVELOPER_COUNT_TICK_MS,
  HARDCODED_DEVELOPER_COUNT,
  parseDeveloperSnapshot,
  randomDeveloperStep,
  resolveDeveloperCount,
  splitCounterChars,
  splitPaddedDigits,
} from "../src/components/DeveloperCounter";

describe("splitCounterChars", () => {
  it("splits digits one per box", () => {
    expect(splitCounterChars(45689)).toEqual(["4", "5", ",", "6", "8", "9"]);
  });
  it("keeps group separators as spacers instead of abbreviating", () => {
    expect(splitCounterChars(1234567)).toEqual(["1", ",", "2", "3", "4", ",", "5", "6", "7"]);
  });
  it("renders zero honestly rather than rendering nothing", () => {
    expect(splitCounterChars(0)).toEqual(["0"]);
  });
});

describe("splitPaddedDigits", () => {
  it("pads to six boxes with a leading zero", () => {
    expect(splitPaddedDigits(47298)).toEqual(["0", "4", "7", "2", "9", "8"]);
  });
  it("keeps every digit when the total outgrows the width", () => {
    expect(splitPaddedDigits(1234567)).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
  });
});

describe("randomDeveloperStep", () => {
  it("stays within +1 to +10", () => {
    expect(randomDeveloperStep(() => 0)).toBe(1);
    expect(randomDeveloperStep(() => 0.999)).toBe(10);
    for (let i = 0; i < 100; i += 1) {
      const step = randomDeveloperStep();
      expect(step).toBeGreaterThanOrEqual(1);
      expect(step).toBeLessThanOrEqual(10);
    }
  });
});

describe("advanceDeveloperCount", () => {
  it("adds one random step per minute", () => {
    expect(advanceDeveloperCount(47298, 3, () => 0)).toBe(47301);
  });
  it("never goes backwards", () => {
    expect(advanceDeveloperCount(47298, 0)).toBe(47298);
    expect(advanceDeveloperCount(47298, -5)).toBe(47298);
  });
  it("caps catch-up so a long absence cannot teleport the total", () => {
    expect(advanceDeveloperCount(0, Number.MAX_SAFE_INTEGER, () => 0.999)).toBe(
      10 * DEVELOPER_COUNT_MAX_CATCHUP_MINUTES,
    );
  });
});

describe("parseDeveloperSnapshot", () => {
  it("accepts a well-formed snapshot", () => {
    expect(parseDeveloperSnapshot(JSON.stringify({ value: 47300, at: 123456 }))?.value).toBe(47300);
  });
  it.each([null, "", "garbage", "[]", JSON.stringify({ value: -1, at: 1 }), JSON.stringify({ value: 1.5, at: 1 }), JSON.stringify({ value: 1, at: "now" }), 42])(
    "rejects %s",
    (raw) => {
      expect(parseDeveloperSnapshot(raw)).toBeNull();
    },
  );
});

describe("resolveDeveloperCount", () => {
  const now = 1_700_000_000_000;
  it("starts from the base when nothing is stored", () => {
    expect(resolveDeveloperCount(null, now)).toEqual({ value: HARDCODED_DEVELOPER_COUNT, at: now });
  });
  it("resumes the stored value with no full minute elapsed", () => {
    expect(resolveDeveloperCount({ value: 47300, at: now - 30_000 }, now)).toEqual({
      value: 47300,
      at: now - 30_000,
    });
  });
  it("catches up one random step per missed minute", () => {
    expect(
      resolveDeveloperCount({ value: 47300, at: now - 2 * DEVELOPER_COUNT_TICK_MS }, now, HARDCODED_DEVELOPER_COUNT, () => 0),
    ).toEqual({ value: 47302, at: now });
  });
  it("never drops below the base", () => {
    expect(resolveDeveloperCount({ value: 12, at: now }, now).value).toBe(HARDCODED_DEVELOPER_COUNT);
  });
  it("resets the clock on future timestamps instead of unwinding", () => {
    expect(resolveDeveloperCount({ value: 47300, at: now + 60_000 }, now).value).toBe(47300);
  });
});

describe("DeveloperCounter", () => {
  it("renders the hardcoded total immediately, never a skeleton or reconnecting state", () => {
    const markup = renderToStaticMarkup(createElement(DeveloperCounter));

    expect(markup).toContain("Developer");
    expect(markup).toContain("on ADCode");
    for (const digit of ["0", "4", "7", "2", "9", "8"]) {
      expect(markup).toContain(`hero-dev-counter-digit">${digit}<`);
    }
    expect(markup).not.toContain("aria-busy");
    expect(markup).not.toContain("Reconnecting");
    expect(markup).not.toContain("Counting developers");
  });
});
