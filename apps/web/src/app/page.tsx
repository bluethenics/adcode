import type { Metadata } from "next";
import { HeroInstall } from "@/components/HeroInstall";
import { LandingBidBuilder } from "@/components/LandingBidBuilder";
import { HeroCircuit } from "@/components/HeroCircuit";
import { HeroCounter } from "@/components/HeroCounter";
import { HomeFaq } from "@/components/HomeFaq";
import { JsonLd } from "@/components/JsonLd";
import { FAQ, faqPage } from "@/lib/schema";
import { SITE, url } from "@/lib/site";

/*
 * The title leads with what the page is, not only with what it promises.
 *
 * "Earn while you code" is the brand line and it stays - it is on the hero, and it is what
 * makes this different. But a title is also the query it has to match, and nobody searches
 * for a slogan. "Free AI code editor" is what somebody types when they are looking for
 * exactly this and do not yet know it exists; the promise then earns the click.
 *
 * `absolute` because the layout template appends " - ADCode", which would push a
 * title that already names the product past the length a result will show.
 */
export const metadata: Metadata = {
  title: { absolute: `${SITE.name} - a free AI code editor that pays you to use it` },
  description:
    "A full IDE - Monaco editing, real terminals, git and four AI providers - free forever. An occasional sponsored card funds it, and half of that revenue is credited to you.",
  alternates: { canonical: url("/") },
  openGraph: {
    type: "website",
    title: `${SITE.name} - ${SITE.tagline}`,
    description: SITE.description,
    url: url("/"),
  },
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
            <h1>Earn while you code</h1>
            {/*
              One line, not five. What this cut said - never mid-debug, never behind your
              back, half of every verified payment - is all still on the page, in the
              principles strip and the FAQ, where somebody who wants the detail goes
              looking. Saying it twice cost the hero its only job.
            */}
            <p>A real editor, free. Half of every ad it shows pays you.</p>
            <HeroCounter />
            {/*
              One offer, chosen for the machine the visitor is on. Every install is the
              terminal command, because it raises no SmartScreen dialog. See HeroInstall.
            */}
            <HeroInstall />
            <small>Windows · Linux · free to use · macOS coming soon</small>
          </div>
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
