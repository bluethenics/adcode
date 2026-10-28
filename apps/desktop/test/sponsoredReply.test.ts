import { describe, expect, it } from "vitest";
import { sponsoredMessage } from "../src/renderer/ai/sponsoredReply.ts";

describe("what a sponsored card under a reply is given", () => {
  it("hands over the exchange and the conversation's id, clipped", () => {
    const message = sponsoredMessage({ request: "  how do I debounce?  ", response: "x".repeat(9_000), sessionId: "chat-42", theme: "light" });
    expect(message).toEqual({ type: "adcode-sponsored", request: "how do I debounce?", response: "x".repeat(4_000), sessionId: "chat-42", theme: "light" });
  });

  it("sends nothing without a question, an answer, or a conversation", () => {
    expect(sponsoredMessage({ request: "", response: "a", sessionId: "s", theme: "dark" })).toBeNull();
    expect(sponsoredMessage({ request: "q", response: "  ", sessionId: "s", theme: "dark" })).toBeNull();
    expect(sponsoredMessage({ request: "q", response: "a", sessionId: "", theme: "dark" })).toBeNull();
  });
});
