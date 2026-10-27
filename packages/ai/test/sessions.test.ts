import { describe, expect, it } from "vitest";
import {
  SUMMARY_OPEN,
  restoreHistory,
  summaryCoverage,
  withSummary,
  pruneSessions,
  reorderPinned,
  searchSessions,
  sortSessions,
  titleFor,
  validateSession,
  withMessage,
  type ChatMessage,
  type ChatSession,
} from "@adcode/ai";

const message = (role: "user" | "assistant", text: string, at = 1): ChatMessage => ({
  role,
  text,
  at,
});

const session = (id: string, updatedAt: number, messages: ChatMessage[] = []): ChatSession => ({
  id,
  title: titleFor(messages),
  renamed: false,
  createdAt: 0,
  updatedAt,
  messages,
});

describe("titleFor", () => {
  it("uses the first thing asked", () => {
    expect(titleFor([message("user", "Why is the ledger append-only?")])).toBe(
      "Why is the ledger append-only?",
    );
  });

  it("leaves the attachment bookkeeping out, unless files were all that was sent", () => {
    expect(titleFor([message("user", "/review focus on auth\n[Attached: uncommitted-changes.diff]")])).toBe("/review focus on auth");
    expect(titleFor([message("user", "\n[Attached: mockup.png, notes.md]")])).toBe("mockup.png, notes.md");
    expect(titleFor([message("user", "Explain [Attached: x] in the README")])).toBe("Explain [Attached: x] in the README");
  });

  it("ignores the assistant's opening", () => {
    const messages = [message("assistant", "Hello!"), message("user", "Fix the build")];
    expect(titleFor(messages)).toBe("Fix the build");
  });

  it("collapses whitespace", () => {
    expect(titleFor([message("user", "  two\n\nlines  ")])).toBe("two lines");
  });

  it("cuts a long question at a word", () => {
    const long = titleFor([message("user", "a".repeat(10) + " " + "b".repeat(60))]);
    expect(long.endsWith("…")).toBe(true);
    expect(long.length).toBeLessThanOrEqual(50);
  });

  it("hard-cuts a single very long word", () => {
    // No good break exists, and pretending otherwise would return an empty title.
    const long = titleFor([message("user", "x".repeat(200))]);
    expect(long.length).toBeLessThanOrEqual(50);
    expect(long.startsWith("xxx")).toBe(true);
  });

  it("names an empty conversation", () => {
    expect(titleFor([])).toBe("New conversation");
    expect(titleFor([message("user", "   ")])).toBe("New conversation");
  });
});

describe("sortSessions", () => {
  it("puts the newest first", () => {
    const sorted = sortSessions([session("a", 1), session("b", 9), session("c", 5)]);
    expect(sorted.map((one) => one.id)).toEqual(["b", "c", "a"]);
  });

  /* A pin is "keep this where I can see it" - later chatter anywhere must not push it down. */
  it("holds pinned conversations above everything, newest pin first", () => {
    const all = [
      { ...session("stale-pinned", 1), pinnedAt: 50 },
      session("newest", 99),
      { ...session("fresh-pinned", 2), pinnedAt: 70 },
      session("middle", 50),
    ];
    expect(sortSessions(all).map((one) => one.id)).toEqual([
      "fresh-pinned",
      "stale-pinned",
      "newest",
      "middle",
    ]);
  });

  it("recency still decides within each group", () => {
    const all = [
      { ...session("pinned-old", 1), pinnedAt: 40 },
      { ...session("pinned-new", 2), pinnedAt: 30 },
    ];
    // The pins are ordered by pin time (40 above 30), not by what the transcript says.
    expect(sortSessions(all).map((one) => one.id)).toEqual(["pinned-old", "pinned-new"]);
  });
});

