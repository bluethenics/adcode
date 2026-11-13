import { Icon } from "@/components/Icon";
import { ArrowDown, ArrowUpRight } from "lucide";
import type { Metadata } from "next";
import { StickyInstall } from "@/components/StickyInstall";
import { LandingBidBuilder } from "@/components/LandingBidBuilder";
import { LiveImpressionsCounter } from "@/components/LiveImpressionsCounter";
import { AppShowcase } from "@/components/AppShowcase";
import { ModeShowcase } from "@/components/ModeShowcase";
import { LiveAgentsShowcase } from "@/components/LiveAgentsShowcase";
import { LiveRecording } from "@/components/LiveRecording";
import { Partners } from "@/components/Partners";
import { DocsShowcase } from "@/components/DocsShowcase";
import { AboutUs } from "@/components/AboutUs";
import { HomeMotion } from "@/components/HomeMotion";
import { HeroDotField } from "@/components/HeroDotField";
import Link from "@/components/IntentLink";
import { HomeFaq } from "@/components/HomeFaq";
import { Buck } from "@/components/buck/Buck";
import { HomeNewFeatures } from "@/components/HomeNewFeatures";
import { FreePlan } from "@/components/FreePlan";
import { JsonLd } from "@/components/JsonLd";
import { FAQ, faqPage } from "@/lib/schema";
import { comparisons, landingPath } from "@/lib/landings";
import { pageMetadata } from "@/lib/seo";
import { SITE, SOURCE, WEB_VERSION_URL } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  path: "/",
  title: { absolute: SITE.name + " - a free AI code editor that pays you to use it" },
  socialTitle: SITE.name + " - " + SITE.tagline,
  description:
    "A full IDE with AI agents, real terminals and git - free forever. An occasional sponsored card funds it, and half of that ad revenue is credited to you.",
});

