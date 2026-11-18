import { describe, expect, it } from "vitest";
import { aiRequest, mergeTeamMessages, teamChatId, type SharedMessage } from "../src/shared/teamChat.ts";
import { restoreHistory } from "@adcode/ai";

const names = (uid: string) => (uid === "me" ? "Sinan" : uid === "sam" ? "Sam" : "Someone");
const msg = (seq: number, authorId: string, kind: SharedMessage["kind"], text: string): SharedMessage => ({ seq, authorId, authorName: names(authorId), kind, text, at: seq * 1000 });

describe("team chats", () => {
  it("adds teammates' messages with their names and the AI's answers, in order", () => {
    const { messages, added, fromOthers } = mergeTeamMessages([], [msg(2, "sam", "assistant", "Done - tests pass."), msg(1, "sam", "member", "@ai fix the build")], "me", names);
    expect(messages.map((m) => [m.role, m.text, m.author?.name, m.seq])).toEqual([["user", "@ai fix the build", "Sam", 1], ["assistant", "Done - tests pass.", "Sam", 2]]);
    expect(added).toBe(2);
    expect(fromOthers).toBe(2);
  });

  it("recognises what this computer already wrote instead of adding it twice", () => {
    const local = [
      { role: "user" as const, text: "add a footer\n[Attached: a.png]", at: 1 },
      { role: "assistant" as const, text: "Added the footer in src/App.tsx.", at: 2 },
    ];
    const { messages, added } = mergeTeamMessages(local, [msg(5, "me", "member", "add a footer"), msg(6, "me", "assistant", "Added the footer in src/App.tsx."), msg(7, "sam", "member", "nice")], "me", names);
    expect(messages).toHaveLength(3);
    expect(messages[0]).toMatchObject({ seq: 5, author: { self: true } });
    expect(messages[1]).toMatchObject({ seq: 6 });
    expect(messages[2]).toMatchObject({ text: "nice", author: { name: "Sam", self: false } });
    expect(added).toBe(1);
    // Merging the same page again changes nothing.
    expect(mergeTeamMessages(messages, [msg(5, "me", "member", "add a footer"), msg(7, "sam", "member", "nice")], "me", names).added).toBe(0);
  });

  it("leaves service error notices out", () => {
    expect(mergeTeamMessages([], [msg(1, "sam", "error", "The assistant could not finish.")], "me", names).messages).toEqual([]);
  });

  it("asks the AI when the switch is on or the message starts with @ai", () => {
    expect(aiRequest("hello team", false)).toEqual({ ask: false, text: "hello team" });
    expect(aiRequest("@ai, add tests", false)).toEqual({ ask: true, text: "add tests" });
    expect(aiRequest("add tests", true)).toEqual({ ask: true, text: "add tests" });
  });

  it("gives the model each person's name in a team chat", () => {
    const history = restoreHistory({ id: "team-s1", title: "t", renamed: true, createdAt: 0, updatedAt: 0, messages: [
      { role: "user", text: "make it blue", at: 1, author: { id: "sam", name: "Sam", self: false } },
      { role: "user", text: "and bigger", at: 2, author: { id: "me", name: "Sinan", self: true } },
    ] });
    expect(JSON.stringify(history)).toContain("Sam: make it blue");
    expect(JSON.stringify(history)).toContain("Sinan: and bigger");
    expect(teamChatId("abc-123")).toBe("team-abc-123");
  });
});
