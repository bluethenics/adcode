import type { Metadata } from "next";
import { ArrowDown, ArrowRight, ArrowUpRight } from "lucide";
import { Icon } from "@/components/Icon";
import { JsonLd } from "@/components/JsonLd";
import { LandingBidBuilder } from "@/components/LandingBidBuilder";
import { SponsoredToastPreview } from "@/components/SponsoredToastPreview";
import { NetworkBand, ReachHeadline } from "@/components/advertisers/NetworkStats";
import { ClearingPrice } from "@/components/advertisers/ClearingPrice";
import { ADVERTISER_FAQ, FLOOR, TARGETING, budgetExamples, readNetworkStats } from "@/lib/advertisers";
import { breadcrumbs, faqPage } from "@/lib/schema";
import { pageMetadata } from "@/lib/seo";
import { ECONOMICS, TEAM, WEB_VERSION_URL } from "@/lib/site";
import { showcase } from "@/lib/showcase";
import "./advertisers.css";

export const metadata: Metadata = pageMetadata({
  path: "/advertisers",
  title: "Advertise to developers on ADCode, from $1 per 500 views",
  socialTitle: "Advertise on ADCode: reach developers while they build",
  description: `Put a native sponsored card in front of developers inside a free AI code editor. Pay only for verified views, from ${FLOOR.block} per ${FLOOR.views}. Live in minutes, no contract.`,
});

/** The live figures are read at most once a minute, then refreshed in the browser. */
export const revalidate = 60;

/*
 * The example card. A made-up brand, because a real one would read as an endorsement;
 * the markup is the real one, from `SponsoredToastPreview`, which mirrors the editor.
 */
const EXAMPLE = {
  brand: "Tracewell",
  headline: "Find the line that broke prod",
  body: "Error tracking that opens the failing commit for you. Free for small teams.",
};

const REASONS: readonly { title: string; body: string }[] = [
  { title: "You pay for attention, not fetches", body: "A view bills only after four seconds on screen in a focused editor, and only once its receipt syncs. Hidden windows and expired cards cost nothing." },
  { title: "Second-price auction", body: "Set a maximum. When you win a slot you pay just enough to beat the next bid." },
  { title: "Developers are paid to see you", body: `Half of every verified view is credited to the developer who saw it, ${ECONOMICS.revSharePercent}% on the ledger. Your card is the reason their editor is free.` },
  { title: "Nothing about them to leak", body: "Targeting uses 45 generic tags picked on the device. No source code, file names or personal data reach the ad server." },
];

const PLACEMENTS: readonly { name: string; detail: string; kind: "desktop" | "browser"; bar: string }[] = [
  { name: "Desktop app", detail: "Windows, macOS and Linux", kind: "desktop", bar: "ADCode" },
  { name: "Browser editor", detail: "No install, same card", kind: "browser", bar: new URL(WEB_VERSION_URL).host },
];

/** A few lines of ordinary code behind the card, so the mock reads as an editor at work. */
const EDITOR_LINES = `export async function deploy(env: Env) {
  const build = await bundle("./src");
  await upload(build, env.bucket);
  return verify(env.url);
}`;

/*
 * The sample workspace mirrors the real portal's overview (Views, Clicks, Spent), with
 * made-up figures that obey the real price: 12,480 verified views at the $2 floor CPM is
 * $24.96. Labelled as a sample on the page, because a number that looks measured is a claim.
 */
const SAMPLE = {
  views: 12_480,
  clicks: 187,
  spent: "$24.96",
  budget: "$50",
  daily: [1210, 1480, 1630, 1890, 1720, 2160, 2390],
} as const;

