import { describe, expect, it } from "vitest";
import {
  LIGHT_MESSAGES,
  applySessionsDelta,
  knownOf,
  lightSession,
  sessionsDelta,
} from "../src/shared/sessionDelta.ts";

interface Message { readonly role: "user" | "assistant"; readonly text: string; readonly at: number }
interface Session { readonly id: string; readonly title: string; readonly updatedAt: number; readonly messages: readonly Message[]; readonly summary?: { readonly text: string } | null }

const message = (at: number): Message => ({ role: at % 2 === 0 ? "user" : "assistant", text: `m${String(at)}`, at });
const chat = (id: string, count: number, extra: Partial<Session> = {}): Session => ({
  id,
  title: `Chat ${id}`,
  updatedAt: count,
  messages: Array.from({ length: count }, (_, index) => message(index + 1)),
  ...extra,
});

/** One round trip: the window's copies, the main process's list, the rebuilt list. */
function roundTrip(cache: Map<string, Session>, sessions: readonly Session[]) {
  const known = [...cache.values()].map((session) => knownOf(session));
  const delta = sessionsDelta<Message, Session>(structuredClone(sessions), structuredClone(known));
  const list = applySessionsDelta<Message, Session>(cache, structuredClone(delta));
  return { delta, list };
}

describe("sending only what changed", () => {
  it("sends everything the window does not have yet", () => {
    const cache = new Map<string, Session>();
    const { delta, list } = roundTrip(cache, [chat("a", 4), chat("b", 2)]);
    expect(delta.entries.map((entry) => entry.kind)).toEqual(["full", "full"]);
    expect(list?.map((session) => session.messages.length)).toEqual([4, 2]);
  });

  it("answers 'same' for an unchanged chat and sends only the new messages of the one in use", () => {
    const cache = new Map<string, Session>();
    roundTrip(cache, [chat("a", 400), chat("b", 2)]);
    const { delta, list } = roundTrip(cache, [chat("a", 402), chat("b", 2)]);
    expect(delta.entries[0]).toMatchObject({ kind: "tail", id: "a", base: 400 });
    expect(delta.entries[0]?.kind === "tail" && delta.entries[0].tail.length).toBe(2);
    expect(delta.entries[1]).toEqual({ kind: "same", id: "b" });
    expect(list?.[0]).toEqual(chat("a", 402));
    // The tail is a small fraction of the chat: that is the point.
    expect(JSON.stringify(delta).length).toBeLessThan(JSON.stringify(chat("a", 402)).length / 20);
  });

  it("resends a chat whole when the window's copy is not a prefix of it", () => {
    const cache = new Map<string, Session>();
    roundTrip(cache, [chat("a", 6)]);
    const rewritten = { ...chat("a", 8), messages: [message(1), message(2), message(99), ...chat("a", 8).messages.slice(3)] };
    const replaced = roundTrip(cache, [rewritten]);
    expect(replaced.delta.entries[0]?.kind).toBe("full");
    expect(replaced.list?.[0]).toEqual(rewritten);
    const shorter = roundTrip(cache, [chat("a", 3)]);
    expect(shorter.delta.entries[0]?.kind).toBe("full");
  });

  it("notices a rename or a new summary even when no message was added", () => {
    const cache = new Map<string, Session>();
    roundTrip(cache, [chat("a", 4)]);
    const renamed = roundTrip(cache, [chat("a", 4, { title: "Checkout bug" })]);
    expect(renamed.delta.entries[0]).toMatchObject({ kind: "tail", base: 4 });
    expect(renamed.list?.[0]?.title).toBe("Checkout bug");
    const summarised = roundTrip(cache, [chat("a", 4, { title: "Checkout bug", summary: { text: "older part" } })]);
    expect(summarised.list?.[0]?.summary).toEqual({ text: "older part" });
  });

  it("drops chats that were deleted and keeps the list's order", () => {
    const cache = new Map<string, Session>();
    roundTrip(cache, [chat("a", 2), chat("b", 2), chat("c", 2)]);
    const { list } = roundTrip(cache, [chat("c", 3), chat("a", 2)]);
    expect(list?.map((session) => session.id)).toEqual(["c", "a"]);
    expect([...cache.keys()].sort()).toEqual(["a", "c"]);
  });

  it("asks for everything again when an answer relies on a copy the window no longer has", () => {
    const cache = new Map<string, Session>();
    expect(applySessionsDelta<Message, Session>(cache, { entries: [{ kind: "same", id: "gone" }] })).toBeNull();
  });

  it("treats what the window says it holds as untrusted", () => {
    const sessions = [chat("a", 3)];
    for (const junk of [null, "x", [null, 4, { id: 1 }], [{ id: "a", updatedAt: 3, count: -1, meta: 0 }], [{ id: "a", updatedAt: 3, count: 1.5, meta: 0 }]]) {
      expect(sessionsDelta<Message, Session>(sessions, junk).entries[0]?.kind).toBe("full");
    }
  });
});

describe("the light view of the chat on screen", () => {
  it("keeps the latest messages and says how many there are in all", () => {
    const light = lightSession<Message, Session>(chat("a", 5000));
    expect(light.messages).toHaveLength(LIGHT_MESSAGES);
    expect(light.messages.at(-1)?.at).toBe(5000);
    expect(light.messageCount).toBe(5000);
    expect(light.title).toBe("Chat a");
  });
});
