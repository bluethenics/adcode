import Link from "next/link";
import type { Metadata } from "next";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbs, faqPage } from "@/lib/schema";
import { ECONOMICS, formatMicros, url } from "@/lib/site";
import { DesktopMockup } from "@/components/DesktopMockup";

export const metadata: Metadata = {
  title: "Advertise to developers",
  description:
    "Reach developers by the language, framework, or tool open in their editor. Pay only for verified views, with half of every dollar going to the developer who saw it.",
  alternates: { canonical: url("/advertise") },
};

const ADVERTISER_FAQ = [
  {
    q: "How is an ADCode ad targeted?",
    a: "By the language, framework, tool, or platform currently open in the developer's editor, chosen from a fixed list of 45 tags such as lang:rust or fw:react. Targeting is based on what someone is working on right now, not on browsing history.",
  },
  {
    q: "What does ADCode advertising cost?",
    a: `Campaigns are bought at a ${formatMicros(ECONOMICS.cpmMicros, 2)} CPM - ${formatMicros(ECONOMICS.cpmMicros / 1000n)} per verified view. You set a total budget, and serving stops when it is spent.`,
  },
  {
    q: "How does ADCode prevent fraudulent impressions?",
    a: "Every card the server sends is recorded. A view is only billable if it matches a card that was actually served to that user, within a short window, with a plausible time on screen. Receipts that do not match earn nothing and bill nobody.",
  },
  {
    q: "What reporting do advertisers get?",
    a: "Views, clicks, and spend charted by the day, per campaign and across the whole account, updated as receipts are verified. Reporting is aggregate: advertisers never receive identifiers or tags for individual developers.",
  },
] as const;

export default function AdvertisePage() {
  return (
    <>
      <JsonLd
        data={breadcrumbs([
          { name: "Home", path: "/" },
          { name: "Advertise", path: "/advertise" },
        ])}
      />
      <JsonLd data={faqPage(ADVERTISER_FAQ)} />

      <section className="download-hero band-night">
        <div className="wrap download-hero-grid">
          <div>
          <div className="section-head">
            <p className="eyebrow">For advertisers</p>
            <h1 style={{ fontSize: "clamp(32px, 4.6vw, 52px)" }}>
              Reach developers while they are actually working.
            </h1>
            <p className="lede">
              A card in the corner of the editor, targeted by the language and framework open
              in front of them. You pay for verified views only, and half of what you pay goes
              to the developer who saw it — which is the reason they leave ads on.
            </p>
          </div><DesktopMockup className="desktop-mockup--compact" />
          </div>

          <div className="hero-cta">
            <Link href="/portal/campaigns/new" className="btn btn-primary btn-large">
              Start a campaign
            </Link>
            <a href="mailto:advertise@adcode.bluethenics.com" className="btn btn-ghost">
              Talk to us first
            </a>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <div className="section-head">
            <p className="eyebrow">How it works</p>
            <h2>One screen, no sales call required.</h2>
            <p className="lede">
              Drop your logo in, write your message, set a budget. Your advertiser account is
              created with the campaign — there is no sign-up to get through first, and no
              PNG to host somewhere before you start.
            </p>
          </div>

          <div className="grid grid-2">
            <div className="card">
              <h3>Your logo and your message</h3>
              <p>
                A headline, an optional supporting line, a link, and a logo you drag onto the
                page. You watch the card change as you type it, at the size it really renders.
              </p>
            </div>
            <div className="card">
              <h3>Pick who sees it</h3>
              <p>
                45 tags across languages, frameworks, tools, and platforms. Leave them all
                unticked to reach every developer.
              </p>
            </div>
            <div className="card">
              <h3>Set a budget</h3>
              <p>
                A total, in dollars. The server stops serving the moment it is spent — there is
                no overrun to argue about afterwards.
              </p>
            </div>
            <div className="card">
              <h3>Watch it work</h3>
              <p>
                Views, clicks and spend, charted by the day, per campaign and across the
                account. Only real views appear, because only real views bill.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="band band-ink">
        <div className="wrap">
          <div className="section-head">
            <p className="eyebrow">Why the developer gets half</p>
            <h2>An audience that is paid to be there is an audience that stays.</h2>
            <p className="lede">
              Ad blocking exists because ads take something and give nothing back. ADCode gives
              half the money to the person looking at the card, and shows them the exact amount
              on a ledger they can audit. That is why the ads are still switched on.
            </p>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <div className="section-head">
            <p className="eyebrow">Questions</p>
            <h2>What advertisers ask.</h2>
          </div>
          <div className="faq">
            {ADVERTISER_FAQ.map((item) => (
              <div className="faq-item" key={item.q}>
                <h3>{item.q}</h3>
                <p>{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
