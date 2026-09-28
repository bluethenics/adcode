/**
 * The stuck guard. An agent that keeps trying the same failing fix burns money and time and
 * never says so; this notices, so the run can stop and ask for a different approach.
 *
 * The line it must not cross is stopping an agent that is making progress: running the tests
 * again and again while fixing different failures is normal work. So a success resets the
 * count, and only the exact same call counts.
 */
import { describe, expect, it } from "vitest";
import { createStuckDetector } from "../src/main/stuckDetector.ts";

const call = (name: string, detail: string) => ({ kind: "tool-call" as const, summary: `Called ${name}`, detail, outcome: "pending" as const });
const result = (name: string, ok: boolean) => ({ kind: "tool-result" as const, summary: `${name} ${ok ? "completed" : "failed"}`, detail: "", outcome: ok ? "ok" as const : "failed" as const });

describe("stuck detector", () => {
  it("stops a command that keeps failing", () => {
    const detector = createStuckDetector();
    const verdicts: (string | null)[] = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      verdicts.push(detector.observe(call("edit_file", `src/a${attempt}.ts`)), detector.observe(result("edit_file", true)));
      verdicts.push(detector.observe(call("run_command", "npm test")), detector.observe(result("run_command", false)));
    }
    expect(verdicts.slice(0, -1).every((verdict) => verdict === null)).toBe(true);
    expect(verdicts.at(-1)).toBe("npm test kept failing (4 tries)");
  });

  it("forgives failures once the same call succeeds", () => {
    const detector = createStuckDetector();
    let edit = 0;
    // Real work: an edit between test runs, then the tests again.
    const run = (ok: boolean) => [
      detector.observe(call("edit_file", `src/fix${++edit}.ts`)), detector.observe(result("edit_file", true)),
      detector.observe(call("run_command", "npm test")), detector.observe(result("run_command", ok)),
    ];
    const verdicts = [...run(false), ...run(false), ...run(false), ...run(true), ...run(false), ...run(false), ...run(false)];
    expect(verdicts.every((verdict) => verdict === null)).toBe(true);
  });

  it("stops the same call made over and over without anything in between", () => {
    const detector = createStuckDetector();
    const verdicts = Array.from({ length: 6 }, () => [detector.observe(call("read_file", "src/app.ts")), detector.observe(result("read_file", true))]).flat();
    expect(verdicts.slice(0, -2).every((verdict) => verdict === null)).toBe(true);
    expect(verdicts.at(-2)).toBe("read_file on src/app.ts was repeated 6 times in a row");
  });

  it("does not count different calls as a loop", () => {
    const detector = createStuckDetector();
    const verdicts = Array.from({ length: 12 }, (_, index) => detector.observe(call("read_file", `src/file${index}.ts`)));
    expect(verdicts.every((verdict) => verdict === null)).toBe(true);
  });

  it("describes a failing edit by its file", () => {
    const detector = createStuckDetector();
    let verdict: string | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      detector.observe(call("edit_file", "src/app.ts"));
      verdict = detector.observe(result("edit_file", false));
      detector.observe(call("read_file", "src/app.ts"));
      detector.observe(result("read_file", true));
    }
    expect(verdict).toBe("editing src/app.ts kept failing (4 tries)");
  });
});
