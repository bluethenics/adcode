import { describe, expect, it, vi } from "vitest";
import { previewImprezia } from "../src/impreziaPreview.ts";
import { parseAdNetworkConfig, type AdNetworkConfig } from "../src/adNetworkConfig.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import { encryptAdNetworkKey } from "../src/adNetworkCrypto.ts";
import { handleAdNetworkAdmin } from "../src/adNetworks.ts";

const config: AdNetworkConfig = { id: "imprezia", name: "Imprezia", provider: "imprezia", enabled: false, priority: 1, viewPayoutMicros: "0", clickPayoutMicros: "0", imprezia: { kind: "app", id: "com.publisher.editor" } };
const native = { assets: [{ id: 1, title: { text: "Sponsor" } }, { id: 2, img: { url: "https://sponsor.com/image.png" } }], link: { url: "https://sponsor.com" }, imptrackers: ["https://tracker.com/private"] };
const bid = (patch = {}) => ({ id: "request-1", cur: "USD", seatbid: [{ bid: [{ id: "bid-1", impid: "1", price: 1.2, exp: 120, adm: JSON.stringify(native), nurl: "https://x.imprezia.ai/private?token=secret", ...patch }] }] });
describe("Imprezia Exchange non-billable preview", () => {
  it("uses the documented protocol without callbacks, context or credentials in its result", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      expect(url).toBe("https://x.imprezia.ai/v1/bid");
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ id: "request-1", at: 1, test: 1, tmax: 250, app: { bundle: "com.publisher.editor" } });
      expect(body.site).toBeUndefined(); expect(body.user).toBeUndefined(); expect(body.device).toBeUndefined();
      expect(JSON.parse(body.imp[0].native.request).ver).toBe("1.2");
      expect(init?.redirect).toBe("error");
      expect(init?.headers).toMatchObject({ "X-API-Key": "private-key", "X-OpenRTB-Version": "2.6" });
      return Response.json(bid());
    });
    const result = await previewImprezia(config, "private-key", "request-1", fetchImpl);
    expect(result).toMatchObject({ headline: "Sponsor", ttlMs: 120_000 });
    expect(JSON.stringify(result)).not.toMatch(/private-key|token=secret|tracker.com/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("treats no-bid as normal and never parses its empty body", async () => {
    expect(await previewImprezia(config, "key", "request-1", async () => new Response(null, { status: 204 }))).toBeNull();
  });
  it("exposes only a non-billable admin preview and creates no delivery or earnings", async () => {
    const store = createMemoryStore();
    const key = Buffer.alloc(32, 8).toString("base64");
    await store.adNetworks!.put(config, "admin", 1);
    await store.adNetworks!.putKey(config.id, encryptAdNetworkKey(config.id, "serving-key", key));
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const result = await handleAdNetworkAdmin({ store, clock: { now: () => 1 }, ids: { next: () => "test-request" }, encryptionKeys: () => [key], fetchImpl }, "admin", "/v1/admin/ad-networks/imprezia/test", "POST", {});
    expect(result).toEqual({ status: 200, body: { ok: true, creative: null, readiness: "exchange-test-only" } });
    expect((await store.getBalance("admin")).availableMicros).toBe(0n);
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)).test).toBe(1);
  });
  it("rejects HTML, expired or mismatched bids", async () => {
    for (const patch of [{ adm: "<script>unsafe</script>" }, { exp: 0 }, { impid: "other" }, { price: -1 }]) {
      await expect(previewImprezia(config, "key", "request-1", async () => Response.json(bid(patch)))).rejects.toThrow();
    }
    await expect(previewImprezia(config, "key", "other", async () => Response.json(bid()))).rejects.toThrow();
  });
  it("requires non-billable settings and valid authorized supply configuration", () => {
    expect(parseAdNetworkConfig(config)).toEqual(config);
    expect(parseAdNetworkConfig({ ...config, enabled: true })).toBeNull();
    expect(parseAdNetworkConfig({ ...config, viewPayoutMicros: "1" })).toBeNull();
    expect(parseAdNetworkConfig({ ...config, imprezia: { kind: "site", id: "localhost" } })).toBeNull();
  });
});
