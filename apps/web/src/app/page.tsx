import type { Metadata } from "next";
import { DownloadButton } from "@/components/DownloadButton";
import { LandingBidBuilder } from "@/components/LandingBidBuilder";
import { MarketDemand } from "@/components/MarketDemand";
import { HeroCircuit } from "@/components/HeroCircuit";
import { HomeFaq } from "@/components/HomeFaq";
import { JsonLd } from "@/components/JsonLd";
import { FAQ, faqPage } from "@/lib/schema";
import { SITE, url } from "@/lib/site";

export const metadata: Metadata = {
  title: SITE.tagline,
  description: "A privacy-first code editor funded by respectful advertising. Developers receive half of verified ad spend.",
  alternates: { canonical: url("/") },
};

export default function Home() {
  return (
    <div className="marketplace-home">
      {/*
        The answers were already written and only a text file read them. Emitting the
        schema beside the section that prints them is what lets a search engine quote
        "ADCode is free" instead of guessing it from marketing copy.
      */}
      <JsonLd data={faqPage(FAQ)} />
      <a className="skip-link" href="#marketplace-main">Skip to content</a>
      <section className="marketplace-hero" id="earn">
        <HeroCircuit />
        <div className="marketplace-wrap" id="marketplace-main">
          <div className="marketplace-hero-copy">
            <p className="marketplace-eyebrow"><span /> Privacy-first developer network</p>
            <h1>Earn while you code</h1>
            <p>Use a professional code editor for free. Respectful ads wait for a pause, and half of every verified payment goes to you.</p>
            <div className="marketplace-hero-actions">
              <DownloadButton className="marketplace-primary">Download ADCode <span aria-hidden="true">↓</span></DownloadButton>
              <a href="#advertise" className="marketplace-secondary">Advertise to developers <span aria-hidden="true">↘</span></a>
            </div>
            <small>Windows · macOS · Linux · free to use</small>
          </div>
          <MarketDemand />
        </div>
      </section>

      <section className="marketplace-bid" id="advertise">
        <div className="marketplace-wrap marketplace-bid-grid">
          <header className="marketplace-section-intro">
            <p className="marketplace-eyebrow"><span /> Advertise on ADCode</p>
            <h2>Reach developers<br />while they build.</h2>
            <p>Bid from <strong>$1 per 500 verified impressions</strong>. Live demand sets the price, and a winning campaign can pay less than its maximum bid.</p>
            <dl><div><dt>50%</dt><dd>paid to developers</dd></div><div><dt>$1</dt><dd>minimum block bid</dd></div><div><dt>0</dt><dd>personal code collected</dd></div></dl>
          </header>
          <LandingBidBuilder />
        </div>
      </section>

      <section className="marketplace-principles" aria-label="How ADCode works">
        <div className="marketplace-wrap"><p><span>01</span><strong>Verified attention</strong><small>Only a real, eligible view can bill.</small></p><p><span>02</span><strong>Second-price auction</strong><small>Win at your maximum; often pay less.</small></p><p><span>03</span><strong>Human review</strong><small>Every creative is checked before delivery.</small></p></div>
      </section>

      <HomeFaq />
    </div>
  );
}
