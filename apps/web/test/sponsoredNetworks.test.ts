import { describe, expect, it, vi } from "vitest";
import { impreziaCardId, networksFor, parseNetworks, partnerSessionId, slotPosition, SPONSORED_EMBEDDERS, watchImpreziaImpressions, withDeadline, withoutPrices, zeekendSessionId, zeekendTransport } from "../src/lib/sponsoredNetworks";

describe("a Zeekend card without prices", () => {
  it("drops the price from the card and from every product, and nothing else", () => {
    const slot = { id: "s1", headline: "Standing desk", body: "Solid oak", price: "$499", clickUrl: "https://z.example/c/1", disclosure: "Sponsored", items: [{ title: "Desk", price: "$499", clickUrl: "https://z.example/c/2" }, { title: "Lamp" }] };
    expect(withoutPrices(slot)).toEqual({ id: "s1", headline: "Standing desk", body: "Solid oak", clickUrl: "https://z.example/c/1", disclosure: "Sponsored", items: [{ title: "Desk", clickUrl: "https://z.example/c/2" }, { title: "Lamp" }] });
    // The slot the SDK measures is left as it was.
    expect(slot.price).toBe("$499");
    expect(slot.items[0]!.price).toBe("$499");
  });

  it("leaves a card that had no price or products alone", () => {
    expect(withoutPrices({ id: "s2", headline: "A tool", clickUrl: "https://z.example/c/3", disclosure: "Sponsored" })).toEqual({ id: "s2", headline: "A tool", clickUrl: "https://z.example/c/3", disclosure: "Sponsored" });
  });
});

const everywhere: ("banner" | "notification" | "reply")[] = ["banner", "notification", "reply"];
const zeekend = { id: "zeekend" as const, publisherKey: "pub_test", placementId: "chat-main", share: 50, places: everywhere };
const imprezia = { id: "imprezia" as const, share: 50, places: everywhere };

describe("which partners the sponsored page asks", () => {
  it("keeps Zeekend and Imprezia from the server's list, in order, and drops anything malformed", () => {
    expect(parseNetworks({ networks: [
      { id: "zeekend", publisherKey: "pub_test", placementId: "chat-main", share: 70, places: ["banner", "sidebar"] },
      { id: "imprezia", placementId: "editor_card", share: 30, places: ["notification"] },
      { id: "other" }, { id: "zeekend" }, { id: "imprezia" },
    ] })).toEqual([
      { id: "zeekend", publisherKey: "pub_test", placementId: "chat-main", share: 70, places: ["banner"] },
      { id: "imprezia", placementId: "editor_card", share: 30, places: ["notification"] },
    ]);
    // An older server sends no share or places: an equal share everywhere.
    expect(parseNetworks({ networks: [{ id: "zeekend", publisherKey: "pub_test", placementId: "chat-main" }, { id: "imprezia", share: 900 }] })).toEqual([zeekend, imprezia]);
    expect(parseNetworks({})).toBeNull();
    expect(parseNetworks(null)).toBeNull();
  });

  it("asks the network a slot falls to first, then the other to fill it", () => {
    expect(networksFor("banner", [zeekend, imprezia], 0.2)).toEqual([zeekend, imprezia]);
    expect(networksFor("banner", [zeekend, imprezia], 0.8)).toEqual([imprezia, zeekend]);
    // A share of 0 is a backup: never first, still asked when the other has nothing.
    expect(networksFor("banner", [{ ...zeekend, share: 0 }, imprezia], 0.1)).toEqual([imprezia, { ...zeekend, share: 0 }]);
    expect(networksFor("banner", [{ ...zeekend, share: 0 }, { ...imprezia, share: 0 }], 0.9)).toEqual([{ ...zeekend, share: 0 }, { ...imprezia, share: 0 }]);
  });

  it("keeps a network out of the places the admin left it out of", () => {
    const repliesOnly = { ...imprezia, places: ["reply" as const] };
    expect(networksFor("notification", [zeekend, repliesOnly], 0.9)).toEqual([zeekend]);
    expect(networksFor("reply", [zeekend, repliesOnly], 0.9)).toEqual([repliesOnly, zeekend]);
    expect(networksFor("banner", [], 0.5)).toEqual([]);
  });

  it("splits a conversation's slots by the shares, taking turns rather than running one network on", () => {
    const tally = (shares: [number, number], turns: number) => {
      const counts = { zeekend: 0, imprezia: 0 };
      let longestRun = 0, run = 0, last = "";
      for (let turn = 1; turn <= turns; turn++) {
        const first = networksFor("banner", [{ ...zeekend, share: shares[0] }, { ...imprezia, share: shares[1] }], slotPosition("chat-42", turn))[0]!.id;
        counts[first] += 1;
        run = first === last ? run + 1 : 1; last = first; longestRun = Math.max(longestRun, run);
      }
      return { ...counts, longestRun };
    };
    const even = tally([50, 50], 1000);
    expect(Math.abs(even.zeekend - 500)).toBeLessThanOrEqual(5);
    expect(even.longestRun).toBeLessThanOrEqual(3);
    const skewed = tally([70, 30], 1000);
    expect(Math.abs(skewed.imprezia - 300)).toBeLessThanOrEqual(5);
    expect(tally([100, 0], 50).imprezia).toBe(0);
  });

  it("starts different conversations on different networks", () => {
    const firsts = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => networksFor("banner", [zeekend, imprezia], slotPosition(`chat-${id}`, 1))[0]!.id));
    expect(firsts.size).toBe(2);
    for (const id of ["x", "y"]) for (const turn of [1, 2, 99]) {
      const position = slotPosition(id, turn);
      expect(position).toBeGreaterThanOrEqual(0);
      expect(position).toBeLessThan(1);
    }
  });

  it("lets only the desktop window and Phone link's page hand it an exchange", () => {
    expect(SPONSORED_EMBEDDERS).toEqual(["app://adcode", "https://web.bluethenics.com"]);
  });
});

