import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Home from "../src/app/page";
import { MarketPriceChart } from "../src/components/MarketPriceChart";
import { AdPreviewMark } from "../src/components/AdPreviewMark";
import { WEB_VERSION_URL } from "../src/lib/site";
import {
  campaignNumbers,
  dollarsToMicrosExact,
  formatUsdMicros,
} from "../src/lib/campaignPricing";

describe("500-impression marketplace pricing", () => {
  it("maps the $1 block floor to the $2 CPM storage boundary", () => {
    expect(campaignNumbers("1.00", "1")).toEqual({
      bidPerBlockMicros: 1_000_000n,
      cpmMicros: 2_000_000n,
      budgetMicros: 1_000_000n,
      blocks: 1,
      impressions: 500,
    });
  });

  it("uses bid times blocks as the maximum campaign spend", () => {
    const result = campaignNumbers("2.25", "4");
    expect(result?.budgetMicros).toBe(9_000_000n);
    expect(result?.impressions).toBe(2_000);
    expect(formatUsdMicros(result?.budgetMicros ?? 0n)).toBe("$9.00");
  });

  it("refuses sub-floor bids, fractions of a cent, and invalid blocks", () => {
    expect(campaignNumbers("0.99", "1")).toBeNull();
    expect(campaignNumbers("1.001", "1")).toBeNull();
    expect(campaignNumbers("1.00", "0")).toBeNull();
    expect(dollarsToMicrosExact("$12.30")).toBe(12_300_000n);
  });
});

describe("live market chart", () => {
  it("labels the customer unit and never invents history", () => {
    const markup = renderToStaticMarkup(
      <MarketPriceChart currentCpmMicros="2000000" floorCpmMicros="2000000" asOf={100} history={[]} />,
    );
    expect(markup).toContain("USD / 500 impressions");
    expect(markup).toContain("$1.00");
    expect(markup).toContain("No settled auction history yet");
    expect(markup).not.toContain("campaignId");
  });

  it("renders real history with an accessible summary", () => {
    const markup = renderToStaticMarkup(
      <MarketPriceChart
        currentCpmMicros="5000000"
        floorCpmMicros="2000000"
        asOf={7_200_000}
        history={[
          { at: 0, clearingCpmMicros: "3000000" },
          { at: 3_600_000, clearingCpmMicros: "4000000" },
        ]}
      />,
    );
    expect(markup).toContain("3 market price points");
    expect(markup).toContain("$2.50");
    expect(markup).toContain("<polyline");
    expect(markup).not.toContain("linearGradient");
    expect(markup).not.toContain("url(#market-area)");
  });
});

describe("landing ad preview", () => {
  it("shows the uploaded image instead of the fallback initial", () => {
    const logo = "data:image/png;base64,preview-logo";
    const markup = renderToStaticMarkup(<AdPreviewMark logo={logo} company="Acme" />);

    expect(markup).toContain(`src="${logo}"`);
    expect(markup).toContain("Acme logo");
    expect(markup).not.toContain("bid-preview-initial");
  });

  it("uses the company initial until an image is selected", () => {
    const markup = renderToStaticMarkup(<AdPreviewMark logo={null} company="Linear" />);

    expect(markup).toContain("bid-preview-initial");
    expect(markup).toContain(">L<");
    expect(markup).not.toContain("<img");
  });
});

describe("landing page focus", () => {
  it("keeps advertising available without showing the live market panel", () => {
    const markup = renderToStaticMarkup(<Home />);

    expect(markup).toContain("Advertise on ADCode");
    expect(markup).not.toContain('class="market-panel"');
  });

  it("offers installation and browser access before the advertiser journey", () => {
    const markup = renderToStaticMarkup(<Home />);
    const at = (needle: string): number => {
      const index = markup.indexOf(needle);
      expect(index, needle).toBeGreaterThan(-1);
      return index;
    };

    // Before the product demonstration, visitors can install or open the real web app.
    const hero = markup.slice(at('id="earn"'), at('class="app-showcase"'));
    const links = [...hero.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)];
    expect(links.map(([, href]) => href)).toEqual([WEB_VERSION_URL, "/versions"]);
    expect(links[0]?.[2]).toContain("Open ADCode in browser");
    expect(links[1]?.[2]).toContain("Get the desktop app");

    // Advertising remains reachable after the developer's closing install action.
    expect(at('class="hero-proof"')).toBeLessThan(at('class="closing-cta'));
    expect(at('class="closing-cta')).toBeLessThan(at('id="advertise"'));
    expect(at('id="advertise"')).toBeLessThan(at('href="/advertisers"'));
  });
});
