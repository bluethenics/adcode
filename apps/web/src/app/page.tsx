import type { Metadata } from "next";
import { HeroInstall } from "@/components/HeroInstall";
import { LandingBidBuilder } from "@/components/LandingBidBuilder";
import { HeroCounter } from "@/components/HeroCounter";
import { AppShowcase } from "@/components/AppShowcase";
import Link from "next/link";
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
      <section className="marketplace-hero studio-hero" id="earn">
      <div className="marketplace-wrap" id="marketplace-main">
      <div className="studio-hero-top"><div className="marketplace-hero-copy">
      <h1>A place to build your next big idea.<br />Get paid to build.</h1>
      <p>Build with AI. Earn while you code. Free from the first line.</p>
      <p>An IDE that pays you 50% of ad revenue.</p>
      <HeroInstall />
      <small>Available for Windows and Linux. macOS coming soon.</small>
      </div></div>
      <AppShowcase />
      <HeroCounter />
      </div>
      </section>

      <section className="product-story marketplace-wrap" aria-labelledby="product-story-heading">
      <div className="product-story-heading"><p className="marketplace-eyebrow">THE SPACE TO BUILD</p><h2 id="product-story-heading">Everything you need.<br /><span>Nothing in your way.</span></h2><p>From the first idea to the final commit, make yourself at home in an editor built around your work.</p></div>
      <div className="product-features">
      <article><span className="feature-symbol" aria-hidden="true">✧</span><span className="feature-number">01 / INTELLIGENCE</span><h3>A second mind.<br />Right beside your code.</h3><p>Work with four AI providers in your editor. Bring your own key and choose the model that fits the task.</p><Link href="/docs">Explore the workspace <span aria-hidden="true">↗</span></Link></article>
      <article><span className="feature-symbol" aria-hidden="true">⌘</span><span className="feature-number">02 / CRAFT</span><h3>Stay in flow.<br />Ship what matters.</h3><p>Monaco editing, real terminals, and integrated Git. The tools you reach for, together where you need them.</p><Link href="/free-ai-code-editor">Meet your new editor <span aria-hidden="true">↗</span></Link></article>
      <article><span className="feature-symbol" aria-hidden="true">↗</span><span className="feature-number">03 / YOUR SHARE</span><h3>Your attention.<br />Something in return.</h3><p>An occasional sponsored card keeps the editor free. Half of the ad revenue is credited to you, with every event itemized.</p><Link href="/earn-while-you-code">How earnings work <span aria-hidden="true">↗</span></Link></article>
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
      <section className="closing-cta marketplace-wrap"><p className="marketplace-eyebrow">YOUR NEXT CHAPTER</p><h2>Good things start<br />with a line of code.</h2><Link href="/versions" className="marketplace-primary">Get ADCode <span aria-hidden="true">↓</span></Link><p>Free to build. Yours to make.</p></section>
      </div>
    );
  }