describe("reorderPinned", () => {
  const pinned = (id: string, at: number): ChatSession => ({ ...session(id, 1), pinnedAt: at });

  it("writes the dragged order as pin timestamps, so the list keeps agreeing", () => {
    const all = [pinned("a", 90), pinned("b", 70), pinned("c", 50), session("free", 40)];
    const reordered = reorderPinned(all, ["c", "a", "b"]);
    // The first name in the order gets the newest pin: the array keeps its shape, but
    // c now carries the top timestamp, so the list reads c, a, b.
    expect(reordered.map((one) => one.id)).toEqual(["a", "b", "c", "free"]);
    expect(reordered.map((one) => one.pinnedAt)).toEqual([89, 88, 90, undefined]);
    expect(sortSessions(reordered).map((one) => one.id)).toEqual(["c", "a", "b", "free"]);
    // The unpinned conversation is left exactly as it was.
    expect(reordered.find((one) => one.id === "free")).toBe(all[3]);
  });

  it("refuses an order that does not name every pin exactly once", () => {
    const all = [pinned("a", 90), pinned("b", 70), session("free", 40)];
    expect(() => reorderPinned(all, ["a"])).toThrow(/exactly once/);
    expect(() => reorderPinned(all, ["a", "a"])).toThrow(/exactly once/);
    expect(() => reorderPinned(all, ["a", "b", "free"])).toThrow(/exactly once/);
    expect(() => reorderPinned(all, [])).toThrow(/exactly once/);
  });
});

describe("searchSessions", () => {
  const all = [
    session("a", 2, [message("user", "how do I run the migration")]),
    session("b", 1, [message("user", "styling"), message("assistant", "use flexbox")]),
  ];

  it("returns everything, newest first, for an empty query", () => {
    expect(searchSessions(all, "").map((one) => one.id)).toEqual(["a", "b"]);
  });

  /*
   * Searching inside the conversation, not just the title: people remember a phrase from
   * the middle of the discussion, not what the first line happened to be.
   */
  it("finds a phrase from inside a conversation", () => {
    expect(searchSessions(all, "flexbox").map((one) => one.id)).toEqual(["b"]);
  });

  it("finds one by title", () => {
    expect(searchSessions(all, "migration").map((one) => one.id)).toEqual(["a"]);
  });

  it("finds nothing for a word nobody used", () => {
    expect(searchSessions(all, "zzz")).toEqual([]);
  });
});

describe("pruneSessions", () => {
  it("keeps the newest up to the limit", () => {
    const all = [
      session("a", 1, [message("user", "x")]),
      session("b", 3, [message("user", "y")]),
      session("c", 2, [message("user", "z")]),
    ];
    expect(pruneSessions(all, 2).map((one) => one.id)).toEqual(["b", "c"]);
  });

  /* A session opened and abandoned is not history, it is a stray file. */
  it("drops empty conversations first", () => {
    const all = [session("empty", 99), session("real", 1, [message("user", "x")])];
    expect(pruneSessions(all, 5).map((one) => one.id)).toEqual(["real"]);
  });

  /* Pruning cuts from the bottom of the sorted list; a pin must be the last thing cut. */
  it("cuts an unpinned conversation before a pinned one", () => {
    const all = [
      session("recent", 90, [message("user", "today's work")]),
      { ...session("pinned", 5, [message("user", "the important one")]), pinnedAt: 7 },
    ];
    expect(pruneSessions(all, 1).map((one) => one.id)).toEqual(["pinned"]);
  });
});

describe("validateSession", () => {
  it("keeps owned-response feedback references across restore without adding them to AI context", () => {
    const id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const restored = validateSession({ id:"report-feedback",messages:[{role:"assistant",text:"Answer",at:1,includedRequestId:id},{role:"assistant",text:"Old answer",at:2,includedRequestId:"bad"}] })!;
    expect(restored.messages[0]!.includedRequestId).toBe(id);
    expect(restored.messages[1]!.includedRequestId).toBeUndefined();
    expect(JSON.stringify(restoreHistory(restored))).not.toContain(id);
  });
  it("reads a well-formed session", () => {
    const read = validateSession({
      id: "s1",
      title: "Kept",
      renamed: true,
      createdAt: 1,
      updatedAt: 2,
      messages: [{ role: "user", text: "hi", at: 3 }],
    });

    expect(read?.title).toBe("Kept");
    expect(read?.renamed).toBe(true);
    expect(read?.messages).toHaveLength(1);
  });

  it("refuses a session with no id", () => {
    expect(validateSession({ messages: [] })).toBeNull();
    expect(validateSession(null)).toBeNull();
  });

  /* A session file is JSON the user could have edited. A bad field costs the field. */
  it("drops malformed messages rather than the session", () => {
    const read = validateSession({
      id: "s1",
      messages: [{ role: "user", text: "keep" }, { role: "wizard", text: "drop" }, 7, null],
    });

    expect(read?.messages.map((one) => one.text)).toEqual(["keep"]);
  });

  it("keeps a pin read back from disk and costs only a malformed one", () => {
    const pinned = validateSession({ id: "p", pinnedAt: 1_700_000_000_000, messages: [] });
    expect(pinned?.pinnedAt).toBe(1_700_000_000_000);

    const unpinned = validateSession({ id: "q", pinnedAt: "yesterday", messages: [] });
    expect(unpinned?.pinnedAt).toBeUndefined();
    expect(unpinned?.id).toBe("q");

    const zeroed = validateSession({ id: "r", pinnedAt: 0, messages: [] });
    expect(zeroed?.pinnedAt).toBeUndefined();
  });

  it("titles a session that has none", () => {
    const read = validateSession({ id: "s1", messages: [{ role: "user", text: "Ask me" }] });
    expect(read?.title).toBe("Ask me");
  });
});