function sparkline(values: readonly number[], width = 320, height = 88): string {
  const max = Math.max(...values);
  const min = Math.min(...values);
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - 6 - ((value - min) / (max - min || 1)) * (height - 12);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

const LAUNCH: readonly { title: string; body: string }[] = [
  { title: "Write your card", body: "Your logo, one line of up to 60 characters, and an https link." },
  { title: "Choose who sees it", body: "Every developer, or only those working in the languages, frameworks and tools you pick." },
  { title: "Fund it and go live", body: `Buy blocks of ${FLOOR.views} verified views. Cards pass automated checks on submit and start serving right away.` },
];

export default async function AdvertisersPage() {
  const stats = await readNetworkStats();
  const examples = budgetExamples();

  return (
    <div className="adv-page">
      <JsonLd data={breadcrumbs([{ name: "Home", path: "/" }, { name: "Advertise", path: "/advertisers" }])} />
      <JsonLd data={faqPage(ADVERTISER_FAQ)} />

      <section className="adv-hero adv-wrap">
        <div className="adv-hero-copy">
          <p className="adv-eyebrow">Advertise on ADCode</p>
          <ReachHeadline initial={stats} />
          <p className="adv-hero-lede">A native card inside a free AI code editor. Pay only for verified views, from {FLOOR.block} per {FLOOR.views}.</p>
          <div className="adv-actions">
            <a className="adv-primary" href="#start">Start a campaign <Icon node={ArrowRight} /></a>
            <a className="adv-secondary" href="#pricing">See pricing <Icon node={ArrowDown} /></a>
          </div>
        </div>
        <figure className="adv-hero-shot">
          <div className="adv-hero-stage">
            <div className="showcase-images adv-hero-frame">
              {/* eslint-disable-next-line @next/next/no-img-element -- a fixed-size poster from /public */}
              <img className="showcase-image-light" src={showcase.light.poster} alt="ADCode's editor with a project open" width={showcase.light.width} height={showcase.light.height} fetchPriority="high" />
              {/* eslint-disable-next-line @next/next/no-img-element -- a fixed-size poster from /public */}
              <img className="showcase-image-dark" src={showcase.dark.poster} alt="ADCode's editor with a project open" width={showcase.dark.width} height={showcase.dark.height} fetchPriority="high" />
            </div>
            <div className="adv-hero-toast">
              <SponsoredToastPreview brand={EXAMPLE.brand} headline={EXAMPLE.headline} body={EXAMPLE.body} logo={null} />
            </div>
          </div>
          <figcaption>Where your card appears: the corner of the editor, while a developer works. Example brand.</figcaption>
        </figure>
      </section>

      <div className="adv-wrap">
        <NetworkBand initial={stats} />
      </div>

      <section className="adv-format adv-wrap" aria-labelledby="adv-format-title">
        <div className="adv-format-copy">
          <h2 id="adv-format-title">One card. Full attention.</h2>
          <p>There is no feed to scroll past and no banner blindness. Your card is the only sponsored thing on screen, shown in the editor developers keep open all day.</p>
          <ul className="adv-facts">
            <li><strong>Your logo, your line, your link</strong><span>Rendered natively in light and dark, so it reads like part of the tool.</span></li>
            <li><strong>Desktop app and browser</strong><span>The same card serves on Windows, macOS, Linux and the web editor.</span></li>
            <li><strong>Paced, never spammy</strong><span>At most {ECONOMICS.adsPerHourStandard} cards an hour at the default setting, so each one is noticed.</span></li>
          </ul>
        </div>
        {/* Both places the card serves, shown rather than described. The card is the real markup. */}
        <div className="adv-placements">
          {PLACEMENTS.map((placement) => (
            <figure className="adv-placement" key={placement.name}>
              <div className="adv-window" data-kind={placement.kind} aria-hidden="true">
                <div className="adv-window-bar">
                  <i /><i /><i />
                  <span>{placement.bar}</span>
                </div>
                <div className="adv-window-body">
                  <pre>{EDITOR_LINES}</pre>
                  <div className="adv-window-card">
                    <SponsoredToastPreview brand={EXAMPLE.brand} headline={EXAMPLE.headline} body={EXAMPLE.body} logo={null} />
                  </div>
                </div>
              </div>
              <figcaption><strong>{placement.name}</strong><span>{placement.detail}</span></figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="adv-targeting adv-wrap" aria-labelledby="adv-targeting-title">
        <h2 id="adv-targeting-title">Target the stack, not a persona.</h2>
        <p>Pick the contexts your product is for. Your card serves only to developers working in them, or to everyone if you leave them all off.</p>
        <div className="adv-tag-groups">
          {TARGETING.map((group) => (
            <div key={group.group}>
              <h3>{group.group}</h3>
              <ul>{group.tags.map((tag) => <li key={tag}>{tag}</li>)}</ul>
            </div>
          ))}
        </div>
      </section>

      <section className="adv-console adv-wrap" aria-labelledby="adv-console-title">
        <div className="adv-console-copy">
          <h2 id="adv-console-title">Run it from one workspace.</h2>
          <p>Views, clicks and spend for every campaign, day by day. Pause, raise the budget or swap the card whenever you like.</p>
        </div>
        <figure className="adv-console-frame">
          <div className="adv-console-app" aria-hidden="true">
            <nav className="adv-console-nav">
              <strong>Advertiser</strong>
              <span data-active="true">Overview</span>
              <span>Campaigns</span>
              <span>Credits</span>
            </nav>
            <div className="adv-console-main">
              <dl className="adv-console-kpis">
                <div><dt>Views</dt><dd>{SAMPLE.views.toLocaleString("en-US")}</dd></div>
                <div><dt>Clicks</dt><dd>{SAMPLE.clicks.toLocaleString("en-US")}</dd></div>
                <div><dt>Spent</dt><dd className="money">{SAMPLE.spent}</dd></div>
              </dl>
              <div className="adv-console-chart">
                <span>Views, 7 days</span>
                <svg viewBox="0 0 320 88" preserveAspectRatio="none"><polyline points={sparkline(SAMPLE.daily)} /></svg>
              </div>
              <div className="adv-console-row">
                <span className="adv-console-name">{EXAMPLE.brand} · launch week</span>
                <span className="adv-console-pill">Active</span>
                <span>{SAMPLE.spent} of {SAMPLE.budget}</span>
              </div>
            </div>
          </div>
          <figcaption>Sample campaign with illustrative figures, priced at the {FLOOR.cpm} floor CPM.</figcaption>
        </figure>
      </section>

      <section className="adv-pricing adv-wrap" id="pricing" aria-labelledby="adv-pricing-title">
        <div className="adv-pricing-lead">
          <h2 id="adv-pricing-title">Priced so you can try it today.</h2>
          <p className="adv-price"><strong className="money">{FLOOR.block}</strong> per {FLOOR.views} verified views</p>
          <p>That is a {FLOOR.cpm} CPM, with no minimum spend, no contract and no setup fee. Credits you do not use stay in your balance.</p>
          <ClearingPrice />
          <a className="adv-primary adv-pricing-cta" href="#start">Start a campaign <Icon node={ArrowRight} /></a>
        </div>
        <table className="adv-budget">
          <caption>What a budget buys at the floor bid</caption>
          <thead><tr><th scope="col">Budget</th><th scope="col">Verified views</th></tr></thead>
          <tbody>
            {examples.map((row) => (
              <tr key={row.budget}><th scope="row" className="money">{row.budget}</th><td>{row.views.toLocaleString("en-US")}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="adv-reasons adv-wrap" aria-labelledby="adv-reasons-title">
        <h2 id="adv-reasons-title">Built so every dollar reaches a person.</h2>
        <ol>
          {REASONS.map((reason) => <li key={reason.title}><h3>{reason.title}</h3><p>{reason.body}</p></li>)}
        </ol>
      </section>

      <section className="adv-launch adv-wrap" aria-labelledby="adv-launch-title">
        <h2 id="adv-launch-title">Live in about five minutes.</h2>
        <ol>
          {LAUNCH.map((step) => <li key={step.title}><h3>{step.title}</h3><p>{step.body}</p></li>)}
        </ol>
      </section>

      <section className="marketplace-bid adv-start" id="start" aria-label="Create your campaign">
        <div className="adv-wrap">
          <LandingBidBuilder />
        </div>
      </section>

      <section className="adv-faq adv-wrap" aria-labelledby="adv-faq-title">
        <h2 id="adv-faq-title">Questions advertisers ask</h2>
        <div>
          {ADVERTISER_FAQ.map((item) => (
            <details key={item.q}>
              <summary>{item.q}<span aria-hidden="true">+</span></summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="adv-closing adv-wrap" aria-labelledby="adv-closing-title">
        <h2 id="adv-closing-title">Planning a larger launch?</h2>
        <p>Talk through budgets, targeting and timing with the founder. Thirty minutes, no pitch deck required.</p>
        <div className="adv-actions">
          <a className="adv-primary" href="#start">Start a campaign <Icon node={ArrowRight} /></a>
          <a className="adv-secondary" href={TEAM.bookingUrl} target="_blank" rel="noopener noreferrer">Book a call <Icon node={ArrowUpRight} /></a>
        </div>
        <p className="adv-returning">Already advertising? <a href="/portal">Open your advertiser workspace</a></p>
      </section>
    </div>
  );
}