describe("Zeekend's requests", () => {
  it("sends a slot request with the conversation's real turn, unchanged otherwise", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ slotId: "s1", format: "card" }));
    const transport = zeekendTransport(4, fetchImpl as unknown as typeof fetch, "https://exchange.example/v1");
    expect(await transport({ publisherKey: "pub_test", turn: 1, sessionId: "adc_1", context: { type: "conversation" } })).toEqual({ slotId: "s1", format: "card" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://exchange.example/v1/slot");
    expect(JSON.parse(String(init.body))).toEqual({ publisherKey: "pub_test", turn: 4, sessionId: "adc_1", context: { type: "conversation" } });
  });

  it("reports no fill and Zeekend's pacing reason the way its SDK expects", async () => {
    const paced = zeekendTransport(2, (async () => new Response(null, { status: 204, headers: { "x-zeekend-skip": "warmup" } })) as unknown as typeof fetch);
    expect(await paced({})).toEqual({ skipped: "warmup" });
    const empty = zeekendTransport(2, (async () => new Response(null, { status: 204 })) as unknown as typeof fetch);
    expect(await empty({})).toBeNull();
    const broken = zeekendTransport(2, (async () => new Response("no", { status: 401 })) as unknown as typeof fetch);
    await expect(broken({})).rejects.toThrow("http 401");
  });

  it("passes events through as the SDK built them, and never throws on one", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("offline"); });
    const transport = zeekendTransport(3, fetchImpl as unknown as typeof fetch, "https://exchange.example/v1");
    await expect(transport({ event: true, type: "impression", slotId: "s1", publisherKey: "pub_test" })).resolves.toBeNull();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://exchange.example/v1/event");
    expect(JSON.parse(String(init.body))).toEqual({ type: "impression", slotId: "s1", publisherKey: "pub_test" });
  });

  it("gives Zeekend a stable session id that is not the conversation's own", async () => {
    const one = await zeekendSessionId("chat-42");
    expect(one).toMatch(/^adc_[0-9a-f]{24}$/);
    expect(await zeekendSessionId("chat-42")).toBe(one);
    expect(await zeekendSessionId("chat-43")).not.toBe(one);
    expect(one).not.toContain("chat-42");
  });
});

