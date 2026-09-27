import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPortalReport } from "../src/lib/portalReport";

const advertiser = {
  advertiserId: "adv-1", name: "Acme", status: "active",
  fundedMicros: "1000000", reservedMicros: "500000", availableMicros: "500000",
};
const campaigns = [{
  campaignId: "camp-1", name: "Launch", status: "active", cpmMicros: "2000000",
  budgetMicros: "500000", spentMicros: "6000", targetTags: [], createdAt: 1,
  serves: 10, impressions: 3, clicks: 0,
}];
const series = [{
  day: "2026-09-27", campaignId: "camp-1", impressions: 3, clicks: 0, spentMicros: "6000",
}];
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (input) => {
    const path = new URL(String(input)).pathname;
    return Response.json(path.endsWith("/advertiser") ? advertiser : path.endsWith("/campaigns") ? campaigns : series);
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("campaign reporting", () => {
  it("loads verified views independently of serves for the requested reporting window", async () => {
    expect(await loadPortalReport("token", "7")).toEqual({
      ok: true, value: { advertiser, campaigns, series },
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/portal/series?days=7"))).toBe(true);
  });

  it.each(["/campaigns", "/series"])("does not publish a zero report when %s fails", async (endpoint) => {
    const success = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
      if (new URL(String(input)).pathname.endsWith(endpoint)) {
        return Response.json({ error: "internal" }, { status: 500 });
      }
      return success(input, init);
    });
    expect(await loadPortalReport("token", "30")).toEqual({ ok: false, error: "server-error" });
  });

  it("recovers from a failed request with fresh statistics on the next refresh", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(await loadPortalReport("token", "30")).toEqual({ ok: false, error: "offline" });
    expect(await loadPortalReport("token", "30")).toEqual({
      ok: true, value: { advertiser, campaigns, series },
    });
  });

  it("preserves genuine empty reports", async () => {
    fetchMock.mockImplementation(async (input) => Response.json(
      new URL(String(input)).pathname.endsWith("/advertiser") ? advertiser : [],
    ));
    expect(await loadPortalReport("token", "90")).toEqual({
      ok: true, value: { advertiser, campaigns: [], series: [] },
    });
  });

  it("keeps signup separate from a reporting failure", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "no-advertiser" }, { status: 404 }));
    expect(await loadPortalReport("token", "30")).toEqual({ ok: false, error: "no-advertiser" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
