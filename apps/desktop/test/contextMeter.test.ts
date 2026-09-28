import { describe, expect, it } from "vitest";
import { compactCommand, contextMeterModel, formatTokens } from "../src/renderer/ai/contextMeter.ts";

const usage = (tokens: number, extra: Partial<{ contextWindow: number; thresholdPercent: number; autoCompact: boolean }> = {}) => ({
  tokens,
  contextWindow: 200_000,
  thresholdPercent: 80,
  autoCompact: true,
  ...extra,
});

describe("formatTokens", () => {
  it("reads like a person would say it", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(1_234)).toBe("1.2k");
    expect(formatTokens(43_210)).toBe("43k");
    expect(formatTokens(128_000)).toBe("128k");
    expect(formatTokens(1_000_000)).toBe("1M");
    expect(formatTokens(2_500_000)).toBe("2.5M");
  });
});

describe("contextMeterModel", () => {
  it("shows how full the context is", () => {
    const model = contextMeterModel(usage(68_000));
    expect(model.percent).toBe(34);
    expect(model.label).toBe("Context 34%");
    expect(model.tone).toBe("ok");
  });

  it("warns as it nears the point where it compacts", () => {
    expect(contextMeterModel(usage(140_000)).tone).toBe("warn");
    expect(contextMeterModel(usage(165_000)).tone).toBe("full");
  });

  it("explains the numbers and what happens next", () => {
    expect(contextMeterModel(usage(43_210)).tooltip).toBe("About 43k of 200k tokens. ADCode compacts this conversation automatically at about 80%.");
    expect(contextMeterModel(usage(43_210, { autoCompact: false })).tooltip).toBe("About 43k of 200k tokens. Auto-compact is off: type /compact to make room.");
    expect(contextMeterModel(usage(43_210)).amount).toBe("About 43k of 200k tokens");
  });

  it("never shows more than 100% or less than 0%", () => {
    expect(contextMeterModel(usage(900_000)).percent).toBe(100);
    expect(contextMeterModel(usage(-5)).percent).toBe(0);
    expect(contextMeterModel(usage(10, { contextWindow: 0 })).percent).toBe(0);
  });
});

describe("compactCommand", () => {
  it("recognises /compact on its own and with a focus", () => {
    expect(compactCommand("/compact")).toEqual({ focus: undefined });
    expect(compactCommand("  /compact  ")).toEqual({ focus: undefined });
    expect(compactCommand("/compact keep the API decisions")).toEqual({ focus: "keep the API decisions" });
  });

  it("leaves everything else to be sent", () => {
    expect(compactCommand("/compacting is weird")).toBeNull();
    expect(compactCommand("please /compact")).toBeNull();
    expect(compactCommand("hello")).toBeNull();
  });
});