export default function Home() {
  return (
    <div className="marketplace-home home-redesign">
      <JsonLd data={faqPage(FAQ)} />
      <HomeMotion />
      <a className="skip-link" href="#marketplace-main">Skip to content</a>
      <section className="marketplace-hero studio-hero" id="earn">
        <div className="marketplace-wrap" id="marketplace-main">
          <div className="studio-hero-top">
            <HeroDotField />
            <div className="marketplace-hero-copy">
              <p className="home-hero-label">THE FREE AI CODE EDITOR</p>
              <h1>Your next idea.<br /><span>Built with free AI.</span></h1>
              <p>An AI code editor with agents, a terminal, and Git. Start in your browser. Sponsored cards fund the tools, and you receive half of eligible ad revenue.</p>
              <WebFirstActions />
              <ul className="hero-proof" aria-label="Start building online"><li>Free AI included</li><li>No download needed</li><li>No credit card</li></ul>
            </div>
          </div>
          <AppShowcase />
          <Partners />
        </div>
      </section>
      <ModeShowcase />
      <HomeNewFeatures />
      <FreePlan />
      <section className="home-share marketplace-wrap" aria-labelledby="share-heading" data-home-reveal>
        <div className="home-share-copy">
          <p className="marketplace-eyebrow">A FAIRER EXCHANGE</p>
          <h2 id="share-heading">Your attention.<br /><span>Your share.</span></h2>
          <p>An occasional sponsored card keeps ADCode free. You receive half of eligible ad revenue, with a clear record of every credit.</p>
          <Link className="home-text-link" href="/earn-while-you-code">How earnings work <Icon node={ArrowUpRight} /></Link>
        </div>
        <div className="home-share-panel">
          <Buck mood="idle" size={64} interactive greet="earning" hoverMood="earning" reactTo=".home-share-panel" label="Buck, with the coin you earn. Tap him." className="home-share-buck" />
          <span className="home-share-caption">BUILT AROUND A SIMPLE SPLIT</span>
          <strong className="home-share-amount">50<span>%</span></strong>
          <span className="home-share-label">of eligible ad revenue goes to you.</span>
          <div className="home-share-bar" aria-hidden="true"><span /><span /></div>
          <p>The other half keeps ADCode running. Earnings depend on eligible views and advertiser demand.</p>
          <LiveImpressionsCounter />
        </div>
      </section>
      <details className="home-agent-details marketplace-wrap">
        <summary><span><span className="marketplace-eyebrow">EXPLORE AT YOUR OWN PACE</span><strong>See the agents at work.</strong></span><span className="home-details-toggle" aria-hidden="true">+</span></summary>
        <LiveAgentsShowcase /><LiveRecording />
      </details>
      <AboutUs />
      <HomeFaq />
      <section className="closing-cta marketplace-wrap" data-home-reveal>
        <Buck mood="greeting" size={96} interactive greet="dancing" hoverMood="proud" reactTo=".closing-cta" label="Buck, cheering you on. Tap him." />
        <p className="marketplace-eyebrow">YOUR NEXT CHAPTER</p>
        <h2>Make something<br /><span>you&apos;ve been imagining.</span></h2>
        <p>A full editor. Free AI. Space to see what you can do.</p>
        <WebFirstActions />
      </section>
      <section className="marketplace-bid" id="advertise">
        <div className="marketplace-wrap">
          <div className="home-advertiser-intro" data-home-reveal>
            <header><p className="marketplace-eyebrow">Advertise on ADCode</p><h2>Good tools meet<br />the right people.</h2><p>Reach developers as they build. Start from <strong>$1 per 500 verified impressions.</strong></p></header>
            <Link className="home-link-button" href="/advertisers">Start advertising <Icon node={ArrowUpRight} /></Link>
          </div>
          {/* Open from the start: the bid builder answers "what would it cost me", which is the question that brings an advertiser this far. */}
          <details className="home-campaign-details" open>
            <summary><span><strong>Create your first campaign</strong><span>Set your bid and preview your ad.</span></span><span className="home-details-toggle" aria-hidden="true">+</span></summary>
            <LandingBidBuilder />
            <section className="marketplace-principles" aria-label="How ADCode advertising works"><div className="marketplace-wrap"><p><span>01</span><strong>Verified attention</strong><small>Only a real, eligible view can bill.</small></p><p><span>02</span><strong>Second-price auction</strong><small>Win at your maximum; often pay less.</small></p><p><span>03</span><strong>Checked on submit</strong><small>Automated checks run before a card can serve.</small></p></div></section>
          </details>
        </div>
      </section>
      <section className="home-resources marketplace-wrap" aria-labelledby="resources-heading">
        <div className="home-resources-intro"><div><p className="marketplace-eyebrow">WHEN YOU NEED A HAND</p><h2 id="resources-heading">A guide for the next step.</h2></div><Link className="home-text-link" href="/docs">Open the docs <Icon node={ArrowUpRight} /></Link></div>
        <details className="home-resource-details"><summary>Explore guides, comparisons, and source code <span className="home-details-toggle" aria-hidden="true">+</span></summary>
          <DocsShowcase />
          <div className="home-comparisons"><p>Compare your editor</p><nav aria-label="Editor comparisons">{comparisons().map((page) => <Link className="home-text-link" key={page.slug} href={landingPath(page)}>{page.comparison?.subject.replace(/ \(formerly .*\)$/, "")} <Icon node={ArrowUpRight} /></Link>)}</nav></div>
          <div className="home-source-links"><Link className="home-text-link" href="/free-ai-code-editor">Explore the free editor <Icon node={ArrowUpRight} /></Link><a className="home-text-link" href={SOURCE.repo} target="_blank" rel="noopener noreferrer">View on GitHub <Icon node={ArrowUpRight} /></a></div>
        </details>
      </section>
      <StickyInstall webFirst />
    </div>
  );
}

function WebFirstActions() {
  return <div className="hero-install">
    <div className="marketplace-hero-actions">
      <a href={WEB_VERSION_URL} className="marketplace-primary">Open ADCode in browser <Icon node={ArrowUpRight} /></a>
      <Link href="/versions" className="marketplace-secondary">Get the desktop app <Icon node={ArrowDown} /></Link>
    </div>
    <p className="hero-install-note">Build online, or use the desktop app for local projects.</p>
  </div>;
}
