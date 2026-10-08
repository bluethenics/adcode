import { describe, expect, it } from "vitest";
import { DEMO_CODE_LENGTH, DEMO_MS, DEMO_PHASES, DEMO_README_LENGTH, DEMO_TEST_LINES, demoFrame, demoRestFrame } from "../src/lib/liveDemo";

describe("the homepage's live agents demo", () => {
  it("starts with nothing written and only Build at work", () => {
    const frame = demoFrame(0);
    expect(frame.phase).toBe(0);
    expect(frame.build).toMatchObject({ typed: 0, status: "working" });
    expect(frame.tests.status).toBe("waiting");
    expect(frame.docs.status).toBe("waiting");
    expect(frame.bubble).toBeNull();
  });

  it("types steadily, never backwards", () => {
    let before = -1;
    for (let at = 0; at < DEMO_MS; at += 50) {
      const typed = demoFrame(at).build.typed;
      expect(typed).toBeGreaterThanOrEqual(before);
      before = typed;
    }
    expect(before).toBe(DEMO_CODE_LENGTH);
  });

  it("walks its four points in order", () => {
    const phases = Array.from({ length: DEMO_MS / 100 }, (_, index) => demoFrame(index * 100).phase);
    expect([...new Set(phases)]).toEqual([0, 1, 2, 3]);
    expect(DEMO_PHASES.map((phase) => phase.at)).toEqual([...DEMO_PHASES.map((phase) => phase.at)].sort((a, b) => a - b));
  });

  it("only animates a message that is really sent: Build to Tests, then Build to Docs", () => {
    const bubbles = Array.from({ length: DEMO_MS / 50 }, (_, index) => demoFrame(index * 50).bubble)
      .filter((bubble) => bubble !== null)
      .map((bubble) => `${bubble.from}>${bubble.to}`);
    expect([...new Set(bubbles)]).toEqual(["build>tests", "build>docs"]);
  });

  it("starts each teammate only after it is messaged", () => {
    const firstWorking = (who: "tests" | "docs") => {
      for (let at = 0; at < DEMO_MS; at += 50) if (demoFrame(at)[who].status !== "waiting") return at;
      return Infinity;
    };
    const firstBubbleTo = (who: "tests" | "docs") => {
      for (let at = 0; at < DEMO_MS; at += 50) if (demoFrame(at).bubble?.to === who) return at;
      return Infinity;
    };
    expect(firstWorking("tests")).toBeGreaterThan(firstBubbleTo("tests"));
    expect(firstWorking("docs")).toBeGreaterThan(firstBubbleTo("docs"));
  });

  it("ends with the suite passed, Build proven, and Docs honestly unverified", () => {
    const end = demoFrame(DEMO_MS - 1);
    expect(end.tests).toMatchObject({ lines: DEMO_TEST_LINES.length, status: "done", proof: "passed" });
    expect(end.build).toMatchObject({ status: "done", proof: "passed" });
    expect(end.docs).toMatchObject({ typed: DEMO_README_LENGTH, status: "done", proof: "unverified" });
    expect(end.memory).toBe(true);
  });

  it("keeps the last message as a line under the mascots", () => {
    expect(demoFrame(0).log).toBeNull();
    expect(demoFrame(4_500).log).toBe("Build → Tests: greet() is ready in greet.ts");
    expect(demoFrame(9_000).log).toBe("Build → Docs: Please document greet(name)");
  });

  it("loops", () => {
    expect(demoFrame(DEMO_MS + 1234)).toEqual(demoFrame(1234));
  });

  it("has a still frame for reduced motion that shows the whole story", () => {
    const rest = demoRestFrame();
    expect(rest.build.typed).toBe(DEMO_CODE_LENGTH);
    expect(rest.tests.proof).toBe("passed");
    expect(rest.bubble).toBeNull();
  });
});
