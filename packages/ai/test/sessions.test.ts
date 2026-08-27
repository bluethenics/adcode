import { describe, expect, it } from "vitest";
import {
  pruneSessions,
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
});

describe("validateSession", () => {
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
