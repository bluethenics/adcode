import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { parseTheme, THEME_SCRIPT } from "../src/lib/theme";
import { meetsPublicStatsThreshold, parsePublicStats, PUBLIC_STATS_MIN_VERIFIED_CLICKS } from "../src/lib/publicStats";

describe("appearance before first paint", () => {
  it.each([null, "system", "invalid", "light", "dark"])("applies the saved preference %s", (saved) => {
    const document = { documentElement: { dataset: {} as Record<string, string> } };
    runInNewContext(THEME_SCRIPT, { document, localStorage: { getItem: () => saved } });
    expect(document.documentElement.dataset.theme).toBe(parseTheme(saved));
  });
  it("uses the system appearance if browser storage is blocked", () => {
    const document = { documentElement: { dataset: {} as Record<string, string> } };
    runInNewContext(THEME_SCRIPT, { document, localStorage: { getItem: () => { throw new Error("denied"); } } });
    expect(document.documentElement.dataset.theme).toBe("system");
  });
});

describe("public counter data", () => {
  it("accepts real zero totals and large totals without abbreviating them", () => {
    expect(parsePublicStats({ impressions: 0, clicks: 0, activeCampaigns: 0, asOf: 1 })).not.toBeNull();
    expect(parsePublicStats({ impressions: 123456789, clicks: 1234, activeCampaigns: 12, asOf: 1 })?.impressions).toBe(123456789);
  });
  it.each([null, {}, { impressions: -1 }, { impressions: 1, clicks: 0, activeCampaigns: 0, asOf: "now" }, { impressions: Infinity, clicks: 0, activeCampaigns: 0, asOf: 1 }])("rejects malformed totals", (value) => {
    expect(parsePublicStats(value)).toBeNull();
  });
  it("hides the network section until verified clicks reach 2K", () => {
    expect(PUBLIC_STATS_MIN_VERIFIED_CLICKS).toBe(2000);
    expect(meetsPublicStatsThreshold({ impressions: 92, clicks: 3, activeCampaigns: 2, asOf: 1 })).toBe(false);
    expect(meetsPublicStatsThreshold({ impressions: 50000, clicks: 1999, activeCampaigns: 5, asOf: 1 })).toBe(false);
    expect(meetsPublicStatsThreshold({ impressions: 50000, clicks: 2000, activeCampaigns: 5, asOf: 1 })).toBe(true);
  });
});
