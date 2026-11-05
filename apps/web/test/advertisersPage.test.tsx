import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import AdvertisersPage, { metadata } from "../src/app/advertisers/page";
import { ADVERTISER_FAQ, FLOOR, budgetExamples } from "../src/lib/advertisers";
import { readApi } from "../src/lib/apiRead";
import config from "../next.config";

vi.mock("../src/lib/apiRead", () => ({ readApi: vi.fn() }));
afterEach(() => vi.resetAllMocks());

const LIVE = { impressions: 20_116, clicks: 84_093, activeCampaigns: 3, developers: 11_391, developersThisWeek: 7_027, asOf: 1_793_710_707_801 };
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the advertiser landing page", () => {
  it("leads with the live developer count and the network figures from /v1/stats", async () => {
    vi.mocked(readApi).mockResolvedValue(Response.json(LIVE));
    const html = text(renderToStaticMarkup(await AdvertisersPage()));

    expect(readApi).toHaveBeenCalledWith("/v1/stats", 60);
    expect(html).toContain("Reach 11,391 developers while they build.");
    expect(html).toContain("7,027");
    expect(html).toContain("62% of the network joined this week");
    expect(html).toContain("20,116");
    expect(html).toContain("Competing for the next card");
    // The composite activity score is not ad inventory, so it never reaches this page.
    expect(readApi).not.toHaveBeenCalledWith("/v1/impressions", expect.anything());
  });

  it("tells an advertiser when no campaign is running that the next one has the slots to itself", async () => {
    vi.mocked(readApi).mockResolvedValue(Response.json({ ...LIVE, activeCampaigns: 0 }));
    const html = text(renderToStaticMarkup(await AdvertisersPage()));

    expect(html).toContain("None right now. The next one takes every slot it targets, at the floor price");
    expect(html).not.toContain("Competing for the next card");
  });

  it("states no audience size at all when the figures are unavailable", async () => {
    vi.mocked(readApi).mockRejectedValue(new Error("offline"));
    const html = text(renderToStaticMarkup(await AdvertisersPage()));

    expect(html).toContain("Reach developers while they build.");
    expect(html).not.toContain("The network, right now");
    expect(html).not.toMatch(/\d[\d,.]*\s*(k\s*)?developers/i);
  });

  it("keeps small early totals hidden behind the homepage's traction gate", async () => {
    vi.mocked(readApi).mockResolvedValue(Response.json({ ...LIVE, clicks: 12 }));
    const html = text(renderToStaticMarkup(await AdvertisersPage()));

    expect(html).toContain("Reach developers while they build.");
    expect(html).not.toContain("11,391");
  });

  it("quotes prices from the billing constants, and carries the builder and the FAQ", async () => {
    vi.mocked(readApi).mockRejectedValue(new Error("offline"));
    const markup = renderToStaticMarkup(await AdvertisersPage());

    expect(FLOOR).toEqual({ block: "$1", cpm: "$2", views: 500 });
    expect(budgetExamples([100])).toEqual([{ budget: "$100", views: 50_000 }]);
    expect(text(markup)).toContain("$1 per 500 verified views");
    expect(markup).toContain('id="start"');
    expect(markup).toMatch(/<form\b[\s\S]*?<button\b[^>]*type="submit"/);
    for (const item of ADVERTISER_FAQ) expect(markup).toContain(item.q.replace("'", "&#x27;"));
    expect(markup).toContain('href="/portal"');
  });

  it("shows both placements, labels the sample workspace as a sample, and repeats the way in", async () => {
    vi.mocked(readApi).mockRejectedValue(new Error("offline"));
    const html = text(renderToStaticMarkup(await AdvertisersPage()));

    expect(html).toContain("Desktop app");
    expect(html).toContain("Browser editor");
    // Illustrative numbers must say so, and must obey the real price: 12,480 views at the floor.
    expect(html).toContain("Sample campaign with illustrative figures");
    expect(html).toContain(`12,480`);
    expect(html).toContain(`$${((12_480 / 1000) * 2).toFixed(2)}`);
    expect(html.match(/Start a campaign/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("is the canonical advertiser address, and the old one moves here", async () => {
    expect(metadata.alternates?.canonical).toMatch(/\/advertisers$/);
    const redirects = await config.redirects?.();
    expect(redirects?.find((one) => one.source === "/advertise")).toMatchObject({ destination: "/advertisers", permanent: true });
  });
});
