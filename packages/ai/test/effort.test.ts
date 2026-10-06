import { describe, expect, it } from "vitest";
import { effortFor } from "../src/effort.ts";

/**
 * ADCode offers four levels - Low, Medium, High, Max - and every model has its own list:
 * GPT-5 Mini takes minimal..high, GPT-5.6 none..max, Gemini 3 Pro low and high, Claude Opus
 * 4.5 low..high. Sending a level a model does not have is a 400, which is how "Max" broke
 * every model whose top level is called something else.
 */
describe("effortFor", () => {
  it("sends the level by name when the model has it", () => {
    expect(effortFor("medium", ["low", "medium", "high"])).toBe("medium");
    expect(effortFor("max", ["low", "medium", "high", "xhigh", "max"])).toBe("max");
  });

  it("gives Max the model's highest level, whatever it is called", () => {
    expect(effortFor("max", ["low", "medium", "high", "xhigh"])).toBe("xhigh");
    expect(effortFor("max", ["minimal", "low", "medium", "high"])).toBe("high");
    expect(effortFor("max", ["low", "high"])).toBe("high");
  });

  it("rounds Low down and High up when the exact level is missing", () => {
    expect(effortFor("low", ["minimal", "medium", "high"])).toBe("minimal");
    expect(effortFor("high", ["low", "medium", "xhigh"])).toBe("xhigh");
  });

  it("rounds Medium up when it sits between two levels", () => {
    expect(effortFor("medium", ["low", "high"])).toBe("high");
  });

  it("never picks none on the user's behalf", () => {
    expect(effortFor("low", ["none", "medium", "high"])).toBe("medium");
  });

  it("sends nothing to a model with no levels, or an unknown one", () => {
    expect(effortFor("high", [])).toBeUndefined();
    expect(effortFor("high", null)).toBeUndefined();
    expect(effortFor("high", undefined)).toBeUndefined();
    expect(effortFor(undefined, ["low", "high"])).toBeUndefined();
  });

  it("ignores levels it does not recognise", () => {
    expect(effortFor("high", ["turbo"])).toBeUndefined();
    expect(effortFor("high", ["turbo", "low"])).toBe("low");
  });
});
