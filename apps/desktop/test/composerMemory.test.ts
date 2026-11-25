import { describe, expect, it } from "vitest";
import {
  DRAFTS_KEY,
  MAX_STASHES,
  PASTE_ATTACH_BYTES,
  STASH_KEY,
  addToStash,
  draftKey,
  forgetSentDraft,
  pasteBecomesAttachment,
  pasteName,
  readDraft,
  readStash,
  stashLabel,
  takeFromStash,
  writeDraft,
  type KeyValueStore,
} from "../src/renderer/ai/composerMemory.ts";
import {
  GOAL_CONTINUE_LEAD,
  afterGoalTurn,
  goalStartPrompt,
  goalSummary,
  judgeReply,
  newGoal,
  parseGoalCommand,
  pauseGoal,
  resumeGoal,
} from "../src/renderer/ai/goalMode.ts";
import { parseSlashCommand } from "../src/shared/slashCommands.ts";

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } };
}

describe("drafts", () => {
  it("keeps one draft per conversation and gives it back", () => {
    const store = memoryStore();
    writeDraft(store, draftKey("a"), "fix the login", 1_000);
    writeDraft(store, draftKey(null), "a new idea", 1_000);
    expect(readDraft(store, "a", 2_000)).toBe("fix the login");
    expect(readDraft(store, "new", 2_000)).toBe("a new idea");
    expect(readDraft(store, "b", 2_000)).toBeNull();
  });

  it("forgets a draft emptied, expired, or sent from anywhere", () => {
    const store = memoryStore();
    writeDraft(store, "a", "one", 0);
    writeDraft(store, "a", "   ", 0);
    expect(readDraft(store, "a", 1)).toBeNull();
    writeDraft(store, "b", "old", 0);
    expect(readDraft(store, "b", 15 * 86_400_000)).toBeNull();
    writeDraft(store, "c", "same words", 10);
    writeDraft(store, "d", "same words", 10);
    forgetSentDraft(store, "same words ");
    expect(readDraft(store, "c", 11)).toBeNull();
    expect(readDraft(store, "d", 11)).toBeNull();
  });

  it("survives a corrupt or blocked store", () => {
    const store = memoryStore();
    store.data.set(DRAFTS_KEY, "{broken");
    expect(readDraft(store, "a")).toBeNull();
    const blocked: KeyValueStore = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    expect(() => writeDraft(blocked, "a", "text")).not.toThrow();
  });
});

describe("stash", () => {
  it("stashes newest first and takes one back out", () => {
    const store = memoryStore();
    addToStash(store, { text: "first", attachments: [] }, 1, "s1");
    addToStash(store, { text: "second", attachments: [{ name: "a.txt", kind: "text", mediaType: "text/plain", data: "hi" }] }, 2, "s2");
    expect(readStash(store).map((item) => item.id)).toEqual(["s2", "s1"]);
    const taken = takeFromStash(store, "s2");
    expect(taken?.attachments).toHaveLength(1);
    expect(readStash(store).map((item) => item.id)).toEqual(["s1"]);
    expect(takeFromStash(store, "missing")).toBeNull();
  });

  it("ignores an empty prompt and keeps at most the newest twenty", () => {
    const store = memoryStore();
    expect(addToStash(store, { text: "  ", attachments: [] }, 1, "x").stash).toEqual([]);
    for (let index = 0; index < MAX_STASHES + 5; index += 1) addToStash(store, { text: `p${String(index)}`, attachments: [] }, index, `s${String(index)}`);
    const stash = readStash(store);
    expect(stash).toHaveLength(MAX_STASHES);
    expect(stash[0]?.text).toBe(`p${String(MAX_STASHES + 4)}`);
  });

  it("keeps the text but drops huge attachments", () => {
    const store = memoryStore();
    const result = addToStash(store, { text: "with a big image", attachments: [{ name: "big.png", kind: "image", mediaType: "image/png", data: "x".repeat(2_000_000) }] }, 1, "s1");
    expect(result.droppedAttachments).toBe(true);
    expect(readStash(store)[0]).toMatchObject({ text: "with a big image", attachments: [] });
    expect(store.data.get(STASH_KEY)?.length).toBeLessThan(1_000);
  });

  it("labels a stash by its first line, age and files", () => {
    expect(stashLabel({ id: "s", text: "Fix the redirect\nmore", at: 0, attachments: [{ name: "a", kind: "text", mediaType: "text/plain", data: "" }] }, 5 * 60_000)).toBe("Fix the redirect · 5 min ago · 1 file");
  });
});