describe("Imprezia's cards", () => {
  const ENDPOINT = "https://adcode.example/v1/imprezia/v1/events/sdk-impression";
  const UUID = "0f8e4f2c-6b1d-4c1e-9d55-3a2b1c0d9e8f";

  it("are named by their impression uuid, in the shape the 2.6.5 app already claims", () => {
    expect(impreziaCardId(UUID)).toBe(`slot_imp_${UUID}`);
    expect(/^slot_[A-Za-z0-9_-]{4,64}$/.test(impreziaCardId(UUID)!)).toBe(true);
    expect(impreziaCardId("")).toBeNull();
    expect(impreziaCardId("<script>")).toBeNull();
    expect(impreziaCardId(42)).toBeNull();
  });

  it("are heard once each, from the billed beacon only, whether fetched or beaconed, and passed through untouched", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const sendBeacon = vi.fn((_url: string | URL, _data?: BodyInit | null) => true);
    const target = { fetch: fetchImpl as unknown as typeof fetch, navigator: { sendBeacon } as { sendBeacon: (url: string | URL, data?: BodyInit | null) => boolean } };
    const heard: string[] = [];
    const stop = watchImpreziaImpressions(target, ENDPOINT, (uuid) => heard.push(uuid));
    const billed = JSON.stringify({ eventId: "evt_1", impressionUuid: UUID });
    // Telemetry carries an eventType by the SDK's contract and is never billed.
    await target.fetch(ENDPOINT, { method: "POST", body: JSON.stringify({ impressionUuid: UUID, eventType: "sdk_impression_first_render" }) });
    expect(target.navigator.sendBeacon(ENDPOINT, JSON.stringify({ impressionUuid: UUID, eventType: "sdk_impression_drop", dropReason: "never_visible" }))).toBe(true);
    expect(heard).toEqual([]);
    await target.fetch(ENDPOINT, { method: "POST", body: billed, keepalive: true });
    // A retry of the same beacon, and a different address, are not heard again.
    target.navigator.sendBeacon(ENDPOINT, billed);
    await target.fetch("https://adcode.example/v1/sponsored/impression", { method: "POST", body: JSON.stringify({ impressionUuid: "other" }) });
    expect(heard).toEqual([UUID]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[1]).toEqual([ENDPOINT, { method: "POST", body: billed, keepalive: true }]);
    expect(sendBeacon).toHaveBeenCalledTimes(2);
    stop();
    expect(target.fetch).toBe(fetchImpl);
    expect(target.navigator.sendBeacon).toBe(sendBeacon);
  });

  it("never break a beacon the watcher cannot read", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const target = { fetch: fetchImpl as unknown as typeof fetch };
    watchImpreziaImpressions(target, ENDPOINT, () => { throw new Error("listener broke"); });
    await expect(target.fetch(ENDPOINT, { method: "POST", body: "not json" })).resolves.toBeInstanceOf(Response);
    await expect(target.fetch(ENDPOINT, { method: "POST", body: JSON.stringify({ impressionUuid: UUID }) })).resolves.toBeInstanceOf(Response);
  });

  it("are asked under a session id of their own, unlinkable to Zeekend's or the conversation's", async () => {
    const one = await partnerSessionId("imprezia", "chat-42");
    expect(one).toMatch(/^adc_[0-9a-f]{24}$/);
    expect(one).not.toBe(await partnerSessionId("zeekend", "chat-42"));
    expect(await partnerSessionId("zeekend", "chat-42")).toBe(await zeekendSessionId("chat-42"));
  });
});

describe("a partner's time", () => {
  it("ends at the deadline, and a late or failed answer reads as none", async () => {
    vi.useFakeTimers();
    try {
      const late = withDeadline(new Promise((resolve) => setTimeout(() => resolve("card"), 5_000)), 1_000);
      vi.advanceTimersByTime(1_000);
      await expect(late).resolves.toBeNull();
      const quick = withDeadline(Promise.resolve("card"), 1_000);
      await expect(quick).resolves.toBe("card");
      await expect(withDeadline(Promise.reject(new Error("offline")), 1_000)).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
