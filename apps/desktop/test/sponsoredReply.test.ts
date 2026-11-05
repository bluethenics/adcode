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

describe("what the frame reports back", () => {
  /** Just enough of a window and an iframe for the frame's message handling. */
  function stage(): { frame: { contentWindow: { postMessage: (message: unknown, origin: string) => void }; style: { height: string }; removed: boolean }; post: (data: unknown, origin?: string) => void; sent: unknown[] } {
    const sent: unknown[] = [];
    const listeners: Array<(event: MessageEvent) => void> = [];
    const contentWindow = { postMessage: (message: unknown) => { sent.push(message); } };
    const frame = {
      contentWindow, style: { height: "" }, removed: false, className: "", title: "", src: "", referrerPolicy: "", loading: "",
      setAttribute: () => undefined, remove() { this.removed = true; },
    };
    Object.assign(globalThis, {
      document: { createElement: () => frame },
      window: {
        addEventListener: (_type: string, listener: (event: MessageEvent) => void) => listeners.push(listener),
        removeEventListener: (_type: string, listener: (event: MessageEvent) => void) => listeners.splice(listeners.indexOf(listener), 1),
      },
    });
    const post = (data: unknown, origin = "https://adcode.bluethenics.com"): void => {
      for (const listener of [...listeners]) listener({ source: contentWindow, origin, data } as unknown as MessageEvent);
    };
    return { frame, post, sent };
  }
  const exchange = { request: "what should I use?", response: "a CDN", sessionId: "partner-1", theme: "dark" as const };

  it("tells once that a card arrived, after handing over the exchange", async () => {
    const { frame, post, sent } = stage();
    const { sponsoredReplyFrame } = await import("../src/renderer/ai/sponsoredReply.ts");
    const outcomes: string[] = [];
    sponsoredReplyFrame(exchange, undefined, (outcome) => outcomes.push(outcome));
    post({ type: "adcode-sponsored-ready" });
    expect(sent).toHaveLength(1);
    post({ type: "adcode-sponsored-size", height: 0 });
    expect(outcomes).toEqual([]);
    post({ type: "adcode-sponsored-size", height: 151.6 });
    post({ type: "adcode-sponsored-size", height: 160 });
    expect(outcomes).toEqual(["shown"]);
    expect(frame.style.height).toBe("160px");
  });

  it("tells that there was no card, and ignores other origins", async () => {
    const { frame, post } = stage();
    const { sponsoredReplyFrame } = await import("../src/renderer/ai/sponsoredReply.ts");
    const outcomes: string[] = [];
    sponsoredReplyFrame(exchange, undefined, (outcome) => outcomes.push(outcome));
    post({ type: "adcode-sponsored-size", height: 200 }, "https://evil.example");
    expect(outcomes).toEqual([]);
    post({ type: "adcode-sponsored-empty" });
    expect(outcomes).toEqual(["empty"]);
    expect(frame.removed).toBe(true);
  });
});

describe("the notification layout", () => {
  it("asks the page for one card in a notification, and nothing changes for replies", () => {
    const base = { request: "q", response: "a", sessionId: "s", theme: "dark" as const };
    expect(sponsoredMessage({ ...base, layout: "notification" })).toMatchObject({ layout: "notification" });
    expect(sponsoredMessage(base)).not.toHaveProperty("layout");
    expect(sponsoredMessage({ ...base, layout: "reply" })).not.toHaveProperty("layout");
  });
});

describe("where the card sits", () => {
  it("passes on the card's measured edges, and tolerates a page that does not send them", async () => {
    const listeners: Array<(event: MessageEvent) => void> = [];
    const contentWindow = { postMessage: () => undefined };
    const frame = { contentWindow, style: { height: "" }, className: "", title: "", src: "", referrerPolicy: "", loading: "", setAttribute: () => undefined, remove: () => undefined };
    Object.assign(globalThis, {
      document: { createElement: () => frame },
      window: { addEventListener: (_type: string, listener: (event: MessageEvent) => void) => listeners.push(listener), removeEventListener: () => undefined },
    });
    const post = (data: unknown): void => { for (const listener of listeners) listener({ source: contentWindow, origin: "https://adcode.bluethenics.com", data } as unknown as MessageEvent); };
    const { sponsoredReplyFrame } = await import("../src/renderer/ai/sponsoredReply.ts");
    const sizes: unknown[] = [];
    sponsoredReplyFrame({ request: "q", response: "a", sessionId: "s", theme: "dark" }, undefined, undefined, (size) => sizes.push(size));
    post({ type: "adcode-sponsored-size", height: 152, left: 8, right: 331.4, top: 16 });
    post({ type: "adcode-sponsored-size", height: 152 });
    post({ type: "adcode-sponsored-size", height: 152, right: "wide", top: -3 });
    expect(sizes).toEqual([
      { height: 152, left: 8, right: 331, top: 16 },
      { height: 152, left: null, right: null, top: null },
      { height: 152, left: null, right: null, top: null },
    ]);
  });
});

describe("the turn", () => {
  it("hands the page which question of the conversation this is, and only a sensible number", () => {
    const base = { request: "q", response: "a", sessionId: "s", theme: "dark" as const };
    expect(sponsoredMessage({ ...base, turn: 3 })).toMatchObject({ turn: 3 });
    for (const turn of [0, -1, 2.5, 20_000]) expect(sponsoredMessage({ ...base, turn })).not.toHaveProperty("turn");
    expect(sponsoredMessage(base)).not.toHaveProperty("turn");
  });
});

describe("a card arriving under the last reply", () => {
  it("is scrolled into view while the chat is pinned to the bottom, since partners count only cards on screen", async () => {
    const { followSponsoredCard } = await import("../src/renderer/ai/sponsoredReply.ts");
    const chat = { scrollTop: 1_200, scrollHeight: 1_352 };
    let refreshed = 0;
    followSponsoredCard(chat, () => true, () => { refreshed += 1; })({ height: 152 });
    expect(chat.scrollTop).toBe(1_352);
    expect(refreshed).toBe(1);
  });

  it("leaves the chat where it is when the person has scrolled up, or nothing arrived", async () => {
    const { followSponsoredCard } = await import("../src/renderer/ai/sponsoredReply.ts");
    const chat = { scrollTop: 300, scrollHeight: 1_352 };
    followSponsoredCard(chat, () => false)({ height: 152 });
    expect(chat.scrollTop).toBe(300);
    followSponsoredCard(chat, () => true)({ height: 0 });
    expect(chat.scrollTop).toBe(300);
  });
});
