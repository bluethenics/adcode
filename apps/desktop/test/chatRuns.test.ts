import { describe, expect, it } from "vitest";
import { createChatRuns, KEEP_GOING_LIMIT, MAX_PARALLEL_CHATS, shouldKeepGoing } from "../src/main/chatRuns.ts";

describe("chats working at once", () => {
  it("lets several conversations work, each once", () => {
    const runs = createChatRuns({ maxParallel: () => 2 });
    expect(runs.begin("a", "Landing page", 1)).toEqual({ ok: true });
    expect(runs.begin("b", "Snake game", 2)).toEqual({ ok: true });
    // The same conversation cannot run two turns at once: its history is one thread.
    expect(runs.begin("a", "Landing page", 3)).toEqual({ ok: false, reason: "This conversation is already working." });
    expect(runs.isRunning("a")).toBe(true);
    expect(runs.list().map((run) => run.sessionId)).toEqual(["a", "b"]);
  });

  it("caps how many work at once, and says how to make room", () => {
    const runs = createChatRuns({ maxParallel: () => 2 });
    runs.begin("a", "One", 1);
    runs.begin("b", "Two", 2);
    const refused = runs.begin("c", "Three", 3);
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.reason).toBe("2 chats are already working. Stop one, or wait for one to finish.");
    const single = createChatRuns({ maxParallel: () => 1 });
    single.begin("x", "Fix the login page", 0);
    const one = single.begin("y", "Other", 0);
    expect(!one.ok && one.reason).toBe("Another chat (\"Fix the login page\") is still working. Stop it, or wait for it to finish, then send again.");
    runs.end("a");
    expect(runs.begin("c", "Three", 4)).toEqual({ ok: true });
    expect(MAX_PARALLEL_CHATS).toBeGreaterThanOrEqual(3);
  });

  it("forgets a finished run, including what it showed", () => {
    const runs = createChatRuns({ maxParallel: () => 3 });
    runs.begin("a", "One", 1);
    runs.record("a", { kind: "text", text: "Hello" });
    runs.end("a");
    expect(runs.isRunning("a")).toBe(false);
    expect(runs.replay("a")).toEqual([]);
    expect(runs.list()).toEqual([]);
  });
});

describe("replaying a turn to a chat opened while it works", () => {
  it("keeps what the timeline draws, with streamed pieces joined", () => {
    const runs = createChatRuns({ maxParallel: () => 3 });
    runs.begin("a", "One", 1);
    runs.record("a", { kind: "thinking", text: "Plan" });
    runs.record("a", { kind: "thinking", text: "ning the page" });
    runs.record("a", { kind: "text", text: "I will " });
    runs.record("a", { kind: "text", text: "write it." });
    runs.record("a", { kind: "tool-call", call: { id: "t1", name: "edit_file", input: { path: "index.html" } } });
    // A file being written streams as pieces; the replay holds what was written so far.
    runs.record("a", { kind: "tool-draft", id: "t1", edit: 0, path: null, append: "<!doctype" });
    runs.record("a", { kind: "tool-draft", id: "t1", edit: 0, path: "index.html", append: " html>" });
    runs.record("a", { kind: "tool-result", toolCallId: "t1", name: "edit_file", isError: false, content: "ok" });
    // Usage and context readings are for meters, not for the transcript.
    runs.record("a", { kind: "usage", inputTokens: 10, outputTokens: 5 });
    runs.record("a", { kind: "context", tokens: 1000, contextWindow: 128000 });
    expect(runs.replay("a")).toEqual([
      { kind: "thinking", text: "Planning the page" },
      { kind: "text", text: "I will write it." },
      { kind: "tool-call", call: { id: "t1", name: "edit_file", input: { path: "index.html" } } },
      { kind: "tool-draft", id: "t1", edit: 0, path: "index.html", append: "<!doctype html>" },
      { kind: "tool-result", toolCallId: "t1", name: "edit_file", isError: false, content: "ok" },
    ]);
  });

  it("stays bounded on a very long turn", () => {
    const runs = createChatRuns({ maxParallel: () => 3, maxEvents: 4 });
    runs.begin("a", "One", 1);
    for (let index = 0; index < 10; index += 1) {
      runs.record("a", { kind: "tool-call", call: { id: `t${String(index)}`, name: "read_file", input: {} } });
    }
    const kept = runs.replay("a");
    expect(kept).toHaveLength(4);
    // The newest are kept: the person opening the chat wants to see where it is now.
    expect(kept.at(-1)).toEqual({ kind: "tool-call", call: { id: "t9", name: "read_file", input: {} } });
  });

  it("counts the times a run kept going by itself", () => {
    const runs = createChatRuns({ maxParallel: () => 3 });
    runs.begin("a", "One", 1);
    expect(runs.noteContinued("a")).toBe(1);
    expect(runs.noteContinued("a")).toBe(2);
    expect(runs.list()[0]?.continued).toBe(2);
  });
});

describe("keeping going until done", () => {
  it("continues a turn stopped by its step limit, up to a limit, only when asked to", () => {
    // The agent's own words (packages/ai/src/agent.ts) when a request runs out of steps.
    const stopped = "The assistant reached its 50-step limit before finishing. Review the work so far and continue with a narrower request.";
    expect(shouldKeepGoing({ detail: stopped, keepGoing: true, continued: 0 })).toBe(true);
    expect(shouldKeepGoing({ detail: stopped, keepGoing: true, continued: KEEP_GOING_LIMIT - 1 })).toBe(true);
    expect(shouldKeepGoing({ detail: stopped, keepGoing: true, continued: KEEP_GOING_LIMIT })).toBe(false);
    expect(shouldKeepGoing({ detail: stopped, keepGoing: false, continued: 0 })).toBe(false);
    // Any other failure is for the person to see, not to retry blindly.
    expect(shouldKeepGoing({ detail: "401 Unauthorized", keepGoing: true, continued: 0 })).toBe(false);
    // Long work is the point: well past the old five continuations.
    expect(KEEP_GOING_LIMIT).toBeGreaterThanOrEqual(20);
  });
});
