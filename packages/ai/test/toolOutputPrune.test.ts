import { describe, expect, it } from "vitest";
import { PRUNED_NOTE, applyToolOutputPrune, planToolOutputPrune } from "../src/toolOutputPrune.ts";
import type { Message } from "../src/types.ts";

/** One assistant step calling a tool, and the user message carrying its result. */
function step(id: string, name: string, input: Record<string, unknown>, chars: number): Message[] {
  return [
    { role: "assistant", content: [{ type: "tool-call", id, name, input }] },
    { role: "user", content: [{ type: "tool-result", toolCallId: id, content: "x".repeat(chars), isError: false }] },
  ];
}

const small = { protectTokens: 1_000, minimumTokens: 500 };
const none: ReadonlySet<string> = new Set();

describe("which tool output stops being sent", () => {
  it("clears a read of a file that was edited afterwards, however recent", () => {
    const history = [
      { role: "user" as const, content: [{ type: "text" as const, text: "fix the header" }] },
      ...step("r1", "read_file", { path: "src/header.ts" }, 8_000),
      ...step("e1", "edit_file", { path: "./src/header.ts" }, 100),
      ...step("t1", "run_command", { command: "npm test" }, 700),
    ];
    const cleared = planToolOutputPrune(history, none, { protectTokens: 100_000, minimumTokens: 1_000 });
    expect([...cleared]).toEqual(["r1"]);
  });

  it("clears an earlier read of the same page, but never a different page of a long file", () => {
    const history = [
      ...step("p1", "read_file", { path: "big.ts" }, 8_000),
      ...step("p2", "read_file", { path: "big.ts", offset: 400 }, 8_000),
      ...step("p3", "read_file", { path: "big.ts", offset: 1 }, 8_000),
      ...step("end", "list_files", {}, 50),
    ];
    const cleared = planToolOutputPrune(history, none, { protectTokens: 100_000, minimumTokens: 1_000 });
    expect([...cleared]).toEqual(["p1"]);
  });

  it("clears output past the protected newest tokens", () => {
    const history = [
      ...step("old", "run_command", { command: "npm test" }, 12_000),
      ...step("mid", "search", { query: "x" }, 4_000),
      ...step("new", "search", { query: "y" }, 2_000),
    ];
    expect([...planToolOutputPrune(history, none, small)]).toEqual(["old"]);
  });

  it("never clears the newest results, answers from the person, skills or the plan", () => {
    const history = [
      ...step("a", "ask_user", { question: "which?" }, 9_000),
      ...step("s", "load_skill", { name: "x" }, 9_000),
      ...step("p", "update_plan", {}, 9_000),
      ...step("latest", "run_command", { command: "build" }, 9_000),
    ];
    expect(planToolOutputPrune(history, none, small).size).toBe(0);
  });

  it("waits until a batch is worth it, so the cached history stays the same between batches", () => {
    const history = [
      ...step("r1", "read_file", { path: "a.ts" }, 1_200),
      ...step("e1", "edit_file", { path: "a.ts" }, 100),
      ...step("end", "list_files", {}, 50),
    ];
    // 300 tokens could go, under the 500-token minimum: nothing changes, not even a new set.
    expect(planToolOutputPrune(history, none, small)).toBe(none);
  });

  it("keeps everything already cleared and only adds to it", () => {
    const history = [
      ...step("old", "run_command", { command: "npm test" }, 12_000),
      ...step("new", "search", { query: "y" }, 2_000),
    ];
    const first = planToolOutputPrune(history, none, small);
    const longer = [...history, ...step("newer", "search", { query: "z" }, 2_000)];
    const second = planToolOutputPrune(longer, first, small);
    expect([...second]).toEqual(["old"]);
  });
});

describe("what is sent in its place", () => {
  it("swaps the cleared result for a short note and leaves the history itself alone", () => {
    const history = [...step("r1", "read_file", { path: "a.ts" }, 5_000), ...step("r2", "read_file", { path: "b.ts" }, 5_000)];
    const sent = applyToolOutputPrune(history, new Set(["r1"]));
    expect(sent[1]!.content[0]).toEqual({ type: "tool-result", toolCallId: "r1", content: PRUNED_NOTE, isError: false });
    expect(sent[3]).toBe(history[3]);
    expect((history[1]!.content[0] as { content: string }).content).toHaveLength(5_000);
  });
});
