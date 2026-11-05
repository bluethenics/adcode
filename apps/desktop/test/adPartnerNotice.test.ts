import { describe, expect, it } from "vitest";
import { AD_PARTNER_NOTICE, AD_PARTNER_PRIVACY_URL, shouldShowAdPartnerNotice } from "../src/renderer/ads/adPartnerNotice.ts";

describe("the one-time notice that sponsored cards are on", () => {
  const on = { "adcode.ads.enabled": true, "adcode.ads.chatSponsored": true, "adcode.ads.partnerNotifications": true };

  it("is shown once to somebody with either partner setting on", () => {
    expect(shouldShowAdPartnerNotice(on, false)).toBe(true);
    expect(shouldShowAdPartnerNotice({ ...on, "adcode.ads.chatSponsored": false }, false)).toBe(true);
    expect(shouldShowAdPartnerNotice({ ...on, "adcode.ads.partnerNotifications": false }, false)).toBe(true);
  });

  it("is not shown again, nor to somebody with both off or sponsored messages off", () => {
    expect(shouldShowAdPartnerNotice(on, true)).toBe(false);
    expect(shouldShowAdPartnerNotice({ ...on, "adcode.ads.chatSponsored": false, "adcode.ads.partnerNotifications": false }, false)).toBe(false);
    expect(shouldShowAdPartnerNotice({ ...on, "adcode.ads.enabled": false }, false)).toBe(false);
  });

  it("says who receives what, and offers Turn off", () => {
    expect(AD_PARTNER_NOTICE.body).toContain("Zeekend, then Imprezia");
    expect(AD_PARTNER_NOTICE.body).toContain("names of the languages");
    expect(AD_PARTNER_NOTICE.turnOff).toBe("Turn off");
    expect(AD_PARTNER_PRIVACY_URL).toBe("https://adcode.bluethenics.com/privacy#sponsored-cards");
  });
});
