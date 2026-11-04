import { describe, expect, it } from "vitest";
import type { MonetizeResponse } from "@adimpress/imprezia-sdk";
import { fitsNotification } from "../src/lib/sponsoredCard";

const answer = (cardMetadata: Record<string, unknown> | null): MonetizeResponse => ({
  monetizedResponse: "", originalResponse: "",
  linkData: cardMetadata === null ? {} : { "card-1": { string_link_word: "", hyperlink: "https://example.com", trackingId: "t", metadata: { brandCategory: "dev", cardMetadata } } },
  metadata: { timestamp: "", requestId: "r", processingTime: 0 },
} as unknown as MonetizeResponse);

describe("which cards a partner notification can show", () => {
  it("takes the card formats it can lay out like ADCode's own sponsored messages", () => {
    for (const adFormat of [undefined, "uicard-vertical", "uicard-horizontal", "uicard-text", "uicard-text-cta"]) {
      expect(fitsNotification(answer({ title: "Ship faster", brandName: "Acme", ...(adFormat === undefined ? {} : { adFormat }) })), String(adFormat)).toBe(true);
    }
  });

  it("declines banners, display sizes, forms and an answer with no card", () => {
    expect(fitsNotification(answer({ title: "x", brandName: "y", adBannerHtml: "<div>ad</div>" }))).toBe(false);
    expect(fitsNotification(answer({ title: "x", brandName: "y", renderUrl: "https://r.imprezia.net/r/t" }))).toBe(false);
    for (const adFormat of ["uicard-image-cta", "uicard-lead-gen", "uicard-survey", "dw_display_300x250_postchat"]) {
      expect(fitsNotification(answer({ title: "x", brandName: "y", adFormat })), adFormat).toBe(false);
    }
    expect(fitsNotification(answer(null))).toBe(false);
  });
});
