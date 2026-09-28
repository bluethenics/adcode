/**
 * Agent mascots: the face tells you how a run is doing before you read a word. The mapping
 * is the contract - a proud face on a failed run would be worse than no face at all.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MASCOT_COLORS, MASCOT_SHAPES } from "../src/renderer/agents/mascotStyle.ts";
import { AGENT_MOODS, MASCOT_BODIES, mascotMoodForStatus } from "../src/renderer/agents/agentMascot.ts";

const source = readFileSync(new URL("../src/renderer/agents/agentMascot.ts", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/renderer/styles/agents.css", import.meta.url), "utf8");

describe("mascot moods", () => {
  it("shows each run state with the face a person would expect", () => {
    expect(mascotMoodForStatus("queued")).toBe("sleepy");
    expect(mascotMoodForStatus("running")).toBe("thinking");
    expect(mascotMoodForStatus("merging")).toBe("thinking");
    for (const status of ["configured", "conflict", "budget", "paused"] as const) expect(mascotMoodForStatus(status)).toBe("alert");
    expect(mascotMoodForStatus("ready")).toBe("proud");
    expect(mascotMoodForStatus("applied")).toBe("happy");
    expect(mascotMoodForStatus("completed")).toBe("happy");
    expect(mascotMoodForStatus("failed")).toBe("confused");
    for (const status of ["cancelled", "discarded", "rolled-back"] as const) expect(mascotMoodForStatus(status)).toBe("sleepy");
  });

  it("draws a body for every shape and a face for every mood", () => {
    expect(Object.keys(MASCOT_BODIES).sort()).toEqual([...MASCOT_SHAPES].sort());
    expect(AGENT_MOODS).toEqual(["sleepy", "thinking", "alert", "proud", "happy", "confused"]);
  });
});

describe("mascot drawing", () => {
  it("marks mood, shape and colour for the stylesheet and stays decorative", () => {
    expect(source).toContain('dataset["mood"]');
    expect(source).toContain('dataset["shape"]');
    expect(source).toContain('dataset["color"]');
    expect(source).toContain('setAttribute("aria-hidden", "true")');
  });

  it("has a colour token for every colour in light and dark themes", () => {
    for (const color of MASCOT_COLORS) {
      expect(styles.match(new RegExp(`--mascot-${color}:`, "g"))?.length ?? 0).toBeGreaterThanOrEqual(2);
    }
    expect(styles).toContain(':root[data-theme="dark"]');
  });

  it("holds still for people who asked for less motion", () => {
    expect(styles).toContain("prefers-reduced-motion: reduce");
    expect(styles).toContain('[data-reduced-motion="true"] .agent-mascot');
  });
});
