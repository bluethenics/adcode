import { describe, expect, it } from "vitest";
import { parseChatSort, parsePins, sortChats, splitPinned, togglePin, MAX_PINS } from "../src/renderer/ai/chatSort.ts";

const chat = (id: string, title: string, createdAt: number, updatedAt: number, messageCount: number) => ({ id, title, createdAt, updatedAt, messageCount });
const chats = [
  chat("a", "Fix login", 100, 900, 4),
  chat("b", "add tests", 300, 500, 30),
  chat("c", "Chat 10", 200, 700, 2),
  chat("d", "Chat 9", 50, 600, 12),
];
const ids = (list: readonly { id: string }[]) => list.map((one) => one.id);

describe("conversation sorting", () => {
  it("orders by activity, creation, age, name and length", () => {
    expect(ids(sortChats(chats, "recent"))).toEqual(["a", "c", "d", "b"]);
    expect(ids(sortChats(chats, "created"))).toEqual(["b", "c", "a", "d"]);
    expect(ids(sortChats(chats, "oldest"))).toEqual(["d", "a", "c", "b"]);
    // Case-insensitive, and Chat 9 before Chat 10.
    expect(ids(sortChats(chats, "name"))).toEqual(["b", "d", "c", "a"]);
    expect(ids(sortChats(chats, "longest"))).toEqual(["b", "d", "a", "c"]);
  });

  it("lets a working fork lift its parent under Recent, and never mutates the input", () => {
    const before = ids(chats);
    expect(ids(sortChats(chats, "recent", new Map([["b", 1_000]])))).toEqual(["b", "a", "c", "d"]);
    expect(ids(chats)).toEqual(before);
  });

  it("falls back to Recent for an unknown stored choice", () => {
    expect(parseChatSort("name")).toBe("name");
    expect(parseChatSort("bogus")).toBe("recent");
    expect(parseChatSort(null)).toBe("recent");
  });
});

describe("pinned conversations", () => {
  it("puts the newest pin first and unpins on a second toggle", () => {
    expect(togglePin(["a"], "c")).toEqual(["c", "a"]);
    expect(togglePin(["c", "a"], "c")).toEqual(["a"]);
  });

  it("splits pinned chats out in pin order, skipping deleted ones", () => {
    const { pinned, rest } = splitPinned(chats, ["d", "gone", "a"]);
    expect(ids(pinned)).toEqual(["d", "a"]);
    expect(ids(rest)).toEqual(["b", "c"]);
  });

  it("reads only a sane stored list", () => {
    expect(parsePins('["a","a","b",3]')).toEqual(["a", "b"]);
    expect(parsePins("not json")).toEqual([]);
    expect(parsePins('{"a":1}')).toEqual([]);
    expect(parsePins(JSON.stringify(Array.from({ length: 80 }, (_, i) => `s${i}`)))).toHaveLength(MAX_PINS);
  });
});
