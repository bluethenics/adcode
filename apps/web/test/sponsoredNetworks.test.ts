import { describe, expect, it, vi } from "vitest";
import { networksFor, parseNetworks, zeekendSessionId, zeekendTransport } from "../src/lib/sponsoredNetworks";

describe("which partners the sponsored page asks", () => {
  it("reads the server's list in order and drops anything malformed", () => {
    expect(parseNetworks({ networks: [{ id: "zeekend", publisherKey: "pub_test", placementId: "chat-main" }, { id: "imprezia" }, { id: "other" }, { id: "zeekend" }] }))
      .toEqual([{ id: "zeekend", publisherKey: "pub_test", placementId: "chat-main" }, { id: "imprezia" }]);
    expect(parseNetworks({})).toBeNull();
    expect(parseNetworks(null)).toBeNull();
  });

  it("keeps Zeekend first under a reply, and only Imprezia in a notification", () => {
    const both = [{ id: "zeekend" as const, publisherKey: "pub_test", placementId: "chat-main" }, { id: "imprezia" as const }];
    expect(networksFor("reply", both).map((network) => network.id)).toEqual(["zeekend", "imprezia"]);
    expect(networksFor("notification", both)).toEqual([{ id: "imprezia" }]);
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