describe("withMessage", () => {
  it("appends and retitles", () => {
    const started = session("s", 0);
    const next = withMessage(started, message("user", "First question", 10));

    expect(next.messages).toHaveLength(1);
    expect(next.title).toBe("First question");
    expect(next.updatedAt).toBe(10);
  });

  it("does not overwrite a title the user chose", () => {
    const named: ChatSession = { ...session("s", 0), title: "My name", renamed: true };
    expect(withMessage(named, message("user", "Something else", 5)).title).toBe("My name");
  });
});

describe("a conversation's summary", () => {
  const five = [message("user", "u1"), message("assistant", "a1"), message("user", "u2"), message("assistant", "a2"), message("user", "u3")];

  it("loads a conversation saved before summaries existed", () => {
    expect(validateSession({ id: "old", messages: [{ role: "user", text: "hi", at: 1 }] })?.summary).toBeNull();
  });

  it("keeps a well-formed summary", () => {
    const read = validateSession({ id: "s", messages: five, summary: { text: "what happened", coversUntil: 2, at: 9 } });
    expect(read?.summary).toEqual({ text: "what happened", coversUntil: 2, at: 9 });
  });

  it("drops a malformed summary, not the conversation", () => {
    for (const summary of [
      { text: "", coversUntil: 1, at: 1 },
      { text: "x", coversUntil: -1, at: 1 },
      { text: "x", coversUntil: 99, at: 1 },
      { text: "x", coversUntil: 1.5, at: 1 },
      { text: 7, coversUntil: 1, at: 1 },
      "nonsense",
    ]) {
      const read = validateSession({ id: "s", messages: five, summary });
      expect(read?.messages).toHaveLength(5);
      expect(read?.summary).toBeNull();
    }
  });

  it("covers everything before the k-th newest user message", () => {
    expect(summaryCoverage(five, 1)).toBe(4);
    expect(summaryCoverage(five, 2)).toBe(2);
    expect(summaryCoverage(five, 9)).toBe(0);
    expect(summaryCoverage(five, 0)).toBe(5);
  });

  it("records a summary on the conversation", () => {
    const summarised = withSummary(session("s", 1, five), { text: "sum", coversUntil: 2, at: 5 });
    expect(summarised.summary).toEqual({ text: "sum", coversUntil: 2, at: 5 });
    expect(summarised.messages).toHaveLength(5);
  });

  it("rebuilds what the model sees: the summary, then the messages after it", () => {
    const history = restoreHistory({ ...session("s", 1, five), summary: { text: "earlier stuff", coversUntil: 2, at: 1 } });
    expect(history.map((one) => one.role)).toEqual(["user", "assistant", "user"]);
    const first = JSON.stringify(history[0]);
    expect(first).toContain(SUMMARY_OPEN);
    expect(first).toContain("earlier stuff");
    expect(first).toContain("u2");
    expect(JSON.stringify(history)).not.toContain("u1");
  });

  it("rebuilds the whole conversation when there is no summary", () => {
    expect(restoreHistory(session("s", 1, five)).map((one) => one.role)).toEqual(["user", "assistant", "user", "assistant", "user"]);
  });

  it("merges messages from the same side and always starts with the user", () => {
    const odd = [message("assistant", "hello"), message("user", "a"), message("user", "b"), message("assistant", "c")];
    const history = restoreHistory(session("s", 1, odd));
    expect(history.map((one) => one.role)).toEqual(["user", "assistant"]);
    expect(JSON.stringify(history[0])).toContain("a");
    expect(JSON.stringify(history[0])).toContain("b");
  });

  it("rebuilds nothing from an empty conversation", () => {
    expect(restoreHistory(session("s", 1))).toEqual([]);
  });
});
