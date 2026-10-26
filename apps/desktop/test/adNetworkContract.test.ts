import { describe, expect, it, vi } from "vitest";
import { parseServeResponse } from "../../../packages/ads/src/validation.ts";
import { createFetchHandler } from "../../../services/api/src/fetchHandler.ts";
import { createMemoryStore } from "../../../services/api/src/memoryStore.ts";
import { encryptAdNetworkKey } from "../../../services/api/src/adNetworkCrypto.ts";
import type { AdNetworkConfig } from "../../../services/api/src/adNetworkConfig.ts";

const encryption = Buffer.alloc(32, 7).toString("base64");
const origin = "https://adcode.bluethenics.com";
const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZ0AAAAASUVORK5CYII=", "base64"));
const config: AdNetworkConfig = {
  id: "generic", name: "Provider", provider: "http-json", enabled: true, priority: 1, viewPayoutMicros: "10", clickPayoutMicros: "20",
  http: { serveUrl: "https://provider.com/serve", method: "POST", authHeader: "authorization", authPrefix: "Bearer ", requestTemplate: {}, creativePath: "ad", fields: { id: "id", advertiser: "advertiser", headline: "headline", body: "", clickUrl: "clickUrl", logoLight: "logo", logoDark: "" }, verifyUrl: "https://provider.com/verify", verifyTemplate: {}, verifiedPath: "verified", eventIdPath: "eventId" },
};

async function setup() {
  const store = createMemoryStore();
  await store.adNetworks!.put(config, "admin", 1);
  await store.adNetworks!.putKey(config.id, encryptAdNetworkKey(config.id, "provider-secret", encryption));
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    if (String(input) === config.http!.serveUrl) return Response.json({ ad: { id: "remote-ad", advertiser: "Sponsor", headline: "A useful tool", clickUrl: "https://sponsor.com/tool", logo: "https://images.sponsor.com/logo.png" } });
    expect(String(input)).toBe("https://images.sponsor.com/logo.png");
    expect(init?.headers).toEqual({ accept: "image/png,image/jpeg,image/webp" });
    expect(init?.redirect).toBe("error");
    return new Response(png, { headers: { "content-type": "image/png" } });
  });
  const api = createFetchHandler({ store, verifier: { async verify() { return { uid: "alice", claims: { email_verified: true } }; } }, adNetworks: { encryptionKeys: () => [encryption], fetchImpl } });
  const served = await api(new Request(`${origin}/v1/serve`, { method: "POST", headers: { authorization: "Bearer alice", "content-type": "application/json" }, body: JSON.stringify({ tags: [], themeKind: "light", count: 1 }) }));
  const response = await served.text();
  return { api, response, fetchImpl };
}

describe("external ads in released desktops", () => {
  it("passes the real client validator and proxies issued artwork through its allowlisted asset host", async () => {
    const { api, response, fetchImpl } = await setup();
    const parsed = parseServeResponse(response, new URL(origin).hostname);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error.detail);
    expect(parsed.value).toHaveLength(1);
    const creative = parsed.value[0]!;
    expect(creative.logoLight).toMatch(/^https:\/\/adcode\.bluethenics\.com\/assets\/network_an_/);
    expect(response).not.toContain("images.sponsor.com");
    expect(response).not.toContain("provider-secret");
    const asset = await api(new Request(creative.logoLight));
    expect(asset.status).toBe(200); expect(asset.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await asset.arrayBuffer())).toEqual(png);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const missing = await api(new Request(`${origin}/assets/network_an_unknown_light.png`));
    expect(missing.status).toBe(404); expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("does not expose executable or incorrectly labelled provider artwork on our origin", async () => {
    const { api, response, fetchImpl } = await setup();
    const parsed = parseServeResponse(response, new URL(origin).hostname);
    if (!parsed.ok) throw new Error(parsed.error.detail);
    fetchImpl.mockResolvedValueOnce(new Response("<script>alert(1)</script>", { headers: { "content-type": "image/png" } }));
    expect((await api(new Request(parsed.value[0]!.logoLight))).status).toBe(404);
  });
});
