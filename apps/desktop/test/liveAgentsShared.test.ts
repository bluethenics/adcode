import { describe, expect, it } from "vitest";
import { createLiveBatcher, liveEventFrom, toolCallSummary, type LiveEventView } from "../src/shared/liveAgents.ts";
import { isCheckCommand } from "../src/shared/runEvidence.ts";

describe("toolCallSummary", () => {
  it("counts a whole file's lines as added", () => {
    expect(toolCallSummary("propose_edit", { path: "a.ts", contents: "one\ntwo\nthree" })).toEqual({ path: "a.ts", command: null, added: 3, removed: 0 });
  });

  it("counts every replacement's new and old lines", () => {
    const input = { path: "b.ts", edits: [{ old_string: "x", new_string: "y\nz" }, { old_string: "p\nq\nr", new_string: "" }] };
    expect(toolCallSummary("edit_file", input)).toEqual({ path: "b.ts", command: null, added: 2, removed: 4 });
  });

  it("counts a single top-level replacement", () => {
    expect(toolCallSummary("edit_file", { path: "c.ts", old_string: "a", new_string: "b\nc" })).toEqual({ path: "c.ts", command: null, added: 2, removed: 1 });
  });

  it("keeps a command, bounded", () => {
    const summary = toolCallSummary("run_command", { command: `npm test ${"x".repeat(400)}` });
    expect(summary.command?.startsWith("npm test")).toBe(true);
    expect(summary.command?.length).toBeLessThanOrEqual(200);
    expect(summary.path).toBeNull();
  });
});

describe("liveEventFrom", () => {
  it("maps a tool call to its summary, never its contents", () => {
    const event = liveEventFrom({ kind: "tool-call", call: { id: "c1", name: "propose_edit", input: { path: "a.ts", contents: "secret\nline" } } });
    expect(event).toEqual({ kind: "tool-call", id: "c1", name: "propose_edit", path: "a.ts", command: null, added: 2, removed: 0 });
  });

  it("keeps only the tail of a tool's output", () => {
    const event = liveEventFrom({ kind: "tool-result", toolCallId: "c1", name: "run_command", content: `${"a".repeat(9000)}END`, isError: false });
    expect(event?.kind).toBe("tool-result");
    if (event?.kind === "tool-result") {
      expect(event.output.endsWith("END")).toBe(true);
      expect(event.output.length).toBeLessThanOrEqual(4000);
      expect(event.ok).toBe(true);
    }
  });

  it("passes drafts through and drops events a window does not show", () => {
    expect(liveEventFrom({ kind: "tool-draft", id: "c1", name: "edit_file", path: null, edit: 1, append: "x" })).toEqual({ kind: "tool-draft", id: "c1", name: "edit_file", path: null, edit: 1, append: "x" });
    expect(liveEventFrom({ kind: "thinking", text: "hmm" })).toEqual({ kind: "thinking" });
    expect(liveEventFrom({ kind: "status", text: "waiting" })).toBeNull();
    expect(liveEventFrom({ kind: "context", tokens: 1, contextWindow: 2 })).toBeNull();
  });
});

describe("createLiveBatcher", () => {
  function harness() {
    const sent: LiveEventView[] = [];
    let timer: (() => void) | null = null;
    const batcher = createLiveBatcher<LiveEventView>((event) => sent.push(event), (fn) => { timer = fn; });
    return { sent, batcher, fire: () => timer?.() };
  }
  const draft = (append: string, edit = 0, path: string | null = "a.ts"): LiveEventView => ({ kind: "tool-draft", id: "c1", name: "propose_edit", path, edit, append });

  it("merges consecutive drafts of the same edit until the timer fires", () => {
    const { sent, batcher, fire } = harness();
    batcher.push(draft("ab"));
    batcher.push(draft("cd"));
    expect(sent).toEqual([]);
    fire();
    expect(sent).toEqual([draft("abcd")]);
  });

  it("keeps different edits apart", () => {
    const { sent, batcher, fire } = harness();
    batcher.push(draft("a", 0));
    batcher.push(draft("b", 1));
    fire();
    expect(sent).toEqual([draft("a", 0), draft("b", 1)]);
  });

  it("flushes drafts before any other event, so order holds", () => {
    const { sent, batcher } = harness();
    batcher.push(draft("a"));
    batcher.push({ kind: "thinking" });
    expect(sent).toEqual([draft("a"), { kind: "thinking" }]);
  });

  it("keeps a path that only a later draft carried", () => {
    const { sent, batcher, fire } = harness();
    batcher.push(draft("a", 0, null));
    batcher.push(draft("", 0, "late.ts"));
    fire();
    expect(sent).toEqual([draft("a", 0, "late.ts")]);
  });
});

describe("isCheckCommand", () => {
  it("knows checks from other commands", () => {
    expect(isCheckCommand("npm test")).toBe(true);
    expect(isCheckCommand("npx tsc --noEmit")).toBe(true);
    expect(isCheckCommand("ls -la")).toBe(false);
  });
});
