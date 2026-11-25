import { describe, expect, it, vi } from "vitest";
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

describe("the ad box above the message box", () => {
  it("asks the page for the banner layout, and for nothing it does not know", () => {
    expect(sponsoredMessage({ request: "q", response: "a", sessionId: "s", theme: "dark", layout: "banner", turn: 3 })).toEqual({ type: "adcode-sponsored", request: "q", response: "a", sessionId: "s", theme: "dark", layout: "banner", turn: 3 });
    expect(sponsoredMessage({ request: "q", response: "a", sessionId: "s", theme: "dark", layout: "reply" })).not.toHaveProperty("layout");
  });

  it("invents no question of its own", async () => {
    const mod = await import("../src/renderer/ai/sponsoredReply.ts");
    expect(mod).not.toHaveProperty("OPENING_EXCHANGE");
    expect(mod.SPONSOR_ROTATE_MS).toBe(30_000);
  });
});

describe("asking a partner once for what a person sent", () => {
  const one = { request: "How do I debounce a search box?", response: "Wait until typing stops." };

  it("counts the conversation's own user turns, from 1", async () => {
    const { createSponsorAsks } = await import("../src/renderer/ai/sponsoredReply.ts");
    const asks = createSponsorAsks();
    expect(asks.claim("chat-a", one)).toBe(1);
    expect(asks.claim("chat-a", { request: "And throttle?", response: "Run at most every N ms." })).toBe(2);
    // Another conversation starts again at 1.
    expect(asks.claim("chat-b", one)).toBe(1);
  });

  it("never asks again about an exchange it has asked about, however often the box looks", async () => {
    const { createSponsorAsks } = await import("../src/renderer/ai/sponsoredReply.ts");
    const asks = createSponsorAsks();
    expect(asks.claim("chat-a", one)).toBe(1);
    // Zeekend suspended ADCode for re-asking the same question every 30 s with a rising turn.
    for (let beat = 0; beat < 100; beat += 1) expect(asks.claim("chat-a", one)).toBeNull();
  });

  it("asks about nothing when there is no finished exchange", async () => {
    const { createSponsorAsks } = await import("../src/renderer/ai/sponsoredReply.ts");
    const asks = createSponsorAsks();
    expect(asks.claim("chat-a", null)).toBeNull();
    expect(asks.claim("chat-a", { request: " ", response: "x" })).toBeNull();
    expect(asks.claim("chat-a", { request: "x", response: "" })).toBeNull();
  });

  it("forgets the oldest conversation rather than grow for ever", async () => {
    const { createSponsorAsks } = await import("../src/renderer/ai/sponsoredReply.ts");
    const asks = createSponsorAsks(2);
    asks.claim("a", one);
    asks.claim("b", one);
    asks.claim("c", one);
    expect(asks.claim("a", one)).toBe(1);
  });
});

describe("the ad box keeps itself filled", () => {
  class FakeElement {
    readonly dataset: Record<string, string> = {};
    readonly style: Record<string, string> & { setProperty(): void } = { setProperty: () => undefined } as never;
    readonly children: FakeElement[] = [];
    hidden = false;
    className = "";
    parentElement: FakeElement | null = null;
    contentWindow = null;
    setAttribute(): void {}
    append(child: FakeElement): void { child.parentElement = this; this.children.push(child); }
    remove(): void { const list = this.parentElement?.children; if (list) list.splice(list.indexOf(this), 1); this.parentElement = null; }
    get isConnected(): boolean { return this.parentElement !== null; }
  }

  it("asks at once, then on every beat while on screen, and stops when told", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("document", { createElement: () => new FakeElement(), visibilityState: "visible", addEventListener: () => undefined, removeEventListener: () => undefined });
    vi.stubGlobal("window", { addEventListener: () => undefined, removeEventListener: () => undefined });
    try {
      const { createSponsorStrip } = await import("../src/renderer/ai/sponsoredReply.ts");
      const strip = createSponsorStrip("https://adcode.example");
      const box = strip.element as unknown as FakeElement;
      let onScreen = true;
      let asked = 0;
      const stop = strip.keepFilled(() => ({ request: "q", response: "a", sessionId: "s", theme: "dark", layout: "banner", turn: ++asked }), 30_000, () => onScreen);
      expect(asked).toBe(1);
      expect(box.hidden).toBe(false);
      vi.advanceTimersByTime(30_000);
      expect(asked).toBe(2);
      // Hidden or minimised: no card is asked for, none counts.
      onScreen = false;
      vi.advanceTimersByTime(60_000);
      expect(asked).toBe(2);
      onScreen = true;
      stop();
      vi.advanceTimersByTime(90_000);
      expect(asked).toBe(2);
      // A newer card replaces one still on its way: one waiting frame at a time.
      expect(box.children).toHaveLength(1);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});

describe("claiming a card's pay", () => {
  it("claims only on screen, and on the web only in the tab being used", async () => {
    const { mayClaimCard } = await import("../src/renderer/ai/sponsoredReply.ts");
    const doc = (visibilityState: DocumentVisibilityState, focused: boolean) => ({ visibilityState, hasFocus: () => focused });
    expect(mayClaimCard(doc("visible", false), false)).toBe(true);
    expect(mayClaimCard(doc("hidden", true), false)).toBe(false);
    expect(mayClaimCard(doc("visible", true), true)).toBe(true);
    expect(mayClaimCard(doc("visible", false), true)).toBe(false);
    expect(mayClaimCard(undefined, true)).toBe(false);
  });
});

describe("the card a partner counted", () => {
  it("hands the app the card and the page's hashed session id, and the id only when it is well formed", async () => {
    const listeners: Array<(event: MessageEvent) => void> = [];
    const contentWindow = { postMessage: () => undefined };
    const frame = { contentWindow, style: { height: "" }, className: "", title: "", src: "", referrerPolicy: "", loading: "", setAttribute: () => undefined, remove: () => undefined };
    const claims: unknown[][] = [];
    Object.assign(globalThis, {
      document: { createElement: () => frame, visibilityState: "visible", hasFocus: () => true, documentElement: { dataset: {} } },
      window: { addEventListener: (_type: string, listener: (event: MessageEvent) => void) => listeners.push(listener), removeEventListener: () => undefined },
      adcode: { ads: { partnerImpression: (...args: unknown[]) => claims.push(args) } },
    });
    const post = (data: unknown): void => { for (const listener of listeners) listener({ source: contentWindow, origin: "https://adcode.bluethenics.com", data } as unknown as MessageEvent); };
    const { sponsoredReplyFrame } = await import("../src/renderer/ai/sponsoredReply.ts");
    sponsoredReplyFrame({ request: "q", response: "a", sessionId: "s", theme: "dark" }, undefined, undefined);
    post({ type: "adcode-sponsored-impression", slotId: "slot_abcd1234", conversationId: "adc_0123456789abcdef01234567" });
    post({ type: "adcode-sponsored-impression", slotId: "slot_abcd1235" });
    post({ type: "adcode-sponsored-impression", slotId: "slot_abcd1236", conversationId: "has space" });
    expect(claims).toEqual([["slot_abcd1234", "adc_0123456789abcdef01234567"], ["slot_abcd1235", undefined], ["slot_abcd1236", undefined]]);
    delete (globalThis as { adcode?: unknown }).adcode;
  });
});
