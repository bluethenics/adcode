import { describe, expect, it } from "vitest";
import { admitExchange, isCannedQuestion, type AskStorage } from "../src/lib/sponsoredAsks";

function memory(): AskStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => void values.set(key, value) };
}

describe("sentences ADCode wrote in a person's name", () => {
  it("knows the opening one and the three notification ones", () => {
    expect(isCannedQuestion("I'm a software developer working in my code editor all day. What would make my work more comfortable and productive?")).toBe(true);
    expect(isCannedQuestion("What's worth buying for a programmer who works on markdown code for hours at a time?")).toBe(true);
    expect(isCannedQuestion("I spend long days building a typescript, react project at my desk. What gear would make the work more comfortable?")).toBe(true);
    expect(isCannedQuestion("I'm a developer working on a rust project. What would help me focus and stay productive through the day?")).toBe(true);
  });

  it("lets a person's own words through, even about the same subject", () => {
    expect(isCannedQuestion("What's a good ergonomic keyboard for a programmer?")).toBe(false);
    expect(isCannedQuestion("How do I debounce a search box?")).toBe(false);
  });
});

describe("what a partner is asked", () => {
  it("asks about a canned sentence never", () => {
    const storage = memory();
    expect(admitExchange("s", "I'm a software developer working in my code editor all day. What would make my work more comfortable and productive?", "A chair.", storage)).toBeNull();
  });

  it("counts the conversation's different exchanges as its user turns, whatever the app sent", () => {
    const storage = memory();
    expect(admitExchange("chat-1", "How do I debounce?", "Wait.", storage)).toBe(1);
    expect(admitExchange("chat-1", "And throttle?", "Cap the rate.", storage)).toBe(2);
    expect(admitExchange("chat-2", "How do I debounce?", "Wait.", storage)).toBe(1);
  });

  it("refuses the same exchange resent on a timer, however many times", () => {
    const storage = memory();
    expect(admitExchange("chat-1", "How do I debounce?", "Wait.", storage)).toBe(1);
    for (let beat = 0; beat < 99; beat += 1) expect(admitExchange("chat-1", "How do I debounce?", "Wait.", storage)).toBeNull();
    // A new question in the same conversation is the turn after, not the hundredth.
    expect(admitExchange("chat-1", "And throttle?", "Cap the rate.", storage)).toBe(2);
  });

  it("asks nothing when it cannot remember what it asked", () => {
    expect(admitExchange("chat-1", "How do I debounce?", "Wait.", null)).toBeNull();
    const broken: AskStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => undefined };
    expect(admitExchange("chat-1", "How do I debounce?", "Wait.", broken)).toBeNull();
  });

  it("forgets the oldest conversations instead of growing for ever", () => {
    const storage = memory();
    for (let index = 0; index < 60; index += 1) admitExchange(`chat-${String(index)}`, "q", "a", storage);
    const stored = JSON.parse(storage.values.get("adcode.sponsored.asked.v1")!) as Record<string, unknown>;
    expect(Object.keys(stored)).toHaveLength(50);
    expect(stored["chat-0"]).toBeUndefined();
    expect(stored["chat-59"]).toBeDefined();
  });
});
