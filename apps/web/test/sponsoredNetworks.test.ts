import { describe, expect, it, vi } from "vitest";
import { networksFor, parseNetworks, SPONSORED_EMBEDDERS, withoutPrices, zeekendSessionId, zeekendTransport } from "../src/lib/sponsoredNetworks";

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

describe("which partners the sponsored page asks", () => {
  it("keeps Zeekend from the server's list, in order, and drops Imprezia and anything malformed", () => {
    expect(parseNetworks({ networks: [{ id: "zeekend", publisherKey: "pub_test", placementId: "chat-main" }, { id: "imprezia" }, { id: "other" }, { id: "zeekend" }] }))
      .toEqual([{ id: "zeekend", publisherKey: "pub_test", placementId: "chat-main" }]);
    expect(parseNetworks({})).toBeNull();
    expect(parseNetworks(null)).toBeNull();
  });

  it("asks Zeekend under a reply and in a notification alike", () => {
    const zeekend = [{ id: "zeekend" as const, publisherKey: "pub_test", placementId: "chat-main" }];
    expect(networksFor("reply", zeekend)).toEqual(zeekend);
    expect(networksFor("notification", zeekend)).toEqual(zeekend);
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
