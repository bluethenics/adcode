import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdvertiseInvite } from "../src/components/AdvertiseInvite";

describe("the advertiser offer, reached through an invite", () => {
  const html = renderToStaticMarkup(<AdvertiseInvite code="k7p4qzm" />);

  it("leads with the plain offer until the lookup names the sender", () => {
    expect(html).toContain("Advertise on ADCode");
    expect(html).toContain("Reach developers");
  });

  it("states only published facts - no invented reach figure", () => {
    expect(html).toContain("$1 per 500 verified impressions");
    expect(html).toContain("50%");
    // Advertisers buy on numbers. Nothing on this page may claim an audience size.
    expect(html.replace(/<[^>]+>/g, " ")).not.toMatch(/\d[\d,.]*\s*(k\s*)?(developers|users|people|installs)/i);
  });
});