describe("big pastes", () => {
  it("turns 32 KiB or more into an attachment unless asked to keep it inline", () => {
    const big = "x".repeat(PASTE_ATTACH_BYTES);
    expect(pasteBecomesAttachment(big, false)).toBe(true);
    expect(pasteBecomesAttachment(big, true)).toBe(false);
    expect(pasteBecomesAttachment("x".repeat(PASTE_ATTACH_BYTES - 1), false)).toBe(false);
    // Multi-byte text reaches the threshold in fewer characters.
    expect(pasteBecomesAttachment("é".repeat(PASTE_ATTACH_BYTES / 2), false)).toBe(true);
  });

  it("names a paste after what it looks like", () => {
    expect(pasteName('{"a":1}', 1)).toBe("pasted-1.json");
    expect(pasteName("Traceback (most recent call last):\n  File", 2)).toBe("pasted-2.log");
    expect(pasteName("diff --git a/x b/x\n", 3)).toBe("pasted-3.diff");
    expect(pasteName("<!doctype html><html>", 4)).toBe("pasted-4.html");
    expect(pasteName("just words", 5)).toBe("pasted-5.txt");
  });
});

describe("/goal", () => {
  it("reads the words after /goal", () => {
    expect(parseGoalCommand("")).toEqual({ kind: "show" });
    expect(parseGoalCommand("clear")).toEqual({ kind: "clear" });
    expect(parseGoalCommand("pause")).toEqual({ kind: "pause" });
    expect(parseGoalCommand("Resume")).toEqual({ kind: "resume" });
    expect(parseGoalCommand("all tests in src/api pass")).toEqual({ kind: "set", goal: "all tests in src/api pass" });
  });

  it("is a slash command that takes words", () => {
    expect(parseSlashCommand("/goal tests pass")).toMatchObject({ command: { id: "goal", kind: "action" }, rest: "tests pass" });
    expect(parseSlashCommand("/btw why sqlite?")).toMatchObject({ command: { id: "btw" }, rest: "why sqlite?" });
    expect(parseSlashCommand("/stash")).toMatchObject({ command: { id: "stash" } });
    expect(parseSlashCommand("/usage")).toMatchObject({ command: { id: "usage" } });
  });

  it("asks for a closing line, and only a closing line counts", () => {
    expect(goalStartPrompt("tests pass")).toContain("GOAL MET");
    expect(judgeReply("All green.\n\n**GOAL MET**")).toEqual({ kind: "met" });
    expect(judgeReply("Stuck.\nGOAL BLOCKED: needs the staging password")).toEqual({ kind: "blocked", reason: "needs the staging password" });
    expect(judgeReply("I will say GOAL MET when done.\nStill working on the parser.")).toEqual({ kind: "continue" });
  });

  it("continues after progress, stops when met or blocked, and lets a queued message go first", () => {
    const goal = newGoal("tests pass", null, 3);
    const first = afterGoalTurn(goal, "Fixed two of five.", { queued: false, sessionId: "s1" });
    expect(first.state).toMatchObject({ sessionId: "s1", turns: 1, status: "working" });
    expect(first.send?.startsWith(GOAL_CONTINUE_LEAD)).toBe(true);
    expect(afterGoalTurn(first.state, "Done.\nGOAL MET", { queued: false, sessionId: "s1" }).state.status).toBe("met");
    expect(afterGoalTurn(first.state, "progress", { queued: true, sessionId: "s1" }).send).toBeNull();
    expect(afterGoalTurn(first.state, "GOAL BLOCKED: need a key", { queued: false, sessionId: "s1" }).state).toMatchObject({ status: "blocked", reason: "need a key" });
  });

  it("stops at the cap instead of running all night", () => {
    let state = newGoal("forever", "s", 2);
    for (let index = 0; index < 2; index += 1) state = afterGoalTurn(state, "more", { queued: false, sessionId: "s" }).state;
    const last = afterGoalTurn(state, "more", { queued: false, sessionId: "s" });
    expect(last.send).toBeNull();
    expect(last.state.status).toBe("limit");
    expect(goalSummary(last.state)).toBe("Stopped after 2 automatic turns");
  });

  it("pauses when the person steps in and resumes with a fresh allowance", () => {
    const working = { ...newGoal("x", "s"), turns: 7 };
    const paused = pauseGoal(working, "you stopped the turn");
    expect(paused).toMatchObject({ status: "paused", reason: "you stopped the turn" });
    expect(afterGoalTurn(paused, "progress", { queued: false, sessionId: "s" }).send).toBeNull();
    const resumed = resumeGoal(paused);
    expect(resumed).toMatchObject({ status: "working", turns: 0 });
    expect("reason" in resumed).toBe(false);
    expect(resumeGoal({ ...working, status: "met" }).status).toBe("met");
  });
});
