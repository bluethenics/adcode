import { describe, expect, it } from "vitest";
import { MASCOT_COLORS, MASCOT_SHAPES, defaultMascotFor, parseMascot } from "../src/renderer/agents/mascotStyle.ts";

describe("agent looks", () => {
  it("offers eight shapes and ten colours", () => {
    expect(MASCOT_SHAPES).toHaveLength(8);
    expect(MASCOT_COLORS).toHaveLength(10);
  });

  it("gives an agent the same look every time from its id", () => {
    expect(defaultMascotFor("agent-ada")).toEqual(defaultMascotFor("agent-ada"));
  });

  it("spreads agents across the shapes and colours", () => {
    const looks = Array.from({ length: 80 }, (_, index) => defaultMascotFor(`agent-${index}`));
    expect(new Set(looks.map((look) => look.shape)).size).toBeGreaterThanOrEqual(6);
    expect(new Set(looks.map((look) => look.color)).size).toBeGreaterThanOrEqual(8);
  });

  it("accepts only known shapes and colours", () => {
    expect(parseMascot({ shape: "egg", color: "teal" })).toEqual({ shape: "egg", color: "teal" });
    expect(parseMascot({ shape: "dragon", color: "teal" })).toBeNull();
    expect(parseMascot({ shape: "egg", color: "#ff0000" })).toBeNull();
    expect(parseMascot("egg")).toBeNull();
  });
});
