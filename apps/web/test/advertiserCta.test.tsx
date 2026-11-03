import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Home from "../src/app/page";
import { HeroInstall } from "../src/components/HeroInstall";

describe("advertisers have a real way in from the hero", () => {
  const markup = renderToStaticMarkup(<HeroInstall source="hero" tour="#how-it-works" />);

  it("is one clickable, tracked link - not a sentence with a small link in it", () => {
    const pill = /<a href="\/#advertise" class="hero-advertise"[^>]*data-tracked[^>]*>([\s\S]*?)<\/a>/.exec(markup);
    expect(pill, "the advertiser pill").not.toBeNull();
    expect(pill![1]).toContain("For advertisers");
    expect(pill![1]).toContain("Start a campaign from $1");
    expect(markup).not.toContain('class="hero-install-advertise"');
  });

  it("still leaves Download as the one primary button, before the advertiser pill", () => {
    expect(markup.indexOf("marketplace-primary")).toBeGreaterThan(-1);
    expect(markup.indexOf("marketplace-primary")).toBeLessThan(markup.indexOf("hero-advertise"));
    expect(markup.match(/marketplace-primary/g)).toHaveLength(1);
  });

  it("keeps the homepage hero focused while retaining the advertiser destination", () => {
    const home = renderToStaticMarkup(<Home />);
    expect(home).not.toContain('class="hero-advertise"');
    const advertiserSection = home.slice(home.indexOf('id="advertise"'));
    expect(home).toContain('id="advertise"');
    expect(advertiserSection).toContain('href="/advertisers"');
    expect(advertiserSection).toContain("Create your first campaign");
    expect(advertiserSection).toMatch(/<form\b[\s\S]*?<button\b[^>]*type="submit"/);
    expect(advertiserSection).toContain("$1 per 500 verified impressions");
  });
});
