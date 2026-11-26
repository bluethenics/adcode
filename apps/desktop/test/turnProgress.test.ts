import { describe, expect, it } from "vitest";
import { validateSession } from "../../../packages/ai/src/sessions.ts";
import { createTurnProgress, describeToolCall, progressText } from "../src/main/turnProgress.ts";

/** A timer the test fires by hand. */
function manualTimers() {
  const pending: (() => void)[] = [];
  return {
    setTimer: (run: () => void) => { pending.push(run); return run; },
    clearTimer: (timer: unknown) => { const at = pending.indexOf(timer as () => void); if (at !== -1) pending.splice(at, 1); },
    fire: () => { for (const run of pending.splice(0)) run(); },
    count: () => pending.length,
  };
}

describe("a turn's progress, saved while it works", () => {
  it("describes each step by what it touched", () => {
    expect(describeToolCall("run_command", { command: "npm   test\n  --watch=false" })).toBe("run_command: npm test --watch=false");
    expect(describeToolCall("edit_file", { path: "src/login.tsx", old: "a", new: "b" })).toBe("edit_file: src/login.tsx");
    expect(describeToolCall("update_plan", { steps: [] })).toBe("update_plan");
    expect(describeToolCall("fetch_url", { url: `https://example.com/${"x".repeat(200)}` })).toMatch(/^fetch_url: https:\/\/example\.com\/x+…$/);
  });

  it("saves the words so far and the steps, with older steps counted rather than listed", () => {
    expect(progressText("", [])).toBe("");
    expect(progressText("Fixing the form.", ["read_file: src/a.ts", "edit_file: src/a.ts"])).toBe("Fixing the form.\n\nSteps taken before ADCode closed:\n- read_file: src/a.ts\n- edit_file: src/a.ts");
    const many = Array.from({ length: 45 }, (_, index) => `step ${String(index + 1)}`);
    const text = progressText("", many);
    expect(text).toContain("- …and 5 earlier steps\n- step 6");
    expect(text).toContain("- step 45");
    expect(text).not.toContain("- step 5\n");
  });

  it("saves at most once per interval, skips a save that would change nothing, and stops before the final write", async () => {
    const timers = manualTimers();
    const saved: string[] = [];
    let answer = "";
    const progress = createTurnProgress({ answer: () => answer, save: async (text) => { saved.push(text); }, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
    progress.step("read_file: src/a.ts");
    progress.step("read_file: src/a.ts");
    answer = "Looking at the form";
    progress.wrote();
    expect(timers.count()).toBe(1);
    timers.fire();
    await Promise.resolve();
    expect(saved).toEqual(["Looking at the form\n\nSteps taken before ADCode closed:\n- read_file: src/a.ts"]);
    progress.wrote();
    timers.fire();
    await Promise.resolve();
    expect(saved).toHaveLength(1);
    progress.step("edit_file: src/a.ts");
    await progress.stop();
    timers.fire();
    progress.step("run_command: npm test");
    expect(timers.count()).toBe(0);
    expect(saved).toHaveLength(1);
  });

  it("lets a save already under way land before stop resolves, so the finished answer is written last", async () => {
    const timers = manualTimers();
    const order: string[] = [];
    let release: () => void = () => {};
    const progress = createTurnProgress({
      answer: () => "partial",
      save: () => new Promise<void>((resolve) => { release = () => { order.push("progress saved"); resolve(); }; }),
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    progress.wrote();
    timers.fire();
    await Promise.resolve();
    const stopped = progress.stop().then(() => order.push("final answer saved"));
    await Promise.resolve();
    expect(order).toEqual([]);
    release();
    await stopped;
    expect(order).toEqual(["progress saved", "final answer saved"]);
  });

  it("keeps the interrupted mark when the conversation is read back, on answers only", () => {
    const session = validateSession({ id: "s1", title: "t", messages: [
      { role: "user", text: "Build it", at: 1, interrupted: true },
      { role: "assistant", text: "Working…", at: 2, interrupted: true },
    ] });
    expect(session?.messages[0]).not.toHaveProperty("interrupted");
    expect(session?.messages[1]).toMatchObject({ interrupted: true });
  });
});
